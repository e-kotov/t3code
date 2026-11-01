package expo.modules.t3agentnotifications

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3AgentNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3AgentNotifications")
    Events("onDirectNotificationStatus")
    OnCreate {
      DirectNotificationService.onStatusChanged = { sendEvent("onDirectNotificationStatus", emptyMap<String, String>()) }
    }
    OnDestroy {
      DirectNotificationService.onStatusChanged = null
    }

    Function("configure") {
        deviceId: String,
        userId: String,
        scheme: String,
        ongoingEnabled: Boolean
      ->
      appContext.reactContext?.let {
        AgentNotifications.configure(it, deviceId, userId, scheme, ongoingEnabled)
      }
    }

    Function("directNotificationsEnabled") {
      appContext.reactContext?.let { DirectNotificationService.isEnabled(it) } ?: false
    }

    Function("setDirectNotificationsEnabled") { enabled: Boolean ->
      appContext.reactContext?.let { DirectNotificationService.setEnabled(it, enabled) }
    }

    Function("notifyOnSubagentCompletion") {
      appContext.reactContext?.let { DirectNotificationService.notifyOnSubagentCompletion(it) } ?: false
    }
    Function("setNotifyOnSubagentCompletion") { enabled: Boolean ->
      appContext.reactContext?.let { DirectNotificationService.setNotifyOnSubagentCompletion(it, enabled) }
    }

    Function("updateDirectNotificationConnections") { connectionsJson: String, scheme: String ->
      appContext.reactContext?.let { DirectNotificationService.updateConnections(it, connectionsJson, scheme) }
    }

    Function("directNotificationStatus") {
      DirectNotificationService.status()
    }

    Function("openBatteryOptimizationSettings") {
      appContext.reactContext?.startActivity(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    Function("clear") {
      appContext.reactContext?.let { AgentNotifications.clear(it) }
    }

    Function("showShowcaseActivity") { scheme: String, data: Map<String, String> ->
      appContext.reactContext?.let { AgentNotifications.showcase(it, scheme, data) }
    }

    Function("setThreadOnScreen") { path: String? ->
      AgentNotifications.setThreadOnScreen(path)
    }

    Function("openLiveUpdateSettings") {
      val context = appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < 36) {
        false
      } else {
        try {
          context.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
              .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
    }
  }
}
