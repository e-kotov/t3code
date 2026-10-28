package expo.modules.t3tailnet

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Looper
import java.time.Duration
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31, 36], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class PhoneShareServiceTest {
  private lateinit var app: Application
  private lateinit var manager: NotificationManager

  class FakeService : PhoneShareService() {
    val jobs = ArrayDeque<() -> Unit>()
    var ready = true
    var backend = "running"
    var promotionError = false
    var sharePresent = false
    var rejectShare = false
    override fun launchWork(work: () -> Unit) { jobs.addLast(work) }
    override fun serverReady() = ready
    override fun startTailnet() = reply()
    override fun tailnetCall(method: String, args: JSONObject): String {
      if (method == "startPhoneShare") {
        if (rejectShare) return """{"ok":false,"error":"Could not restore phone sharing"}"""
        sharePresent = true
      }
      if (method == "stopPhoneShare") sharePresent = false
      return reply()
    }
    override fun promoteForeground() {
      if (promotionError) throw IllegalStateException("Foreground promotion rejected")
      super.promoteForeground()
    }
    private fun reply() = """{"ok":true,"result":{"state":"$backend"}}"""
    fun runNext() { jobs.removeFirst().invoke() }
  }

  @Before fun setUp() {
    app = RuntimeEnvironment.getApplication()
    app.getSharedPreferences("t3-phone-share", 0).edit().clear().commit()
    manager = app.getSystemService(NotificationManager::class.java)
    PhoneShareService.setEnabled(app, true)
  }

  @Test fun stopRejectsAnAlreadyQueuedAvailabilityUpdate() {
    val controller = Robolectric.buildService(FakeService::class.java).create()
    val service = controller.get()
    try {
      service.onStartCommand(Intent(), 0, 1)
      service.runNext() // Native work finished; availability is queued on main.
      PhoneShareService.setEnabled(app, false)
      shadowOf(Looper.getMainLooper()).idle()
      assertNull(shadowOf(manager).getNotification(73003))
      assertEquals("Off", PhoneShareService.status(app))
    } finally { controller.destroy() }
  }

  @Test fun failedPromotionDoesNotCrashOrRequestStickyRestart() {
    val controller = Robolectric.buildService(FakeService::class.java)
    controller.get().promotionError = true
    controller.create()
    try {
      assertEquals(Service.START_NOT_STICKY, controller.get().onStartCommand(null, 0, 1))
      assertFalse(PhoneShareService.isEnabled(app))
      assertEquals("Foreground promotion rejected", PhoneShareService.status(app))
    } finally { controller.destroy() }
  }

  @Test fun serverFailureRemainsVisibleAfterServiceDestruction() {
    val controller = Robolectric.buildService(FakeService::class.java).create()
    val service = controller.get()
    service.onStartCommand(Intent(), 0, 1)
    service.runNext()
    shadowOf(Looper.getMainLooper()).idle()
    service.ready = false
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(15))
    service.runNext()
    shadowOf(Looper.getMainLooper()).idle()
    controller.destroy()
    assertFalse(PhoneShareService.isEnabled(app))
    assertTrue(PhoneShareService.status(app).contains("server stopped"))
    val notification = shadowOf(manager).getNotification(73003)
    assertNotNull(notification)
    assertEquals(0, notification.flags and Notification.FLAG_ONGOING_EVENT)
    assertTrue(notification.actions.isNullOrEmpty())
  }

  @Test fun healthCheckReportsReconnectionAndThenStoppedNode() {
    val controller = Robolectric.buildService(FakeService::class.java).create()
    val service = controller.get()
    try {
      service.onStartCommand(Intent(), 0, 1)
      service.runNext()
      shadowOf(Looper.getMainLooper()).idle()
      service.backend = "starting"
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(15))
      service.runNext()
      shadowOf(Looper.getMainLooper()).idle()
      assertEquals("Reconnecting to Tailscale", PhoneShareService.status(app))
      assertTrue(PhoneShareService.isEnabled(app))
      service.backend = "stopped"
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(15))
      service.runNext()
      shadowOf(Looper.getMainLooper()).idle()
      assertFalse(PhoneShareService.isEnabled(app))
      assertTrue(PhoneShareService.status(app).contains("Tailscale stopped"))
    } finally { controller.destroy() }
  }

  @Test fun foregroundRestoreDoesNotRestartAnExistingService() {
    val controller = Robolectric.buildService(FakeService::class.java).create()
    try {
      while (shadowOf(app).nextStartedService != null) { /* Drain initial start. */ }
      PhoneShareService.restore(app)
      assertNull(shadowOf(app).nextStartedService)
    } finally {
      PhoneShareService.setEnabled(app, false)
      controller.destroy()
    }
  }

  @Test fun healthCheckRepairsMissingShareBeforeReportingAvailable() {
    val controller = Robolectric.buildService(FakeService::class.java).create()
    val service = controller.get()
    try {
      service.onStartCommand(Intent(), 0, 1)
      service.runNext()
      shadowOf(Looper.getMainLooper()).idle()
      service.sharePresent = false
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(15))
      service.runNext()
      assertTrue("A running node must have its share restored before publishing Available", service.sharePresent)
      shadowOf(Looper.getMainLooper()).idle()
      assertEquals("Available on your tailnet", PhoneShareService.status(app))
      service.sharePresent = false
      service.rejectShare = true
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(15))
      service.runNext()
      shadowOf(Looper.getMainLooper()).idle()
      assertFalse(PhoneShareService.isEnabled(app))
      assertEquals("Could not restore phone sharing", PhoneShareService.status(app))
    } finally { controller.destroy() }
  }

  @Test fun slowServerProbesRecoverAndResetFailureCount() {
    val controller = Robolectric.buildService(FakeService::class.java).create()
    val service = controller.get()
    try {
      service.onStartCommand(Intent(), 0, 1)
      service.runNext()
      shadowOf(Looper.getMainLooper()).idle()
      for (ready in listOf(false, false, true, false, false, true)) {
        service.ready = ready
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(15))
        service.runNext()
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue("Two consecutive slow probes must leave sharing enabled", PhoneShareService.isEnabled(app))
      }
      assertEquals("Available on your tailnet", PhoneShareService.status(app))
    } finally {
      PhoneShareService.setEnabled(app, false)
      controller.destroy()
    }
  }

  @Test fun rapidOffOnRestoresAfterCancelledServiceIsDestroyed() {
    val controller = Robolectric.buildService(FakeService::class.java).create()
    PhoneShareService.setEnabled(app, false)
    while (shadowOf(app).nextStartedService != null) { /* Drain initial start. */ }
    PhoneShareService.setEnabled(app, true)
    assertNull(shadowOf(app).nextStartedService)
    controller.destroy()
    shadowOf(Looper.getMainLooper()).idle()
    assertNotNull(shadowOf(app).nextStartedService)
    assertTrue(PhoneShareService.isEnabled(app))
    PhoneShareService.setEnabled(app, false)
  }
}
