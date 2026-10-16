package expo.modules.t3termuxcommand

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// Intent keys and result fields: https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent
private const val PERMISSION = "com.termux.permission.RUN_COMMAND"
private const val LIMIT = 100_000
private const val PROBE = "__termux_setup_probe__"

/** Results live outside React so Termux can finish after Android recreates the app. */
internal object TermuxCommands {
  private fun prefs(context: Context) = context.getSharedPreferences("t3-device-commands", Context.MODE_PRIVATE)
  fun document(context: Context) = JSONObject(prefs(context).getString("document", "{\"commands\":[]}")!!)
  fun runs(context: Context) = JSONArray(prefs(context).getString("runs", "[]")!!)

  @Synchronized fun save(context: Context, raw: String) {
    val document = JSONObject(raw)
    val commands = document.getJSONArray("commands")
    require(commands.length() <= 50) { "At most 50 commands are supported." }
    val ids = mutableSetOf<String>()
    for (index in 0 until commands.length()) {
      val command = commands.getJSONObject(index)
      val id = command.getString("id")
      require(id.isNotBlank() && id != PROBE && ids.add(id)) { "Command IDs must be unique." }
      require(command.getString("name").isNotBlank() && command.getString("command").isNotBlank()) { "A name and command are required." }
    }
    check(prefs(context).edit().putString("document", document.toString()).commit()) { "Could not save commands." }
  }

  @Synchronized fun remember(context: Context, run: JSONObject) {
    val previous = runs(context)
    val kept = mutableListOf<JSONObject>()
    for (index in 0 until previous.length()) {
      val item = previous.getJSONObject(index)
      if (item.getString("runId") != run.getString("runId")) kept.add(item)
    }
    // Keep running tasks and the latest 20 completed results.
    val finished = kept.filter { it.getString("status") != "running" }.takeLast(19)
    val next = JSONArray()
    kept.filter { it.getString("status") == "running" }.forEach { next.put(it) }
    finished.forEach { next.put(it) }
    next.put(run)
    check(prefs(context).edit().putString("runs", next.toString()).commit()) { "Could not save command status." }
  }

