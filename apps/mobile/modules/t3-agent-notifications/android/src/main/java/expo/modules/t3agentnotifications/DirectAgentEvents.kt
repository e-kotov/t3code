package expo.modules.t3agentnotifications

import org.json.JSONObject

internal data class DirectAgentAlert(val threadId: String, val key: String, val title: String, val body: String)

/** Remember only status/identifiers, never conversation text. Initial snapshots are a quiet baseline. */
internal class DirectAgentEvents(private val notifyOnSubagentCompletion: () -> Boolean = { false }) {
  private data class ThreadState(val runId: String, val status: String, val requestId: String)
  private val threads = mutableMapOf<String, ThreadState>()
  private var initialized = false

  fun accept(item: JSONObject): List<DirectAgentAlert> {
    when (item.optString("kind")) {
      "snapshot" -> {
        val snapshot = item.optJSONObject("snapshot") ?: return emptyList()
        val rows = snapshot.optJSONArray("threads") ?: return emptyList()
        val present = mutableSetOf<String>()
        val alerts = mutableListOf<DirectAgentAlert>()
        for (index in 0 until rows.length()) {
          val row = rows.optJSONObject(index) ?: continue
          present.add(row.optString("id"))
          update(row, initialized)?.let { alerts.add(it) }
        }
        threads.keys.retainAll(present)
        initialized = true
        return alerts
      }
      "thread.updated" -> {
        val row = item.optJSONObject("thread") ?: return emptyList()
        if (item.optString("location") == "archive") {
          threads.remove(row.optString("id"))
          return emptyList()
        }
        return listOfNotNull(update(row, initialized))
      }
      "thread.removed" -> threads.remove(item.optString("threadId"))
    }
    return emptyList()
  }

  private fun update(row: JSONObject, notify: Boolean): DirectAgentAlert? {
    val id = row.optString("id")
    if (id.isEmpty()) return null
    if (!row.isNull("deletedAt") || !row.isNull("archivedAt")) {
      threads.remove(id)
      return null
    }
    val request = row.optJSONObject("pendingRuntimeRequest")
    val next = ThreadState(
      row.stringOrEmpty("latestRunId"), row.optString("status"), request?.optString("id").orEmpty()
    )
    val previous = threads.put(id, next)
    if (!notify) return null
    val title = row.optString("title").ifBlank { "Conversation" }.take(120)
    if (next.requestId.isNotEmpty() && next.requestId != previous?.requestId) {
      val kind = request?.optString("kind").orEmpty()
      val body = if (kind.contains("approval")) "Agent needs approval" else "Agent needs your input"
      return DirectAgentAlert(id, "$id:request:${next.requestId}", title, body)
    }
    // A newly discovered stopped conversation isn't evidence that it just finished.
    if (previous == null || next.runId.isEmpty()) return null
    if (next.runId == previous.runId && next.status == previous.status) return null
    if (next.status == "completed" && !notifyOnSubagentCompletion() &&
      (row.optJSONObject("lineage")?.optString("relationshipToParent") == "subagent" ||
        !row.isNull("delegatedFrom"))) return null
    val body = when (next.status) {
      "completed" -> "Agent finished"
      "failed" -> "Agent stopped with an error"
      else -> return null
    }
    return DirectAgentAlert(id, "$id:run:${next.runId}:${next.status}", title, body)
  }
}

private fun JSONObject.stringOrEmpty(key: String): String = if (isNull(key)) "" else optString(key)
