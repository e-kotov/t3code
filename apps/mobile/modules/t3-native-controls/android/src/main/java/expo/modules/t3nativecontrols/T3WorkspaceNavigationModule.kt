package expo.modules.t3nativecontrols

import android.content.Context
import android.view.ViewGroup
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.sp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class T3WorkspaceNavigationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3WorkspaceNavigation")
    View(T3WorkspaceNavigationView::class) {
      Prop("selectedTab") { view: T3WorkspaceNavigationView, value: String ->
        view.selectedTab = value
      }
      Prop("dark") { view: T3WorkspaceNavigationView, value: Boolean -> view.dark = value }
      Prop("textScale") { view: T3WorkspaceNavigationView, value: Float -> view.textScale = value }
      Prop("containerColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.containerColor = value
      }
      Prop("selectedColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.selectedColor = value
      }
      Prop("indicatorColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.indicatorColor = value
      }
      Prop("unselectedColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.unselectedColor = value
      }
      Prop("utilitiesLabel") { view: T3WorkspaceNavigationView, value: String -> view.utilitiesLabel = value }
      Prop("utilitiesColor") { view: T3WorkspaceNavigationView, value: Int -> view.utilitiesColor = value }
      Events("onTabSelected")
    }
  }
}

/** Material3 bottom navigation for the compact workspace. */
class T3WorkspaceNavigationView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  // Compose must remeasure native children when Yoga resizes the folded window.
  override val shouldUseAndroidLayout = true

  private val onTabSelected by EventDispatcher()
  var utilitiesLabel by mutableStateOf("Utilities, unknown")
  var utilitiesColor by mutableStateOf(0xff888888.toInt())
  var selectedTab by mutableStateOf("threads")
  var dark by mutableStateOf(false)
  var textScale by mutableStateOf(1f)
  var containerColor by mutableStateOf(0)
  var selectedColor by mutableStateOf(0)
  var indicatorColor by mutableStateOf(0)
  var unselectedColor by mutableStateOf(0)

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Fabric measures the replacement bar before attaching it on a fold.
    // Compose needs an attached window to obtain its lifecycle recomposer.
    if (!isAttachedToWindow) {
      setMeasuredDimension(
        MeasureSpec.getSize(widthMeasureSpec),
        MeasureSpec.getSize(heightMeasureSpec)
      )
      return
    }
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    if (isAttachedToWindow) super.onLayout(changed, left, top, right, bottom)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    requestLayout()
  }

  init {
    addView(
      ComposeView(context).apply {
        setViewCompositionStrategy(
          ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool
        )
        setContent {
          MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
            val tabs = listOf("threads", "pullRequests", "commands")
            NavigationBar(
              modifier = Modifier.fillMaxSize(),
              containerColor = Color(containerColor),
              tonalElevation = androidx.compose.ui.unit.Dp(0f),
              windowInsets = WindowInsets(0),
            ) {
              tabs.forEach { tab ->
                NavigationBarItem(
                  selected = selectedTab == tab,
                  onClick = { onTabSelected(mapOf("tab" to tab)) },
                  icon = { tabIcon(tab) },
                  label = {
                    val title = when (tab) { "threads" -> "Chats"; "commands" -> "Utilities"; else -> "Pull requests" }
                    Text(title, fontSize = (12 * textScale).sp)
                  },
                  colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = Color(selectedColor),
                    selectedTextColor = Color(selectedColor),
                    indicatorColor = Color(indicatorColor),
                    unselectedIconColor = Color(unselectedColor),
                    unselectedTextColor = Color(unselectedColor),
                  ),
                )
              }
            }
          }
        }
      },
      LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    )
  }

  @Composable
  private fun tabIcon(tab: String) {
    if (tab == "commands") { UtilityNavigationIcon(utilitiesLabel, utilitiesColor); return }
    val drawable = when (tab) {
      "threads" -> R.drawable.t3_chats
      "commands" -> R.drawable.t3_device_commands
      else -> R.drawable.t3_pull_requests
    }
    Icon(
      painter = painterResource(drawable),
      contentDescription = when (tab) { "threads" -> "Chats"; "commands" -> "Utilities"; else -> "Pull requests" },
    )
  }
}
