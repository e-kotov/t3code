package expo.modules.t3citationpassage

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private class EnrichedMarkdownText(context: Context) : TextView(context)
private class CodeBlockContainerView(context: Context) : FrameLayout(context)
private class TableContainerView(context: Context) : FrameLayout(context) {
  class CellTextView(context: Context) : TextView(context)
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CitationPassageViewsTest {
  @Test fun collectsBodyCodeAndCellsButExcludesControlsHeadersAndHiddenText() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val root = FrameLayout(context)
    val body = EnrichedMarkdownText(context).apply { text = "body" }
    val code = TextView(context).apply { text = "code" }
    val cell = TableContainerView.CellTextView(context).apply { text = "cell" }
    root.addView(body)
    root.addView(CodeBlockContainerView(context).apply {
      addView(TextView(context).apply { text = "language" })
      addView(HorizontalScrollView(context).apply { addView(code) })
    })
    root.addView(TableContainerView(context).apply { addView(cell) })
    root.addView(TextView(context).apply { text = "Copy" })
    root.addView(EnrichedMarkdownText(context).apply { text = "hidden"; visibility = View.GONE })
    assertEquals(listOf(body, code, cell), CitationPassageViews.collect(root))
  }
}
