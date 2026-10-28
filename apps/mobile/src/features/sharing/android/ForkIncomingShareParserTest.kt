package expo.modules.sharing

import android.content.Intent
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31, 36], manifest = Config.NONE)
class ForkIncomingShareParserTest {
  private val uri = Uri.parse("file:///shared/transcript.txt")

  private fun parse(intent: Intent) =
    SimpleShareIntentDataParser.parse(RuntimeEnvironment.getApplication(), intent)

  @Test
  fun transcriptStreamWithoutInlineTextIsAFile() {
    val result = parse(Intent(Intent.ACTION_SEND).apply {
      type = "text/plain"
      putExtra(Intent.EXTRA_STREAM, uri)
    })
    assertEquals(listOf(ShareType.File), result.map { it.shareType })
    assertEquals(uri.toString(), result.single().value)
    assertEquals("text/plain", result.single().mimeType)
  }

  @Test
  fun captionDoesNotReplaceTheSharedTranscriptFile() {
    val result = parse(Intent(Intent.ACTION_SEND).apply {
      type = "text/plain"
      putExtra(Intent.EXTRA_STREAM, uri)
      putExtra(Intent.EXTRA_TEXT, "Please summarize this transcript")
    })
    assertEquals(listOf(ShareType.Text, ShareType.File), result.map { it.shareType })
    assertEquals(uri.toString(), result.last().value)
  }

  @Test
  fun multipleTranscriptsRemainFiles() {
    val second = Uri.parse("file:///shared/second.txt")
    val result = parse(Intent(Intent.ACTION_SEND_MULTIPLE).apply {
      type = "text/plain"
      putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(uri, second))
    })
    assertEquals(listOf(ShareType.File, ShareType.File), result.map { it.shareType })
    assertEquals(listOf(uri.toString(), second.toString()), result.map { it.value })
  }

  @Test
  fun pdfStreamIsAFile() {
    val pdf = Uri.parse("file:///shared/report.pdf")
    val result = parse(Intent(Intent.ACTION_SEND).apply {
      type = "application/pdf"
      putExtra(Intent.EXTRA_STREAM, pdf)
    })
    assertEquals(ShareType.File, result.single().shareType)
    assertEquals("application/pdf", result.single().mimeType)
    assertEquals(pdf.toString(), result.single().value)
  }

  @Test
  fun plainSharedTextStillWorks() {
    val result = parse(Intent(Intent.ACTION_SEND).apply {
      type = "text/plain"
      putExtra(Intent.EXTRA_TEXT, "Explain this")
    })
    assertEquals(ShareType.Text, result.single().shareType)
    assertEquals("Explain this", result.single().value)
  }
}
