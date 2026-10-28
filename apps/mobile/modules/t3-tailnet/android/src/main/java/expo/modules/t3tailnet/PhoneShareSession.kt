package expo.modules.t3tailnet

import java.util.concurrent.Executors

/** Old service cleanup must finish before a replacement can open its listener. */
internal class PhoneShareSession {
  companion object {
    private val worker = Executors.newSingleThreadExecutor()
  }

  @Volatile var closed = false
    private set

  fun start(work: () -> Unit) {
    worker.execute { if (!closed) work() }
  }

  fun close(cleanup: () -> Unit) {
    closed = true
    worker.execute(cleanup)
  }
}
