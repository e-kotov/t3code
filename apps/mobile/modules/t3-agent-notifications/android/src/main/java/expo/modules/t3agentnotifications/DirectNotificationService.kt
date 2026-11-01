package expo.modules.t3agentnotifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Owns a native read-only shell subscription while the React Native UI is suspended. */
class DirectNotificationService : Service() {
  companion object {
    private const val STORE = "t3-direct-notifications"
    private const val CHANNEL = "direct-server-connection"
    private const val ID = 73002
    private const val STOP = "t3.direct.STOP"
    @Volatile private var desired = emptyList<DirectConnection>()
    @Volatile private var scheme = "t3code"
    @Volatile private var summary = "Not running"
    @Volatile private var instance: DirectNotificationService? = null
    @Volatile var onStatusChanged: (() -> Unit)? = null
    private fun publishStatus(text: String) {
      summary = text
      onStatusChanged?.invoke()
    }

    fun isEnabled(context: Context): Boolean = context.getSharedPreferences(STORE, MODE_PRIVATE).getBoolean("enabled", false)
    fun notifyOnSubagentCompletion(context: Context): Boolean = context.getSharedPreferences(STORE, MODE_PRIVATE).getBoolean("notifyOnSubagentCompletion", false)
    fun setNotifyOnSubagentCompletion(context: Context, enabled: Boolean) {
      context.getSharedPreferences(STORE, MODE_PRIVATE).edit().putBoolean("notifyOnSubagentCompletion", enabled).apply()
    }
    fun status(): String = summary

    fun setEnabled(context: Context, enabled: Boolean) {
      context.getSharedPreferences(STORE, MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply()
      if (!enabled) {
        context.stopService(Intent(context, DirectNotificationService::class.java))
        desired = emptyList()
        publishStatus("Off")
      }
    }

    fun updateConnections(context: Context, json: String, appScheme: String) {
      val rows = JSONArray(json)
      val next = mutableListOf<DirectConnection>()
      for (index in 0 until rows.length()) {
        val row = rows.getJSONObject(index)
        val connection = DirectConnection(row.getString("environmentId"), row.getString("url"), row.getString("token"))
        // The JS boundary passes only paired direct routes. Never follow redirects with credentials.
        val uri = android.net.Uri.parse(connection.url)
        require(uri.scheme in setOf("ws", "wss") && uri.host != null && uri.userInfo == null)
        next.add(connection)
      }
      desired = next
      scheme = appScheme
      if (!isEnabled(context)) return
      if (next.isEmpty()) {
        context.stopService(Intent(context, DirectNotificationService::class.java))
        publishStatus("Waiting for a paired direct connection")
      } else if (instance != null) {
        instance?.let { service -> service.handler.post { if (!service.destroyed) service.reconcile() } }
      } else {
        // Called only while the app is visible; Android forbids arbitrary background starts.
        ContextCompat.startForegroundService(context, Intent(context, DirectNotificationService::class.java))
      }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val sessions = mutableMapOf<String, DirectSession>()
  private val client = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .connectTimeout(15, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
    .pingInterval(25, TimeUnit.SECONDS).build()
  private var destroyed = false

  override fun onCreate() {
    super.onCreate()
    instance = this
    if (Build.VERSION.SDK_INT >= 26) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, "Direct server connection", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val notification = notification("Connecting to paired servers")
    if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(ID, notification)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP) {
      setEnabled(this, false)
      stopSelf()
    } else if (isEnabled(this)) reconcile() else stopSelf()
    // Credentials stay in memory. Reopen the app after process death to prepare fresh paired routes.
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun reconcile() {
    check(Looper.myLooper() == Looper.getMainLooper())
    val wanted = desired.associateBy { it.environmentId }
    for ((id, session) in sessions.toMap()) {
      if (wanted[id] != session.connection) {
        sessions.remove(id)
        session.close()
      }
    }
    for ((id, connection) in wanted) {
      if (sessions[id] == null) {
        val session = DirectSession(connection)
        sessions[id] = session
        session.connect()
      }
    }
    updateStatus()
  }

  private fun notification(text: String): android.app.Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val open = launch?.let { PendingIntent.getActivity(this, ID, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    val stop = PendingIntent.getService(this, ID, Intent(this, DirectNotificationService::class.java).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(if (icon != 0) icon else android.R.drawable.ic_dialog_info)
      .setContentTitle("T3 direct notifications").setContentText(text)
      .setContentIntent(open).setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .addAction(0, "Stop", stop).build()
  }

  private fun updateStatus() {
    if (destroyed) return
    val connected = sessions.values.count { it.connected }
    val denied = sessions.values.count { it.denied }
    publishStatus(when {
      denied > 0 -> "$connected connected; $denied need re-pairing or updated server"
      connected == sessions.size && connected > 0 -> "Listening on $connected paired server(s)"
      else -> "$connected/${sessions.size} connected · retrying; keep SSH tunnel running"
    })
    getSystemService(NotificationManager::class.java).notify(ID, notification(summary))
  }

  override fun onDestroy() {
    destroyed = true
    instance = null
    handler.removeCallbacksAndMessages(null)
    sessions.values.forEach { it.close() }
    sessions.clear()
    client.dispatcher.cancelAll()
    client.connectionPool.evictAll()
    desired = emptyList()
    publishStatus(if (isEnabled(this)) "Stopped; reopen T3 to reconnect" else "Off")
    super.onDestroy()
  }

  private inner class DirectSession(val connection: DirectConnection) {
    var connected = false
    var denied = false
    private var closed = false
    private var failures = 0
    private var socket: WebSocket? = null
    private val events = DirectAgentEvents { notifyOnSubagentCompletion(this@DirectNotificationService) }
    private val seen = LinkedHashSet<String>()
    private val reconnect = Runnable { connect() }
    private var lastFrameAt = android.os.SystemClock.elapsedRealtime()
    private val heartbeat = object : Runnable {
      override fun run() {
        if (closed || !connected) return
        if (android.os.SystemClock.elapsedRealtime() - lastFrameAt > 60_000) {
          socket?.cancel()
          disconnected(false)
          return
        }
        socket?.send("{\"_tag\":\"Ping\"}")
        handler.postDelayed(this, 25_000)
      }
    }

    fun connect() {
      if (closed || destroyed || denied) return
      val request = Request.Builder().url(connection.url)
        .header("Authorization", "Bearer ${connection.token}").build()
      socket = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          handler.post {
            if (closed || socket !== webSocket) { webSocket.cancel(); return@post }
            connected = true
            failures = 0
            lastFrameAt = android.os.SystemClock.elapsedRealtime()
            webSocket.send(JSONObject().put("_tag", "Request").put("id", "direct-shell")
              .put("tag", "orchestration.subscribeShell").put("payload", JSONObject())
              .put("headers", JSONArray()).toString())
            handler.postDelayed(heartbeat, 25_000)
            updateStatus()
          }
        }
        override fun onMessage(webSocket: WebSocket, text: String) {
          handler.post {
            if (closed || socket !== webSocket) return@post
            lastFrameAt = android.os.SystemClock.elapsedRealtime()
            try {
              val decoded = org.json.JSONTokener(text).nextValue()
              val frames = if (decoded is JSONArray) decoded else JSONArray().put(decoded)
              for (index in 0 until frames.length()) handleFrame(webSocket, frames.getJSONObject(index))
            } catch (_: Exception) {
              // Do not log payloads or authenticated URLs on malformed server data.
              webSocket.cancel()
              disconnected(true)
            }
          }
        }
        override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
          handler.post {
            if (!closed && socket === webSocket) disconnected(response?.code in listOf(401, 403, 426))
          }
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          handler.post { if (!closed && socket === webSocket) disconnected(false) }
        }
      })
    }

    private fun handleFrame(webSocket: WebSocket, frame: JSONObject) {
      when (frame.optString("_tag")) {
        "Chunk" -> {
          if (frame.optString("requestId") != "direct-shell") return
          val values = frame.getJSONArray("values")
          for (index in 0 until values.length()) {
            for (alert in events.accept(values.getJSONObject(index))) {
              if (seen.add(alert.key)) AgentNotifications.postDirectAlert(this@DirectNotificationService, scheme, connection.environmentId, alert)
              while (seen.size > 128) seen.remove(seen.first())
            }
          }
          webSocket.send(JSONObject().put("_tag", "Ack").put("requestId", "direct-shell").toString())
        }
        "Exit", "Defect", "ClientProtocolError" -> { webSocket.cancel(); disconnected(true) }
      }
    }

    private fun disconnected(permanent: Boolean) {
      connected = false
      denied = permanent
      socket?.cancel()
      socket = null
      handler.removeCallbacks(heartbeat)
      handler.removeCallbacks(reconnect)
      if (!closed && !denied) {
        val delay = (1_000L shl failures.coerceAtMost(5)).coerceAtMost(30_000L)
        failures++
        handler.postDelayed(reconnect, delay)
      }
      updateStatus()
    }

    fun close() {
      closed = true
      handler.removeCallbacks(reconnect)
      handler.removeCallbacks(heartbeat)
      socket?.cancel()
      socket = null
    }
  }
}

private data class DirectConnection(val environmentId: String, val url: String, val token: String)
