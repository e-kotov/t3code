package expo.modules.t3citationpassage

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.HorizontalScrollView
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject

class T3CitationPassageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3CitationPassage")
    View(T3CitationPassageView::class) {
      Prop("targetJson") { view: T3CitationPassageView, target: String -> view.setTarget(target) }
    }
  }
}

class T3CitationPassageView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ViewTreeObserver.OnPreDrawListener {
  private val highlighter = CitationPassageHighlighter()
  private var target: JSONObject? = null
  private var observing = false

  fun setTarget(json: String) {
    stopObserving()
    highlighter.clear()
    target = if (json.isEmpty()) null else JSONObject(json)
    if (target != null && isAttachedToWindow) observe()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (target != null) observe()
  }

  override fun onDetachedFromWindow() {
    stopObserving()
    highlighter.clear()
    super.onDetachedFromWindow()
  }

  private fun observe() {
    if (observing) return
    observing = true
    viewTreeObserver.addOnPreDrawListener(this)
    invalidate()
  }

  private fun stopObserving() {
    if (observing && viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(this)
    observing = false
  }

  override fun onPreDraw(): Boolean {
    val selection = target ?: return true.also { stopObserving() }
    val views = mutableListOf<TextView>()
    fun collect(view: View) {
      val name = view.javaClass.name
      // Enriched's code body is a plain TextView; its language header must stay out of the quote stream.
      if (view is TextView && (name.endsWith(".EnrichedMarkdownText") ||
          name.endsWith(".EnrichedMarkdownInternalText") || name.endsWith("TableContainerView\$CellTextView") ||
          (view.parent is HorizontalScrollView && (view.parent.parent as? View)?.javaClass?.name?.endsWith(".CodeBlockContainerView") == true))) {
        views.add(view)
      } else if (view is ViewGroup) {
        for (index in 0 until view.childCount) collect(view.getChildAt(index))
      }
    }
    collect(this)
    if (isLayoutRequested || views.any { it.isLayoutRequested || it.layout == null }) return true
    stopObserving()
    highlighter.reveal(views, selection.getString("text"), selection.getString("prefix"),
      selection.getString("suffix"), (selection.getDouble("topInset") * resources.displayMetrics.density).toInt())
    return true
  }
}
