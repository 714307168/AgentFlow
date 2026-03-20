package com.claudecode.remote.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

private val LightColors = lightColorScheme(
    primary = Color(0xFF0D7A72),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD9F4EE),
    onPrimaryContainer = Color(0xFF00201C),
    secondary = Color(0xFFC07A2C),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFF7E3C4),
    onSecondaryContainer = Color(0xFF2B1700),
    tertiary = Color(0xFF5862D6),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFE2E4FF),
    onTertiaryContainer = Color(0xFF11174F),
    background = Color(0xFFF5F1E8),
    onBackground = Color(0xFF1D1B17),
    surface = Color(0xFFFFFBF4),
    onSurface = Color(0xFF1D1B17),
    surfaceVariant = Color(0xFFE6E1D8),
    onSurfaceVariant = Color(0xFF4B473F),
    outline = Color(0xFF7C776E),
    error = Color(0xFFB3261E),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFF9DEDC),
    onErrorContainer = Color(0xFF410E0B)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF7FE1D4),
    onPrimary = Color(0xFF003731),
    primaryContainer = Color(0xFF005048),
    onPrimaryContainer = Color(0xFFD9F4EE),
    secondary = Color(0xFFF0BE7E),
    onSecondary = Color(0xFF4C2800),
    secondaryContainer = Color(0xFF6A3C00),
    onSecondaryContainer = Color(0xFFF7E3C4),
    tertiary = Color(0xFFC2C6FF),
    onTertiary = Color(0xFF272E74),
    tertiaryContainer = Color(0xFF3E479D),
    onTertiaryContainer = Color(0xFFE2E4FF),
    background = Color(0xFF111411),
    onBackground = Color(0xFFE8E3DA),
    surface = Color(0xFF171A17),
    onSurface = Color(0xFFE8E3DA),
    surfaceVariant = Color(0xFF34312C),
    onSurfaceVariant = Color(0xFFCBC6BD),
    outline = Color(0xFF969087),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6)
)

private val AppTypography = Typography(
    headlineSmall = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        letterSpacing = (-0.4).sp
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = (-0.2).sp
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        lineHeight = 24.sp
    ),
    bodyLarge = TextStyle(
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.1.sp
    ),
    bodyMedium = TextStyle(
        fontSize = 15.sp,
        lineHeight = 22.sp,
        letterSpacing = 0.1.sp
    ),
    labelLarge = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.15.sp
    ),
    labelMedium = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 18.sp,
        letterSpacing = 0.2.sp
    )
)

private val AppShapes = Shapes(
    small = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(26.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(34.dp)
)

@Composable
fun RemoteTheme(content: @Composable () -> Unit) {
    val darkTheme = isSystemInDarkTheme()
    val colorScheme = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = android.graphics.Color.TRANSPARENT
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content
    )
}
