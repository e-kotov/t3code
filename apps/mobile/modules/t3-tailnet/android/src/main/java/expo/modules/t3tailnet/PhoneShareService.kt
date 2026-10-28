package expo.modules.t3tailnet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.ConnectException
import java.net.URL

/** Keeps only the phone's paired T3 endpoint available on its private tailnet. */
open class PhoneShareService : Service() {
  enum class ServerHealth { READY, STOPPED, WAITING }
  companion object {
    private const val PREFS = "t3-phone-share"
    private const val CHANNEL = "phone-t3-sharing"
    private const val ID = 73003
    private const val STOP = "t3.phone-share.STOP"
    private val stateLock = Any()
    const val IDLE_SECONDS = 300
    @Volatile private var summary = "Off"
    @Volatile private var instance: PhoneShareService? = null
    private var restartRequested = false

    fun isEnabled(context: Context) = context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("enabled", false)
    fun status(context: Context): String = synchronized(stateLock) {
      if (instance == null) context.getSharedPreferences(PREFS, MODE_PRIVATE).getString("error", null) ?: summary else summary
    }

    fun restore(context: Context) {
      synchronized(stateLock) {
        if (isEnabled(context) && instance == null) setEnabled(context, true)
      }
    }

    fun setEnabled(context: Context, enabled: Boolean) {
      synchronized(stateLock) {
        val prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE)
        if (isEnabled(context) != enabled) prefs.edit().putBoolean("enabled", enabled).apply()
        if (!enabled) {
          restartRequested = false
          instance?.session?.cancel()
          context.stopService(Intent(context, PhoneShareService::class.java))
          context.getSystemService(NotificationManager::class.java).cancel(ID)
          prefs.edit().remove("error").apply()
          summary = "Off"
          return
        }
        instance?.let {
          if (it.session.closed) restartRequested = true
          return
        }
        try {
          prefs.edit().remove("error").apply()
          summary = "Starting"
          val intent = Intent(context, PhoneShareService::class.java)
          if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        } catch (error: Exception) {
          summary = error.message ?: "Could not start phone sharing"
          prefs.edit().putBoolean("enabled", false).putString("error", summary).apply()
          throw error
        }
      }
    }
  }

  private val session = PhoneShareSession()
  private val main = Handler(Looper.getMainLooper())
  private val healthCheck = Runnable { launchWork { checkHealth() } }
  private var started = false
  private var failedServerChecks = 0
  private var failedShareChecks = 0
  @Volatile private var failed = false

  override fun onCreate() {
    super.onCreate()
    synchronized(stateLock) { instance = this }
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
          NotificationChannel(CHANNEL, "Phone T3 remote access", NotificationManager.IMPORTANCE_LOW)
        )
      }
      promoteForeground()
    } catch (error: Exception) {
      fail(error.message ?: "Could not keep phone sharing in the foreground")
    }
  }

  protected open fun promoteForeground() {
    if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification("Starting"), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(ID, notification("Starting"))
  }

  protected open fun launchWork(work: () -> Unit) = session.start(work)
  protected open fun startTailnet() = TailnetEngine.start(applicationContext, IDLE_SECONDS)
  protected open fun tailnetCall(method: String, args: JSONObject = JSONObject()) = TailnetEngine.call(method, args)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (failed) { stopSelf(); return START_NOT_STICKY }
    if (intent?.action == STOP || !isEnabled(this)) {
      setEnabled(this, false)
      stopSelf()
      return START_NOT_STICKY
    }
    if (!started) {
      started = true
      launchWork { startSharing() }
    }
    return START_STICKY
  }

  private fun startSharing() {
    try {
      if (!serverReady()) {
        check(checkSelfPermission("com.termux.permission.RUN_COMMAND") == PackageManager.PERMISSION_GRANTED) { "Grant T3 the Termux permission first." }
        val command = Intent("com.termux.RUN_COMMAND").setClassName("com.termux", "com.termux.app.RunCommandService")
          .putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/home/.local/bin/t3-termux")
          .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("start"))
          .putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
          .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
          .putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "Start T3 on this phone")
        check(startService(command) != null) { "Could not start Termux." }
        var ready = false
        for (attempt in 0 until 30) {
          if (session.closed || !isEnabled(this)) return
          if (serverReady()) { ready = true; break }
          Thread.sleep(1000)
        }
        check(ready) { "The phone T3 server did not start." }
      }
      if (session.closed || !isEnabled(this)) return
      checkReply(startTailnet())
      val result = checkReply(tailnetCall("waitReady", JSONObject().put("timeoutMs", 15000)))
      check(result.optString("state") == "running") { "Sign in to built-in Tailscale first." }
      if (session.closed || !isEnabled(this)) return
      checkReply(tailnetCall("startPhoneShare"))
      if (session.closed || !isEnabled(this)) {
        tailnetCall("stopPhoneShare")
        return
      }
      update("Available on your tailnet")
    } catch (error: Exception) {
      main.post { fail(error.message ?: "Phone sharing failed") }
    }
  }

  private fun fail(text: String) {
    synchronized(stateLock) {
      if (instance !== this || session.closed || !isEnabled(this)) return
      failed = true
      session.cancel()
      summary = text
      getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", false).putString("error", text).apply()
      main.removeCallbacks(healthCheck)
      stopForeground(STOP_FOREGROUND_DETACH)
      getSystemService(NotificationManager::class.java).notify(ID, notification(text, ongoing = false))
      stopSelf()
    }
  }

  private fun checkHealth() {
    try {
      when (probeServer()) {
        ServerHealth.STOPPED -> {
          failedServerChecks = 0
          failedShareChecks = 0
          update("Server stopped; waiting for restart")
          return
        }
        ServerHealth.WAITING -> {
          failedServerChecks += 1
          if (failedServerChecks >= 3) main.post { fail("The phone T3 server is not responding. Check it and enable sharing again.") }
          else update("Waiting for phone T3 server")
          return
        }
        ServerHealth.READY -> failedServerChecks = 0
      }
      val result = checkReply(tailnetCall("status"))
      when (result.optString("state")) {
        "stopped" -> error("Built-in Tailscale stopped. Enable sharing again.")
        "needs-login", "needs-approval" -> {
          main.post { fail("Sign in or approve built-in Tailscale, then enable sharing again.") }
          return
        }
        "running" -> {
          checkReply(tailnetCall("startPhoneShare"))
          failedShareChecks = 0
          update("Available on your tailnet")
        }
        else -> update("Reconnecting to Tailscale")
      }
    } catch (error: Exception) {
      failedShareChecks += 1
      if (failedShareChecks >= 3) main.post { fail(error.message ?: "Phone sharing failed") }
      else update("Reconnecting phone sharing")
    }
  }

  private fun checkReply(raw: String): JSONObject {
    val reply = JSONObject(raw)
    check(reply.optBoolean("ok")) { reply.optString("error", "Built-in Tailscale failed") }
    return reply.optJSONObject("result") ?: JSONObject()
  }

  protected open fun serverReady() = probeServer() == ServerHealth.READY

  protected open fun serverConnection() =
    URL("http://127.0.0.1:3774/.well-known/t3/environment").openConnection() as HttpURLConnection

  protected open fun probeServer(): ServerHealth = try {
    val connection = serverConnection()
    try {
      connection.connectTimeout = 1000
      connection.readTimeout = 1000
      if (connection.responseCode == 200 && JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).has("environmentId")) ServerHealth.READY else ServerHealth.WAITING
    } finally { connection.disconnect() }
  } catch (error: ConnectException) {
    if (error.message?.contains("Connection refused", ignoreCase = true) == true) ServerHealth.STOPPED else ServerHealth.WAITING
  }
    catch (_: Exception) { ServerHealth.WAITING }

  private fun update(text: String) {
    main.post {
      synchronized(stateLock) {
        if (instance !== this || session.closed || !isEnabled(this)) return@post
        summary = text
        getSystemService(NotificationManager::class.java).notify(ID, notification(text))
        main.removeCallbacks(healthCheck)
        main.postDelayed(healthCheck, 15_000)
      }
    }
  }

  private fun notification(text: String, ongoing: Boolean = true): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val open = launch?.let { PendingIntent.getActivity(this, ID, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    val stop = PendingIntent.getService(this, ID, Intent(this, PhoneShareService::class.java).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    builder.setSmallIcon(R.drawable.phone_share_active).setContentTitle("T3 phone remote access")
      .setContentText(text).setContentIntent(open).setOngoing(ongoing).setAutoCancel(!ongoing).setOnlyAlertOnce(true)
    if (ongoing) builder.addAction(Notification.Action.Builder(0, "Stop", stop).build())
    return builder.build()
  }

  override fun onDestroy() {
    synchronized(stateLock) {
      main.removeCallbacks(healthCheck)
      session.close { tailnetCall("stopPhoneShare") }
      if (instance === this) {
        instance = null
        if (!failed) summary = if (!isEnabled(this)) "Off" else "Stopped; reopen T3 to reconnect"
        if (restartRequested && isEnabled(this)) {
          restartRequested = false
          val app = applicationContext
          main.post { try { restore(app) } catch (_: Exception) { /* Saved by setEnabled. */ } }
        }
      }
    }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
