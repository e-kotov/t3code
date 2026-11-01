package expo.modules.t3agentnotifications

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class DirectAgentEventsTest {
  private fun thread(status: String, run: String = "run", request: String? = null): JSONObject = JSONObject()
    .put("id", "thread").put("title", "Work").put("latestRunId", run).put("status", status)
    .put("deletedAt", JSONObject.NULL).put("archivedAt", JSONObject.NULL)
    .put("pendingRuntimeRequest", request?.let { JSONObject().put("id", it).put("kind", "approval") } ?: JSONObject.NULL)
  private fun snapshot(vararg threads: JSONObject) = JSONObject().put("kind", "snapshot")
    .put("snapshot", JSONObject().put("threads", JSONArray(threads)))
  private fun update(thread: JSONObject) = JSONObject().put("kind", "thread.updated")
    .put("location", "active").put("thread", thread)

  @Test fun initialCompletedAndPendingThreadsAreQuiet() {
    val events = DirectAgentEvents()
    assertTrue(events.accept(snapshot(thread("completed"), thread("waiting", "other", "old-approval"))).isEmpty())
  }
  @Test fun completionAndApprovalAlertsAreDeduplicatedAcrossUpdatesAndReconnects() {
    val events = DirectAgentEvents()
    events.accept(snapshot(thread("running")))
    val finished = events.accept(update(thread("completed")))
    assertEquals("Agent finished", finished.single().body)
    assertTrue(events.accept(update(thread("completed"))).isEmpty())
    assertTrue(events.accept(snapshot(thread("completed"))).isEmpty())
    val approval = events.accept(update(thread("waiting", "next", "approval-1")))
    assertEquals("Agent needs approval", approval.single().body)
    assertTrue(events.accept(update(thread("waiting", "next", "approval-1"))).isEmpty())
  }
  @Test fun reconnectCatchesCompletionWhileDisconnectedWithoutAlertingForHistoricalUnknownThreads() {
    val events = DirectAgentEvents()
    events.accept(snapshot(thread("running")))
    assertEquals(1, events.accept(snapshot(thread("completed"))).size)
    val historical = thread("completed", "old").put("id", "another-thread")
    assertTrue(events.accept(snapshot(thread("completed"), historical)).isEmpty())
  }
  @Test fun errorsAlertButCancellationAndArchivedThreadsDoNot() {
    val events = DirectAgentEvents()
    events.accept(snapshot(thread("running")))
    assertEquals("Agent stopped with an error", events.accept(update(thread("failed"))).single().body)
    assertTrue(events.accept(update(thread("cancelled", "next"))).isEmpty())
    assertTrue(events.accept(update(thread("completed", "next").put("archivedAt", "2026-10-11"))).isEmpty())
  }
  @Test fun mainThreadOnlySuppressesOnlySubagentCompletionsAndCanBeChangedWhileListening() {
    var notifySubagents = false
    val events = DirectAgentEvents { notifySubagents }
    fun subagent(status: String, run: String = "run", request: String? = null) =
      thread(status, run, request).put("lineage", JSONObject().put("relationshipToParent", "subagent"))
    events.accept(snapshot(subagent("running")))
    assertTrue(events.accept(update(subagent("completed"))).isEmpty())
    assertEquals("Agent needs approval", events.accept(update(subagent("waiting", "next", "approval"))).single().body)
    val input = subagent("waiting", "next", "input")
    input.getJSONObject("pendingRuntimeRequest").put("kind", "input")
    assertEquals("Agent needs your input", events.accept(update(input)).single().body)
    assertEquals("Agent stopped with an error", events.accept(update(subagent("failed", "next"))).single().body)
    assertEquals("Agent finished", events.accept(update(thread("completed", "main"))).single().body)
    val fork = thread("completed", "fork").put("lineage", JSONObject().put("relationshipToParent", "fork"))
    assertEquals("Agent finished", events.accept(update(fork)).single().body)
    notifySubagents = true
    assertEquals("Agent finished", events.accept(update(subagent("completed", "last"))).single().body)
  }
  @Test fun subagentCompletionAlertsAreOffByDefault() {
    val events = DirectAgentEvents()
    val lineage = JSONObject().put("relationshipToParent", "subagent")
    events.accept(snapshot(thread("running").put("lineage", lineage)))
    assertTrue(events.accept(update(thread("completed").put("lineage", lineage))).isEmpty())
  }
}
