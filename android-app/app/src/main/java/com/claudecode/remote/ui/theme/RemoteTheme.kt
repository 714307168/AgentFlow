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
    primary = Color(0xFF825B16),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFFFDFA2),
    onPrimaryContainer = Color(0xFF2A1A00),
    secondary = Color(0xFF48647C),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFD4E6F6),
    onSecondaryContainer = Color(0xFF071E2E),
    tertiary = Color(0xFF6B624E),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFEDE2C9),
    onTertiaryContainer = Color(0xFF231B0B),
    background = Color(0xFFF4F0E7),
    onBackground = Color(0xFF171A1F),
    surface = Color(0xFFFFFBF2),
    onSurface = Color(0xFF171A1F),
    surfaceVariant = Color(0xFFE7DED0),
    onSurfaceVariant = Color(0xFF4D463B),
    outline = Color(0xFF83786A),
    error = Color(0xFFB13B2E),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD3),
    onErrorContainer = Color(0xFF410500)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFD9A441),
    onPrimary = Color(0xFF2A1A00),
    primaryContainer = Color(0xFF62440C),
    onPrimaryContainer = Color(0xFFFFE2A8),
    secondary = Color(0xFFAAC9E5),
    onSecondary = Color(0xFF143349),
    secondaryContainer = Color(0xFF314B62),
    onSecondaryContainer = Color(0xFFD4E6F6),
    tertiary = Color(0xFFD3C5AA),
    onTertiary = Color(0xFF3A301F),
    tertiaryContainer = Color(0xFF514735),
    onTertiaryContainer = Color(0xFFEDE2C9),
    background = Color(0xFF10141B),
    onBackground = Color(0xFFF5F0E6),
    surface = Color(0xFF191F27),
    onSurface = Color(0xFFF5F0E6),
    surfaceVariant = Color(0xFF303640),
    onSurfaceVariant = Color(0xFFCFC6B7),
    outline = Color(0xFF9B9181),
    error = Color(0xFFFFB4A8),
    onError = Color(0xFF690800),
    errorContainer = Color(0xFF922015),
    onErrorContainer = Color(0xFFFFDAD3)
)

private val AppTypography = Typography(
    headlineSmall = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 29.sp,
        lineHeight = 35.sp,
        letterSpacing = (-0.55).sp
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = (-0.28).sp
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 18.sp,
        lineHeight = 24.sp,
        letterSpacing = (-0.1).sp
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
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.15.sp
    ),
    labelMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        lineHeight = 18.sp,
        letterSpacing = 0.35.sp
    )
)

private val AppShapes = Shapes(
    small = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(28.dp)
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
            window.navigationBarColor = android.graphics.Color.TRANSPARENT
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content
    )
}
