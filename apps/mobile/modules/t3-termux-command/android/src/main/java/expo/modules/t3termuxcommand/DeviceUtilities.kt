package expo.modules.t3termuxcommand

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Device-owned monitoring. It never touches ordinary command definitions or history. */
internal object DeviceUtilities {
  private const val HOME = "/data/data/com.termux/files/home"
  private const val BIN = "/data/data/com.termux/files/usr/bin"
  private const val LIMIT = 32768
  private fun prefs(context: Context) = context.getSharedPreferences("t3-device-utilities", Context.MODE_PRIVATE)
  private fun read(context: Context): JSONObject = JSONObject(prefs(context).getString("state", null) ?: """{"config":null,"configPath":"$HOME/.config/t3-utilities/dashboard.json","revision":0,"error":null,"checks":[],"actions":[]}""")
  private fun write(context: Context, state: JSONObject) {
    check(prefs(context).edit().putString("state", state.toString()).commit()) { "Could not save utility observations." }
  }
  private fun items(array: JSONArray) = (0 until array.length()).map { array.getJSONObject(it) }
  private fun unique(array: JSONArray) {
    val ids = items(array).map { it.getString("id") }
    require(ids.all { it.isNotBlank() && it.length <= 256 } && ids.toSet().size == ids.size) { "Utility IDs must be unique and nonempty." }
  }
  internal fun validateConfig(raw: String): JSONObject {
    require(raw.toByteArray().size <= 65536) { "Configuration exceeds 64 KiB." }
    val config = JSONObject(raw)
    require(config.getInt("version") == 1) { "Unsupported utilities version." }
    val services = config.getJSONArray("services")
    require(services.length() <= 20) { "At most 20 utility services." }
    unique(services)
    for (service in items(services)) {
      for (key in listOf("name", "target", "check")) require(service.getString(key).isNotBlank() && service.getString(key).length <= if (key == "check") 4096 else 256) { "Invalid $key." }
      val interval = service.optInt("intervalSeconds", 60)
      require(interval == 0 || interval in 10..86400) { "Polling interval must be zero or at least 10 seconds." }
      require(service.optInt("staleAfterSeconds", 120) in 10..86400 && service.optInt("timeoutSeconds", 30) in 1..120) { "Invalid check timing." }
      val actions = service.optJSONArray("actions") ?: JSONArray()
      require(actions.length() <= 10) { "At most 10 actions per service." }
      unique(actions)
      for (action in items(actions)) {
        require(action.getString("name").isNotBlank() && action.getString("name").length <= 256) { "Invalid action name." }
        require(action.getString("command").isNotBlank() && action.getString("command").length <= 4096) { "Invalid action command." }
        require(action.getString("scope") in listOf("device", "shared")) { "Actions must declare device or shared scope." }
        require(action.optInt("timeoutSeconds", 120) in 1..600) { "Invalid action timeout." }
      }
    }
    return config
  }
  private fun service(state: JSONObject, id: String): JSONObject = items(state.getJSONObject("config").getJSONArray("services")).find { it.getString("id") == id && it.optBoolean("enabled", true) } ?: error("Utility service is unavailable.")
  private fun replace(state: JSONObject, bucket: String, run: JSONObject) {
    val retained = items(state.getJSONArray(bucket)).filter { it.getString("serviceId") != run.getString("serviceId") }
    state.put(bucket, JSONArray(retained + run))
  }
  private fun running(run: JSONObject) = run.isNull("finishedAt")
  @Synchronized private fun expiredState(context: Context): JSONObject {
    val state = read(context)
    val now = System.currentTimeMillis()
    var changed = false
    for (bucket in listOf("checks", "actions")) for (run in items(state.getJSONArray(bucket))) {
      // The Termux timeout process owns a hard deadline independent of React/Android timers.
      if (running(run) && now > run.getLong("deadlineAt") + 10000) {
        run.put("finishedAt", now).put("error", "Termux deadline passed without a result; current health unknown.")
        changed = true
      }
    }
    val importRun = state.optJSONObject("import")
    if (importRun != null && running(importRun) && now > importRun.getLong("deadlineAt") + 10000) {
      importRun.put("finishedAt", now)
      state.put("error", "Configuration import timed out. Check Termux permission and timeout/coreutils installation.")
      changed = true
    }
    if (changed) write(context, state)
    return state
  }
  @Synchronized fun snapshot(context: Context): String {
    val state = expiredState(context)
    val previous = items(state.optJSONArray("previousChecks") ?: JSONArray())
    val publicState = JSONObject(state.toString())
    publicState.remove("previousChecks")
    publicState.put("checks", JSONArray(items(state.getJSONArray("checks")).map { run ->
      if (running(run)) previous.find { it.getString("serviceId") == run.getString("serviceId") } ?: run else run
    }))
    return publicState.toString()
  }
  private fun launch(context: Context, state: JSONObject, serviceId: String, actionId: String?, command: String, timeout: Int, bucket: String): JSONObject {
    check(context.checkSelfPermission("com.termux.permission.RUN_COMMAND") == PackageManager.PERMISSION_GRANTED) { "Grant T3 the Termux RUN_COMMAND permission." }
    val runId = UUID.randomUUID().toString()
    val now = System.currentTimeMillis()
    val run = JSONObject().put("runId", runId).put("revision", state.getInt("revision")).put("serviceId", serviceId).put("actionId", actionId ?: JSONObject.NULL)
      .put("startedAt", now).put("finishedAt", JSONObject.NULL).put("deadlineAt", now + (timeout + 5L) * 1000)
      .put("exitCode", JSONObject.NULL).put("error", JSONObject.NULL).put("stdout", "").put("stderr", "").put("truncated", false)
    if (bucket == "import") state.put("import", run) else replace(state, bucket, run)
    write(context, state)
    val callback = Intent(context, TermuxResultReceiver::class.java).setData(Uri.parse("t3-utility-result:$runId"))
    val flags = PendingIntent.FLAG_ONE_SHOT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    val pending = PendingIntent.getBroadcast(context, 0, callback, flags)
    try {
      // timeout must be installed in Termux (coreutils). A missing tool fails closed.
      val intent = Intent("com.termux.RUN_COMMAND").setClassName("com.termux", "com.termux.app.RunCommandService")
        .putExtra("com.termux.RUN_COMMAND_PATH", "$BIN/timeout")
        .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-k", "5", timeout.toString(), "$BIN/bash", "-lc", command))
        .putExtra("com.termux.RUN_COMMAND_WORKDIR", HOME)
        .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
        .putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "T3 utilities: $serviceId")
        .putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pending)
      check(context.startService(intent) != null) { "Termux command service unavailable." }
    } catch (cause: Exception) {
      pending.cancel()
      run.put("finishedAt", System.currentTimeMillis()).put("error", cause.message ?: "Could not start Termux.")
      if (bucket == "import") state.put("error", run.getString("error"))
      write(context, state)
    }
    return run
  }
  @Synchronized fun importConfig(context: Context) {
    val state = expiredState(context)
    check(items(state.getJSONArray("actions")).none { running(it) } && state.optJSONObject("import")?.let { running(it) } != true) { "Wait for the active utility operation." }
    state.put("error", "Importing configuration from Termux…")
    // Fixed path/command: connected environments cannot supply a local shell command.
    launch(context, state, "__config__", null, "cat -- \"\$HOME/.config/t3-utilities/dashboard.json\"", 10, "import")
  }
  @Synchronized fun check(context: Context, serviceId: String, revision: Int, force: Boolean = false) {
    val state = expiredState(context)
    require(state.getInt("revision") == revision && state.isNull("error")) { "Reload the utility configuration." }
    val service = service(state, serviceId)
    val previous = items(state.getJSONArray("checks")).find { it.getString("serviceId") == serviceId }
    if (previous != null && (running(previous) || (!force && System.currentTimeMillis() - previous.getLong("startedAt") < 10000))) return
    if (items(state.getJSONArray("actions")).any { it.getString("serviceId") == serviceId && running(it) }) return
    if (previous != null && !running(previous)) {
      val retained = items(state.optJSONArray("previousChecks") ?: JSONArray()).filter { it.getString("serviceId") != serviceId }
      state.put("previousChecks", JSONArray(retained + previous))
    }
    launch(context, state, serviceId, null, service.getString("check"), service.optInt("timeoutSeconds", 30), "checks")
  }
  @Synchronized fun action(context: Context, serviceId: String, actionId: String, revision: Int) {
    val state = expiredState(context)
    require(state.getInt("revision") == revision && state.isNull("error")) { "Configuration changed; reopen the action." }
    val service = service(state, serviceId)
    val action = items(service.optJSONArray("actions") ?: JSONArray()).find { it.getString("id") == actionId } ?: error("Action is unavailable.")
    check(items(state.getJSONArray("actions")).none { it.getString("serviceId") == serviceId && running(it) }) { "Action already running." }
    // Android cannot signal another app's process. Wait for bounded probes before an action.
    check(items(state.getJSONArray("checks")).none { it.getString("serviceId") == serviceId && running(it) }) { "Wait for the current health check to finish." }
    state.put("checks", JSONArray(items(state.getJSONArray("checks")).filter { it.getString("serviceId") != serviceId }))
    state.put("previousChecks", JSONArray(items(state.optJSONArray("previousChecks") ?: JSONArray()).filter { it.getString("serviceId") != serviceId }))
    launch(context, state, serviceId, actionId, action.getString("command"), action.optInt("timeoutSeconds", 120), "actions")
  }
  @Synchronized fun receive(context: Context, intent: Intent) {
    val state = read(context)
    val runId = intent.data?.schemeSpecificPart ?: return
    var bucket = ""
    var run: JSONObject? = null
    for (candidate in listOf("checks", "actions")) {
      val found = items(state.getJSONArray(candidate)).find { it.getString("runId") == runId && running(it) }
      if (found != null) { bucket = candidate; run = found }
    }
    val importRun = state.optJSONObject("import")
    if (importRun != null && importRun.getString("runId") == runId && running(importRun)) { bucket = "import"; run = importRun }
    val resultRun = run ?: return // Old generations, expired runs and duplicate callbacks are ignored.
    if (resultRun.getInt("revision") != state.getInt("revision")) return
    val result = intent.getBundleExtra("result")
    val stdout = result?.getString("stdout").orEmpty()
    val stderr = result?.getString("stderr").orEmpty()
    val exit = if (result?.containsKey("exitCode") == true) result.getInt("exitCode") else null
    val limit = if (bucket == "import") 65536 else LIMIT
    val truncated = stdout.toByteArray().size > limit || stderr.toByteArray().size > LIMIT ||
      (result?.get("stdout_original_length")?.toString()?.toLongOrNull() ?: 0) > stdout.length ||
      (result?.get("stderr_original_length")?.toString()?.toLongOrNull() ?: 0) > stderr.length
    val error = if (result == null || result.getInt("err", Activity.RESULT_OK) != Activity.RESULT_OK || exit == null) result?.getString("errmsg") ?: "Termux returned no result. Check permissions and coreutils/timeout." else if (exit == 124 || exit == 137) "Execution deadline exceeded." else null
    resultRun.put("stdout", stdout.take(LIMIT)).put("stderr", stderr.take(LIMIT)).put("truncated", truncated)
      .put("exitCode", exit ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL).put("finishedAt", System.currentTimeMillis())
    if (bucket == "import") {
      try {
        require(error == null && exit == 0 && !truncated) { error ?: "Configuration import failed or was truncated." }
        state.put("config", validateConfig(stdout)).put("revision", state.getInt("revision") + 1)
          .put("checks", JSONArray()).put("previousChecks", JSONArray()).put("actions", JSONArray()).put("error", JSONObject.NULL)
      } catch (cause: Exception) { state.put("error", cause.message ?: "Invalid utility configuration.") }
    }
    write(context, state)
    if (bucket == "actions" && state.isNull("error")) {
      try { check(context, resultRun.getString("serviceId"), state.getInt("revision"), true) }
      catch (cause: Exception) { val failed = read(context); failed.put("error", "Could not recheck after action: ${cause.message}"); write(context, failed) }
    }
  }
}
