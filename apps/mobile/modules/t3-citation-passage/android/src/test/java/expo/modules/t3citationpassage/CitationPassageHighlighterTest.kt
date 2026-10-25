package expo.modules.t3citationpassage

import android.content.Context
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CitationPassageHighlighterTest {
  private fun body(vararg parts: String): List<TextView> {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val content = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    val views = parts.map { part -> TextView(context).apply { setText(SpannableString(part), TextView.BufferType.SPANNABLE); content.addView(this) } }
    ScrollView(context).apply {
      addView(content)
      measure(View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY))
      layout(0, 0, 300, 200)
    }
    return views
  }

  @Test fun highlightsOnlyQuotedWordsAndClearsWithoutChangingText() {
    val views = body("Earlier paragraph\n".repeat(40), "before exact quote after")
    val highlighter = CitationPassageHighlighter()
    assertNotNull(highlighter.reveal(views[0].parent as View, views, "exact quote", "before ", " after", 20))
    assertFalse(views[0].text is Spanned && (views[0].text as Spanned).getSpans(0, views[0].length(), BackgroundColorSpan::class.java).isNotEmpty())
    val text = views[1].text as Spanned
    val spans = text.getSpans(0, text.length, BackgroundColorSpan::class.java)
    assertEquals(1, spans.size)
    assertEquals(7, text.getSpanStart(spans.single()))
    assertEquals(18, text.getSpanEnd(spans.single()))
    highlighter.clear()
    assertEquals(0, text.getSpans(0, text.length, BackgroundColorSpan::class.java).size)
    assertEquals("before exact quote after", views[1].text.toString())
  }

  @Test fun quoteSpanningBlocksHighlightsBothAndLeavesUnrelatedTextAlone() {
    val views = body("before first", "second after", "unrelated")
    val highlighter = CitationPassageHighlighter()
    assertNotNull(highlighter.reveal(views[0].parent as View, views, "first second", "before ", " after", 0))
    for ((index, expected) in listOf(1, 1, 0).withIndex()) {
      val text = views[index].text
      val count = if (text is Spanned) text.getSpans(0, text.length, BackgroundColorSpan::class.java).size else 0
      assertEquals(expected, count)
    }
  }

  @Test fun ambiguousPassageDoesNotHighlightEitherOccurrence() {
    val views = body("same quote", "same quote")
    assertNull(CitationPassageHighlighter().reveal(views[0].parent as View, views, "same quote", "", "", 0))
    assertEquals(listOf("same quote", "same quote"), views.map { it.text.toString() })
  }
  @Test fun returnsFineScrollDeltaForPassageWithoutBypassingTheList() {
    val views = body("Earlier paragraph\n".repeat(40) + "exact quote")
    val row = views[0]
    val scroll = row.parent.parent as ScrollView
    val location = CitationPassageHighlighter().reveal(row, views, "exact quote", "", "", 20)!!
    assertTrue(location.delta!! > 200)
    assertEquals(0, scroll.scrollY)
    val offscreen = body("Earlier paragraph\n".repeat(40), "exact quote")
    assertNull(CitationPassageHighlighter().reveal(offscreen[1], listOf(offscreen[1]), "exact quote", "", "", 0)!!.delta)
  }

}
