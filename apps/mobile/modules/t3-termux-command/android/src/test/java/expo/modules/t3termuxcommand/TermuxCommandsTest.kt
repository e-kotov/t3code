package expo.modules.t3termuxcommand

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
class TermuxCommandsTest {
  private val context: Context get() = RuntimeEnvironment.getApplication()

  @Before fun reset() {
    context.getSharedPreferences("t3-device-commands", Context.MODE_PRIVATE).edit().clear().commit()
  }

  private fun running() = JSONObject()
    .put("runId", "run-1").put("commandId", "up").put("commandName", "Up")
    .put("status", "running").put("startedAt", 10).put("finishedAt", JSONObject.NULL)
    .put("exitCode", JSONObject.NULL).put("output", "").put("outputTruncated", false).put("error", JSONObject.NULL)

  private fun result(bundle: Bundle?) = Intent().setData(Uri.parse("t3-command-result:run-1")).apply {
    if (bundle != null) putExtra("result", bundle)
  }

  @Test fun persistsResultsWithoutTheReactModule() {
    TermuxCommands.remember(context, running())
    TermuxCommands.receive(context, result(Bundle().apply {
      putString("stdout", "ready"); putString("stderr", "note"); putInt("exitCode", 0); putInt("err", -1)
    }))
    val saved = TermuxCommands.runs(context).getJSONObject(0)
    assertEquals("succeeded", saved.getString("status"))
    assertEquals("ready\nnote", saved.getString("output"))
    assertEquals(0, saved.getInt("exitCode"))
    assertTrue(saved.isNull("error"))
  }

  @Test fun treatsTermuxInternalErrorsAsFailureEvenWithExitZero() {
    TermuxCommands.remember(context, running())
    TermuxCommands.receive(context, result(Bundle().apply {
      putInt("exitCode", 0); putInt("err", 0); putString("errmsg", "external apps disabled")
    }))
    val saved = TermuxCommands.runs(context).getJSONObject(0)
    assertEquals("failed", saved.getString("status"))
    assertEquals("external apps disabled", saved.getString("error"))
  }

  @Test fun detectsTruncatedTermuxOutputAndIgnoresDuplicateCallbacks() {
    TermuxCommands.remember(context, running())
    val callback = result(Bundle().apply {
      putString("stdout", "tail"); putString("stdout_original_length", "150000"); putInt("exitCode", 2)
    })
    TermuxCommands.receive(context, callback)
    TermuxCommands.receive(context, callback)
    assertEquals(1, TermuxCommands.runs(context).length())
    val saved = TermuxCommands.runs(context).getJSONObject(0)
    assertTrue(saved.getBoolean("outputTruncated"))
    assertEquals("failed", saved.getString("status"))
  }

  @Test fun missingResultIsFailureAndStaleStatusCanBeCleared() {
    TermuxCommands.remember(context, running())
    TermuxCommands.receive(context, result(null))
    assertEquals("failed", TermuxCommands.runs(context).getJSONObject(0).getString("status"))
    TermuxCommands.remember(context, running())
    TermuxCommands.clearWaiting(context, "run-1")
    assertEquals("failed", TermuxCommands.runs(context).getJSONObject(0).getString("status"))
  }

  @Test fun rejectsDuplicateCommandIdsWithoutReplacingTheList() {
    val command = "{\"id\":\"up\",\"name\":\"Up\",\"command\":\"true\"}"
    TermuxCommands.save(context, "{\"commands\":[$command]}")
    assertThrows(IllegalArgumentException::class.java) {
      TermuxCommands.save(context, "{\"commands\":[$command,$command]}")
    }
    assertEquals(1, TermuxCommands.document(context).getJSONArray("commands").length())
  }
}
