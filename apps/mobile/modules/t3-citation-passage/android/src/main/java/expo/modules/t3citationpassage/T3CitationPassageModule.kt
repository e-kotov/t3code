package expo.modules.t3citationpassage

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject

class T3CitationPassageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3CitationPassage")
    View(T3CitationPassageView::class) {
      Prop("targetJson") { view: T3CitationPassageView, target: String -> view.setTarget(target) }
      Events("onLocated")
    }
  }
}

class T3CitationPassageView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ViewTreeObserver.OnPreDrawListener {
  private val highlighter = CitationPassageHighlighter()
  private val onLocated by EventDispatcher()
  private var target: JSONObject? = null
  private var observing = false
  private val observation = CitationPassageObservation()

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
    observation.begin()
    observing = true
    viewTreeObserver.addOnPreDrawListener(this)
    (parent as? View)?.postInvalidateOnAnimation()
  }

  private fun stopObserving() {
    if (observing && viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(this)
    observing = false
  }

  override fun onPreDraw(): Boolean {
    val selection = target ?: return true.also { stopObserving() }
    val root = parent as? ViewGroup ?: return true.also { stopObserving() }
    val views = CitationPassageViews.collect(root)
    val location = if (views.isNotEmpty() && views.all { it.layout != null }) {
      highlighter.reveal(root, views, selection.getString("text"), selection.getString("prefix"),
        selection.getString("suffix"), (selection.getDouble("topInset") * resources.displayMetrics.density).toInt())
    } else null
    val requestId = selection.getLong("requestId")
    when (val step = observation.update(requestId, location)) {
      CitationPassageObservation.Step.Wait -> root.postInvalidateOnAnimation()
      is CitationPassageObservation.Step.Complete -> {
        stopObserving()
        if (step.emit) onLocated(mapOf("requestId" to requestId,
          "found" to (step.report != null), "delta" to step.report?.delta))
      }
    }
    return true
  }
}
