package expo.modules.t3citationpassage

import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.TextView

internal object CitationPassageViews {
  fun ready(views: List<TextView>): Boolean = views.isNotEmpty() && views.all {
    val name = it.javaClass.name
    val body = name.endsWith(".EnrichedMarkdownText") || name.endsWith(".EnrichedMarkdownInternalText")
    it.layout != null && (!body || (it.text.isNotBlank() && it.alpha >= 1f))
  }

  fun collect(root: View): List<TextView> {
    val views = mutableListOf<TextView>()
    fun visit(view: View) {
      if (view.visibility != View.VISIBLE) return
      val name = view.javaClass.name
      // Enriched's code body is a plain TextView; its language header stays out of the quote stream.
      if (view is TextView && (name.endsWith(".EnrichedMarkdownText") ||
          name.endsWith(".EnrichedMarkdownInternalText") || name.endsWith("TableContainerView\$CellTextView") ||
          (view.parent is HorizontalScrollView && (view.parent.parent as? View)?.javaClass?.name?.endsWith(".CodeBlockContainerView") == true))) {
        views.add(view)
      } else if (view is ViewGroup) {
        for (index in 0 until view.childCount) visit(view.getChildAt(index))
      }
    }
    visit(root)
    return views
  }
}
