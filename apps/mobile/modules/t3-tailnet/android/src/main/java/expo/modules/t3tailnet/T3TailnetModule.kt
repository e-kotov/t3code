package expo.modules.t3tailnet

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Built-in Tailscale for T3: an embedded node that forwards loopback ports to
 * tailnet servers. Calls return the engine's JSON reply, {"ok":…}.
 */
class T3TailnetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3Tailnet")

    OnCreate {
      appContext.reactContext?.let { TailnetEngine.watchLifecycle(it) }
    }

    Function("isAvailable") { TailnetNative.available }

    Function("getConfig") {
      val context = appContext.reactContext
        ?: return@Function mapOf<String, Any>("enabled" to false, "position" to "first", "signedIn" to false)
      mapOf<String, Any>(
        "enabled" to TailnetEngine.isEnabled(context),
        "position" to TailnetEngine.position(context),
        "signedIn" to TailnetEngine.isSignedIn(context),
      )
    }

    Function("setConfig") { enabled: Boolean, position: String ->
      appContext.reactContext?.let { TailnetEngine.setConfig(it, enabled, position) }
    }

    AsyncFunction("start") { idleTimeoutSeconds: Int, promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.resolve(unavailable())
      TailnetEngine.async({ TailnetEngine.start(context, idleTimeoutSeconds) }) { promise.resolve(it) }
    }

    AsyncFunction("stop") { promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.resolve(unavailable())
      PhoneShareService.setEnabled(context, false)
      TailnetEngine.async({ TailnetEngine.stop(context) }) { promise.resolve(it) }
    }

    AsyncFunction("logout") { promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.resolve(unavailable())
      PhoneShareService.setEnabled(context, false)
      TailnetEngine.async({ TailnetEngine.logout(context) }) { promise.resolve(it) }
    }

    AsyncFunction("status") { promise: Promise ->
      TailnetEngine.async({ TailnetEngine.call("status") }) { promise.resolve(it) }
    }

    AsyncFunction("waitReady") { timeoutMs: Int, promise: Promise ->
      TailnetEngine.async({ TailnetEngine.call("waitReady", JSONObject().put("timeoutMs", timeoutMs)) }) {
        promise.resolve(it)
      }
    }

    AsyncFunction("forward") { target: String, promise: Promise ->
      TailnetEngine.async({ TailnetEngine.call("forward", JSONObject().put("target", target)) }) {
        promise.resolve(it)
      }
    }

    AsyncFunction("logs") { promise: Promise ->
      TailnetEngine.async({ TailnetEngine.call("logs") }) { promise.resolve(it) }
    }

    Function("phoneShareStatus") {
      val context = appContext.reactContext
      mapOf("enabled" to (context != null && PhoneShareService.isEnabled(context)), "status" to PhoneShareService.status())
    }

    Function("setPhoneShareEnabled") { enabled: Boolean ->
      val context = appContext.reactContext ?: error("The app is not ready.")
      PhoneShareService.setEnabled(context, enabled)
    }
  }

  private fun unavailable() = JSONObject().put("ok", false).put("error", "The app is not ready.").toString()
}
