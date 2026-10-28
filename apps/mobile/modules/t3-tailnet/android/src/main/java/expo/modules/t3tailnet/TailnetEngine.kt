package expo.modules.t3tailnet

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.net.NetworkInterface
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/** JNI entry point of libt3tailnet.so; see go/jni.go. */
internal object TailnetNative {
  val available: Boolean =
    try {
      System.loadLibrary("t3tailnet")
      true
    } catch (error: UnsatisfiedLinkError) {
      Log.i("T3Tailnet", "Built-in Tailscale is not part of this build: ${error.message}")
      false
    }

  @JvmStatic external fun call(method: String, args: String): String
}

/**
 * The embedded Tailscale node. It lives in the app process, so it ends when
 * Android kills the app; it never holds the phone's VPN slot.
 */
internal object TailnetEngine {
  private const val PREFS = "t3-tailnet"
  /** How long the node outlives the app leaving the screen, for a quick return. */
  private const val BACKGROUND_GRACE_MS = 30_000L
  private val executor = Executors.newCachedThreadPool()
  private val main = Handler(Looper.getMainLooper())
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var lifecycleObserver: DefaultLifecycleObserver? = null

  /**
   * Stops the node shortly after the app leaves the screen, unless direct
   * notifications keep a connection open in the background. React Native
   * pauses JS timers in the background, so this runs natively.
   */
  fun watchLifecycle(context: Context) {
    val app = context.applicationContext
    appContext = app
    main.post {
      if (lifecycleObserver != null) return@post
      val stopLater = Runnable {
        if (directNotificationsEnabled(app) || PhoneShareService.isEnabled(app)) return@Runnable
        executor.execute {
          // Signing in leaves T3 for the browser; the engine stops an
          // abandoned sign-in on its own after ten minutes.
          if (!waitingForUser()) stop(app)
        }
      }
      val observer = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
          main.removeCallbacks(stopLater)
          if (PhoneShareService.isEnabled(app)) {
            try {
              PhoneShareService.setEnabled(app, true)
            } catch (error: Exception) {
              Log.w("T3Tailnet", "Could not restore phone sharing", error)
            }
          }
        }
        override fun onStop(owner: LifecycleOwner) {
          main.removeCallbacks(stopLater)
          main.postDelayed(stopLater, BACKGROUND_GRACE_MS)
        }
      }
      ProcessLifecycleOwner.get().lifecycle.addObserver(observer)
      lifecycleObserver = observer
    }
  }

  private fun waitingForUser(): Boolean {
    val state = try {
      JSONObject(call("status")).optJSONObject("result")?.optString("state")
    } catch (error: Exception) {
      null
    }
    return state == "needs-login" || state == "needs-approval"
  }

  /** The switch of DirectNotificationService in the t3-agent-notifications module. */
  private fun directNotificationsEnabled(context: Context) =
    context.getSharedPreferences("t3-direct-notifications", Context.MODE_PRIVATE).getBoolean("enabled", false)

  fun isEnabled(context: Context) = prefs(context).getBoolean("enabled", false)

  private val POSITIONS = setOf("first", "before-tailscale", "after-tailscale", "last")

  /** Where built-in Tailscale goes among the saved routes; see BuiltInTailnetPosition. */
  fun position(context: Context) =
    prefs(context).getString("position", "first")?.takeIf { it in POSITIONS } ?: "first"

  /** Last known sign-in state, so connection attempts skip a node that needs a login. */
  fun isSignedIn(context: Context) = prefs(context).getBoolean("signedIn", false)

  fun setConfig(context: Context, enabled: Boolean, position: String) {
    prefs(context).edit()
      .putBoolean("enabled", enabled)
      .putString("position", if (position in POSITIONS) position else "first")
      .apply()
  }

  @Volatile private var appContext: Context? = null

  private fun rememberSignIn(reply: String) {
    val context = appContext ?: return
    val state = try {
      JSONObject(reply).optJSONObject("result")?.optString("state")
    } catch (error: Exception) {
      null
    }
    when (state) {
      "running" -> prefs(context).edit().putBoolean("signedIn", true).apply()
      "needs-login" -> prefs(context).edit().putBoolean("signedIn", false).apply()
    }
  }

  fun async(work: () -> String, done: (String) -> Unit) = executor.execute { done(work()) }

  fun call(method: String, args: JSONObject = JSONObject()): String {
    if (!TailnetNative.available) {
      return JSONObject().put("ok", false).put("error", "Built-in Tailscale is not part of this build.").toString()
    }
    return TailnetNative.call(method, args.toString()).also(::rememberSignIn)
  }

  fun start(context: Context, idleTimeoutSeconds: Int): String {
    appContext = context.applicationContext
    val args = JSONObject()
      .put("stateDir", context.filesDir.resolve("tailnet").absolutePath)
      .put("hostname", hostname())
      .put("idleTimeoutSeconds", idleTimeoutSeconds)
      .put("interfaces", interfaces())
      .put("defaultInterface", defaultInterface(context) ?: "")
    val result = call("start", args)
    watchNetworks(context)
    return result
  }

  fun stop(context: Context): String {
    unwatchNetworks(context)
    return call("stop")
  }

  fun logout(context: Context): String {
    unwatchNetworks(context)
    prefs(context).edit().putBoolean("signedIn", false).apply()
    return call("logout")
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** A name such as "t3-sm-s916b", shown in the Tailscale admin console. */
  private fun hostname(): String {
    val model = Build.MODEL.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
    return "t3-" + model.ifEmpty { "android" }.take(40)
  }

  /** Go cannot list interfaces on Android 11+, so the app supplies them. */
  private fun interfaces(): JSONArray {
    val list = JSONArray()
    val all = try {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
    } catch (error: Exception) {
      emptyList()
    }
    for (nif in all) {
      try {
        val addrs = JSONArray()
        var broadcast = false
        for (address in nif.interfaceAddresses) {
          addrs.put("${address.address.hostAddress}/${address.networkPrefixLength}")
          if (address.broadcast != null) broadcast = true
        }
        list.put(
          JSONObject()
            .put("name", nif.name)
            .put("index", nif.index)
            .put("mtu", nif.mtu)
            .put("up", nif.isUp)
            .put("broadcast", broadcast)
            .put("loopback", nif.isLoopback)
            .put("pointToPoint", nif.isPointToPoint)
            .put("multicast", nif.supportsMulticast())
            .put("addrs", addrs)
        )
      } catch (error: Exception) {
        // An interface that vanished while listing is skipped.
      }
    }
    return list
  }

  private fun defaultInterface(context: Context): String? {
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return null
    return connectivity.getLinkProperties(connectivity.activeNetwork)?.interfaceName
  }

  private fun pushInterfaces(context: Context) {
    executor.execute {
      call("interfaces", JSONObject().put("interfaces", interfaces()).put("defaultInterface", defaultInterface(context) ?: ""))
    }
  }

  @Synchronized
  private fun watchNetworks(context: Context) {
    if (networkCallback != null) return
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = pushInterfaces(context)
      override fun onLost(network: Network) = pushInterfaces(context)
      override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) = pushInterfaces(context)
    }
    try {
      connectivity.registerDefaultNetworkCallback(callback)
      networkCallback = callback
    } catch (error: Exception) {
      Log.w("T3Tailnet", "Could not watch network changes", error)
    }
  }

  @Synchronized
  private fun unwatchNetworks(context: Context) {
    val callback = networkCallback ?: return
    networkCallback = null
    try {
      context.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(callback)
    } catch (error: Exception) {
      // Already unregistered.
    }
  }
}
