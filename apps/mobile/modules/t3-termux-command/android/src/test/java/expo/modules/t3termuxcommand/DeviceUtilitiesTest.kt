package expo.modules.t3termuxcommand

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DeviceUtilitiesTest {
  private val context: Context get() = RuntimeEnvironment.getApplication()
  private fun prefs() = context.getSharedPreferences("t3-device-utilities", Context.MODE_PRIVATE)
  @Before fun reset() { prefs().edit().clear().commit() }
  private fun run(id: String = "r", deadline: Long = System.currentTimeMillis() + 60000) = JSONObject()
    .put("runId", id).put("revision", 1).put("serviceId", "vpn").put("actionId", JSONObject.NULL)
    .put("startedAt", System.currentTimeMillis()).put("finishedAt", JSONObject.NULL).put("deadlineAt", deadline)
    .put("stdout", "").put("stderr", "").put("exitCode", JSONObject.NULL).put("error", JSONObject.NULL).put("truncated", false)
  private fun seed(run: JSONObject, previous: JSONObject? = null) {
    val state = JSONObject(DeviceUtilities.snapshot(context)).put("revision", 1).put("checks", JSONArray().put(run))
    if (previous != null) state.put("previousChecks", JSONArray().put(previous))
    prefs().edit().putString("state", state.toString()).commit()
  }
  private fun callback(id: String = "r", stdout: String = "{}", stderr: String = "diagnostic", original: Int = stdout.length) = Intent().setData(Uri.parse("t3-utility-result:$id")).putExtra("result", Bundle().apply {
    putString("stdout", stdout); putString("stderr", stderr); putInt("exitCode", 0); putInt("err", -1); putInt("stdout_original_length", original)
  })
  @Test fun separatesJsonFromDiagnosticStderrAndRejectsLateCallbacks() {
    seed(run())
    DeviceUtilities.receive(context, callback(stdout = "{\"version\":1}"))
    DeviceUtilities.receive(context, callback(stdout = "late"))
    val saved = JSONObject(DeviceUtilities.snapshot(context)).getJSONArray("checks").getJSONObject(0)
    assertEquals("{\"version\":1}", saved.getString("stdout"))
    assertEquals("diagnostic", saved.getString("stderr"))
    seed(run("new"))
    DeviceUtilities.receive(context, callback(stdout = "old result"))
    assertTrue(JSONObject(DeviceUtilities.snapshot(context)).getJSONArray("checks").getJSONObject(0).isNull("finishedAt"))
  }
  @Test fun detectsUpstreamTruncationBeforeParsing() {
    seed(run())
    DeviceUtilities.receive(context, callback(stdout = "tail", original = 80000))
    assertTrue(JSONObject(DeviceUtilities.snapshot(context)).getJSONArray("checks").getJSONObject(0).getBoolean("truncated"))
  }
  @Test fun expiresLostCallbacksWithoutKeepingTheServiceLockedForever() {
    seed(run(deadline = System.currentTimeMillis() - 20000))
    val saved = JSONObject(DeviceUtilities.snapshot(context)).getJSONArray("checks").getJSONObject(0)
    assertFalse(saved.isNull("finishedAt"))
    assertTrue(saved.getString("error").contains("deadline"))
    DeviceUtilities.receive(context, callback())
    assertTrue(JSONObject(DeviceUtilities.snapshot(context)).getJSONArray("checks").getJSONObject(0).getString("error").contains("deadline"))
  }
  @Test fun preservesTheLastObservationWhileABoundedProbeRuns() {
    val previous = run("old").put("finishedAt", 20).put("stdout", "previous observation")
    seed(run(), previous)
    val snapshot = JSONObject(DeviceUtilities.snapshot(context))
    assertEquals("previous observation", snapshot.getJSONArray("checks").getJSONObject(0).getString("stdout"))
    assertFalse(snapshot.has("previousChecks"))
  }
  @Test fun rejectsAmbiguousOrUnboundedConfiguration() {
    val service = """{"id":"vpn","name":"VPN","target":"owner","check":"status"}"""
    assertThrows(IllegalArgumentException::class.java) { DeviceUtilities.validateConfig("""{"version":1,"services":[$service,$service]}""") }
    assertThrows(IllegalArgumentException::class.java) { DeviceUtilities.validateConfig("""{"version":2,"services":[]}""") }
    assertEquals(1, DeviceUtilities.validateConfig("""{"version":1,"services":[$service]}""").getJSONArray("services").length())
  }
}
