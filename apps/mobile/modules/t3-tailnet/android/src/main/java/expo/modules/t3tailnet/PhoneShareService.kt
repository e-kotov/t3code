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
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Keeps only the phone's paired T3 endpoint available on its private tailnet. */
class PhoneShareService : Service() {
  companion object {
    private const val PREFS = "t3-phone-share"
    private const val CHANNEL = "phone-t3-sharing"
    private const val ID = 73003
    private const val STOP = "t3.phone-share.STOP"
    @Volatile private var summary = "Off"

    fun isEnabled(context: Context) = context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("enabled", false)
    fun status() = summary

    fun setEnabled(context: Context, enabled: Boolean) {
      val prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE)
      check(prefs.edit().putBoolean("enabled", enabled).commit()) { "Could not save sharing state." }
      if (!enabled) {
        context.stopService(Intent(context, PhoneShareService::class.java))
        summary = "Off"
        return
      }
      try {
        summary = "Starting"
        val intent = Intent(context, PhoneShareService::class.java)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } catch (error: Exception) {
        prefs.edit().putBoolean("enabled", false).apply()
        summary = error.message ?: "Could not start phone sharing"
        throw error
      }
    }
  }

  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var destroyed = false
  @Volatile private var failed = false

  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= 26) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, "Phone T3 remote access", NotificationManager.IMPORTANCE_LOW)
      )
    }
    if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification("Starting"), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(ID, notification("Starting"))
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP || !isEnabled(this)) {
      setEnabled(this, false)
      stopSelf()
      return START_NOT_STICKY
    }
    executor.execute { startSharing() }
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
          if (destroyed || !isEnabled(this)) return
          if (serverReady()) { ready = true; break }
          Thread.sleep(1000)
        }
        check(ready) { "The phone T3 server did not start." }
      }
      if (destroyed || !isEnabled(this)) return
      checkReply(TailnetEngine.start(this, 0))
      val result = checkReply(TailnetEngine.call("waitReady", JSONObject().put("timeoutMs", 15000)))
      check(result.optString("state") == "running") { "Sign in to built-in Tailscale first." }
      if (destroyed || !isEnabled(this)) return
      checkReply(TailnetEngine.call("startPhoneShare"))
      if (destroyed || !isEnabled(this)) {
        TailnetEngine.call("stopPhoneShare")
        return
      }
      update("Available on your tailnet")
    } catch (error: Exception) {
      if (!destroyed) {
        failed = true
        update(error.message ?: "Phone sharing failed")
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("enabled", false).apply()
        stopSelf()
      }
    }
  }

  private fun checkReply(raw: String): JSONObject {
    val reply = JSONObject(raw)
    check(reply.optBoolean("ok")) { reply.optString("error", "Built-in Tailscale failed") }
    return reply.optJSONObject("result") ?: JSONObject()
  }

  private fun serverReady(): Boolean = try {
    val connection = URL("http://127.0.0.1:3774/.well-known/t3/environment").openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = 1000
      connection.readTimeout = 1000
      connection.responseCode == 200 && JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).has("environmentId")
    } finally { connection.disconnect() }
  } catch (_: Exception) { false }

  private fun update(text: String) {
    summary = text
    getSystemService(NotificationManager::class.java).notify(ID, notification(text))
  }

  private fun notification(text: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val open = launch?.let { PendingIntent.getActivity(this, ID, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    val stop = PendingIntent.getService(this, ID, Intent(this, PhoneShareService::class.java).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
    return builder.setSmallIcon(if (icon != 0) icon else android.R.drawable.ic_dialog_info).setContentTitle("T3 phone remote access")
      .setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
      .addAction(Notification.Action.Builder(0, "Stop", stop).build()).build()
  }

  override fun onDestroy() {
    destroyed = true
    executor.shutdownNow()
    TailnetEngine.call("stopPhoneShare")
    TailnetEngine.call("setIdleTimeout", JSONObject().put("seconds", 300))
    if (!failed) summary = if (!isEnabled(this)) "Off" else "Stopped; reopen T3 to reconnect"
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