  @Synchronized fun start(context: Context, commandId: String): JSONObject {
    check(context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED) { "Grant T3 permission to run Termux commands in Android Settings." }
    val commands = document(context).getJSONArray("commands")
    val command = if (commandId == PROBE) JSONObject().put("id", PROBE).put("name", "Termux connection test").put("command", "printf 'Termux is ready\\n'")
      else (0 until commands.length()).map { commands.getJSONObject(it) }.find { it.getString("id") == commandId }
        ?: error("This command no longer exists.")
    val previous = runs(context)
    for (index in 0 until previous.length()) {
      val run = previous.getJSONObject(index)
      if (run.getString("commandId") == commandId && run.getString("status") == "running") return run
    }
    val runId = UUID.randomUUID().toString()
    val run = JSONObject().put("runId", runId).put("commandId", commandId)
      .put("commandName", command.getString("name")).put("status", "running")
      .put("startedAt", System.currentTimeMillis()).put("finishedAt", JSONObject.NULL)
      .put("exitCode", JSONObject.NULL).put("output", "").put("outputTruncated", false).put("error", JSONObject.NULL)
    remember(context, run)
    val callback = Intent(context, TermuxResultReceiver::class.java).setData(Uri.parse("t3-command-result:$runId"))
    val flags = PendingIntent.FLAG_ONE_SHOT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    val pending = PendingIntent.getBroadcast(context, 0, callback, flags)
    try {
      val intent = Intent("com.termux.RUN_COMMAND").setClassName("com.termux", "com.termux.app.RunCommandService")
        .putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
        .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-lc", command.getString("command")))
        .putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
        .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
        .putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", command.getString("name"))
        .putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pending)
      check(context.startService(intent) != null) { "Termux is not installed or its command service is unavailable." }
    } catch (cause: Exception) {
      pending.cancel()
      run.put("status", "failed").put("finishedAt", System.currentTimeMillis()).put("error", cause.message ?: "Could not start Termux.")
      remember(context, run)
    }
    return run
  }

  @Synchronized fun receive(context: Context, intent: Intent) {
    val runId = intent.data?.schemeSpecificPart ?: return
    val previous = runs(context)
    val run = (0 until previous.length()).map { previous.getJSONObject(it) }.find { it.getString("runId") == runId && it.getString("status") == "running" } ?: return
    val result = intent.getBundleExtra("result")
    val stdout = result?.getString("stdout").orEmpty()
    val stderr = result?.getString("stderr").orEmpty()
    val output = stdout + (if (stdout.isNotEmpty() && stderr.isNotEmpty()) "\n" else "") + stderr
    val internalError = result?.getInt("err", Activity.RESULT_OK) ?: 0
    val exitCode = if (result?.containsKey("exitCode") == true) result.getInt("exitCode") else null
    val truncated = output.length > LIMIT ||
      (result?.get("stdout_original_length")?.toString()?.toLongOrNull() ?: 0) > stdout.length ||
      (result?.get("stderr_original_length")?.toString()?.toLongOrNull() ?: 0) > stderr.length
    val error = if (internalError != Activity.RESULT_OK || exitCode == null)
      result?.getString("errmsg")?.takeIf { it.isNotBlank() } ?: "Termux returned no successful result. Check allow-external-apps and Termux permissions."
      else null
    run.put("output", output.takeLast(LIMIT)).put("outputTruncated", truncated)
      .put("exitCode", exitCode ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL)
      .put("status", if (error == null && exitCode == 0) "succeeded" else "failed").put("finishedAt", System.currentTimeMillis())
    remember(context, run)
  }

  @Synchronized fun clearWaiting(context: Context, runId: String) {
    val previous = runs(context)
    val run = (0 until previous.length()).map { previous.getJSONObject(it) }.find { it.getString("runId") == runId && it.getString("status") == "running" } ?: return
    run.put("status", "failed").put("finishedAt", System.currentTimeMillis())
      .put("error", "Waiting status cleared. This does not cancel the Termux command.")
    remember(context, run)
  }
}

class TermuxResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val pending = goAsync()
    Thread {
      try { if (intent.data?.scheme == "t3-utility-result") DeviceUtilities.receive(context, intent) else TermuxCommands.receive(context, intent) } finally { pending.finish() }
    }.start()
  }
}

class T3TermuxCommandModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3TermuxCommand")
    Function("utilitiesSnapshot") { DeviceUtilities.snapshot(appContext.reactContext ?: error("The app is not ready.")) }
    Function("utilitiesImport") { DeviceUtilities.importConfig(appContext.reactContext ?: error("The app is not ready.")) }
    Function("utilitiesCheck") { serviceId: String, revision: Int -> DeviceUtilities.check(appContext.reactContext ?: error("The app is not ready."), serviceId, revision) }
    Function("utilitiesAction") { serviceId: String, actionId: String, revision: Int -> DeviceUtilities.action(appContext.reactContext ?: error("The app is not ready."), serviceId, actionId, revision) }
    Function("getState") {
      val context = appContext.reactContext ?: error("The app is not ready.")
      val installed = try { context.packageManager.getPackageInfo("com.termux", 0); true } catch (_: PackageManager.NameNotFoundException) { false }
      JSONObject().put("installed", installed)
        .put("permissionGranted", context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED)
        .put("commands", TermuxCommands.document(context).getJSONArray("commands"))
        .put("runs", TermuxCommands.runs(context)).toString()
    }
    Function("save") { raw: String -> TermuxCommands.save(appContext.reactContext ?: error("The app is not ready."), raw) }
    Function("run") { commandId: String -> TermuxCommands.start(appContext.reactContext ?: error("The app is not ready."), commandId).toString() }
    Function("testConnection") { TermuxCommands.start(appContext.reactContext ?: error("The app is not ready."), PROBE).toString() }
    Function("clearWaiting") { runId: String -> TermuxCommands.clearWaiting(appContext.reactContext ?: error("The app is not ready."), runId) }
  }
}
