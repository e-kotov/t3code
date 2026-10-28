package expo.modules.t3tailnet

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneShareSessionTest {
  @Test fun replacementStartsOnlyAfterOldWorkAndCleanupFinish() {
    val entered = CountDownLatch(1)
    val resume = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val events = mutableListOf<String>()
    val old = PhoneShareSession()
    val replacement = PhoneShareSession()
    try {
      old.start {
        entered.countDown()
        check(resume.await(5, TimeUnit.SECONDS))
        events.add(if (old.closed) "old cancelled" else "old sharing")
      }
      assertTrue(entered.await(5, TimeUnit.SECONDS))
      old.start { events.add("stale queued start") }
      old.close { events.add("old listener closed") }
      replacement.start {
        events.add("new sharing")
        finished.countDown()
      }
      resume.countDown()
      assertTrue(finished.await(5, TimeUnit.SECONDS))
      assertEquals(listOf("old cancelled", "old listener closed", "new sharing"), events)
    } finally {
      resume.countDown()
      replacement.close {}
    }
  }
}
