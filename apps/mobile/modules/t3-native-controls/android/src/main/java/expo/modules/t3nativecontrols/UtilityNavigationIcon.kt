package expo.modules.t3nativecontrols

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.sp

@Composable
internal fun UtilityNavigationIcon(
  label: String,
  color: Int,
  tint: Color = androidx.compose.material3.LocalContentColor.current,
  modifier: Modifier = Modifier,
) {
  Box(modifier = modifier, contentAlignment = Alignment.Center) {
    Icon(painter = painterResource(R.drawable.t3_device_commands), contentDescription = label, tint = tint)
    Text("●", color = Color(color), fontSize = 10.sp, modifier = Modifier.align(Alignment.TopEnd).clearAndSetSemantics { })
  }
}
