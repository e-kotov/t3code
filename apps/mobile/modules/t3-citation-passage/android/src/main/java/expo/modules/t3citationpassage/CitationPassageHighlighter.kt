package expo.modules.t3citationpassage

import android.graphics.Color
import android.graphics.Rect
import android.text.Spannable
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.view.View
import android.widget.ScrollView
import android.widget.TextView

internal data class CitationPassageLocation(val delta: Double?)

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

  fun reveal(root: View, views: List<TextView>, quote: String, prefix: String, suffix: String, topInset: Int): CitationPassageLocation? {
    clear()
    val raw = views.joinToString("\n") { it.text.toString() }
    val range = CitationPassageText.find(raw, quote, prefix, suffix) ?: return null
    var offset = 0
    var first: Pair<TextView, Int>? = null
    for (view in views) {
      val start = (range.start - offset).coerceAtLeast(0)
      val end = (range.end - offset).coerceAtMost(view.text.length)
      if (start < end) {
        val text = view.text as? Spannable
        if (text != null) {
          text.setSpan(Highlight(), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          highlighted.add(view to text)
          view.invalidate()
        }
        if (first == null) first = view to start
      }
      offset += view.text.length + 1
    }
    val (view, start) = first ?: return null
    val layout = view.layout ?: return null
    val line = layout.getLineForOffset(start)
    val rect = Rect(0, layout.getLineTop(line) + view.totalPaddingTop, 1,
      layout.getLineBottom(line) + view.totalPaddingTop)
    var parent = root.parent
    while (parent is View) {
      if (parent is ScrollView) {
        val row = Rect(0, 0, root.width, root.height)
        parent.offsetDescendantRectToMyCoords(root, row)
        val inset = topInset.coerceIn(0, parent.height)
        if (row.bottom <= parent.scrollY + inset || row.top >= parent.scrollY + parent.height) {
          return CitationPassageLocation(null)
        }
        parent.offsetDescendantRectToMyCoords(view, rect)
        val delta = rect.top - parent.scrollY - inset - (parent.height - inset - rect.height()) / 3
        return CitationPassageLocation(delta / root.resources.displayMetrics.density.toDouble())
      }
      parent = parent.parent
    }
    return CitationPassageLocation(null)
  }
}
