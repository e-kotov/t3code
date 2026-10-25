package expo.modules.t3citationpassage

import android.graphics.Color
import android.graphics.Rect
import android.text.Spannable
import android.text.Layout
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import android.widget.TextView

internal class CitationPassageHighlighter {
  private class Highlight : BackgroundColorSpan(Color.argb(100, 255, 193, 7))
  private val highlighted = mutableListOf<Pair<TextView, Spannable>>()

  fun clear() {
    for ((view, text) in highlighted) {
      for (span in text.getSpans(0, text.length, Highlight::class.java)) text.removeSpan(span)
      view.invalidate()
    }
    highlighted.clear()
  }

  fun reveal(views: List<TextView>, quote: String, prefix: String, suffix: String, topInset: Int): Boolean {
    clear()
    val raw = views.joinToString("\n") { it.text.toString() }
    val range = CitationPassageText.find(raw, quote, prefix, suffix) ?: return false
    var offset = 0
    var first: Triple<TextView, Int, Layout>? = null
    for (view in views) {
      val start = (range.start - offset).coerceAtLeast(0)
      val end = (range.end - offset).coerceAtMost(view.text.length)
      if (start < end) {
        val layout = view.layout
        if (view.text !is Spannable) view.setText(view.text, TextView.BufferType.SPANNABLE)
        val text = view.text as Spannable
        text.setSpan(Highlight(), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        highlighted.add(view to text)
        if (first == null && layout != null) first = Triple(view, start, layout)
        view.invalidate()
      }
      offset += view.text.length + 1
    }
    val (view, start, layout) = first ?: return false
    val line = layout.getLineForOffset(start)
    val x = layout.getPrimaryHorizontal(start).toInt() + view.totalPaddingLeft
    val rect = Rect(x, layout.getLineTop(line) + view.totalPaddingTop, x + 1,
      layout.getLineBottom(line) + view.totalPaddingTop)
    var parent = view.parent
    while (parent is View) {
      if (parent is HorizontalScrollView) {
        val horizontal = Rect(rect)
        parent.offsetDescendantRectToMyCoords(view, horizontal)
        parent.smoothScrollTo((horizontal.left - parent.width / 4).coerceAtLeast(0), 0)
      }
      if (parent is ScrollView) {
        parent.offsetDescendantRectToMyCoords(view, rect)
        val inset = topInset.coerceIn(0, parent.height)
        val target = rect.top - inset - (parent.height - inset - rect.height()) / 3
        parent.smoothScrollTo(parent.scrollX, target.coerceAtLeast(0))
        break
      }
      parent = parent.parent
    }
    return true
  }
}
