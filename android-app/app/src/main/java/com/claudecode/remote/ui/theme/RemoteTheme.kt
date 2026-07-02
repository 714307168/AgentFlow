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
    primary = Color(0xFF0B7567),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD7F4EA),
    onPrimaryContainer = Color(0xFF06261F),
    secondary = Color(0xFF9E6415),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFFFE2B8),
    onSecondaryContainer = Color(0xFF2A1700),
    tertiary = Color(0xFF3E6A86),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD6ECF6),
    onTertiaryContainer = Color(0xFF071D28),
    background = Color(0xFFEFF6F1),
    onBackground = Color(0xFF0E1B1D),
    surface = Color(0xFFFBFFFC),
    onSurface = Color(0xFF0E1B1D),
    surfaceVariant = Color(0xFFDCE8E1),
    onSurfaceVariant = Color(0xFF3F514B),
    outline = Color(0xFF6F837B),
    error = Color(0xFFB53A2C),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD4),
    onErrorContainer = Color(0xFF3F0600)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF70F0D0),
    onPrimary = Color(0xFF00382F),
    primaryContainer = Color(0xFF0B5148),
    onPrimaryContainer = Color(0xFFD8FFF3),
    secondary = Color(0xFFF3B75D),
    onSecondary = Color(0xFF432800),
    secondaryContainer = Color(0xFF614000),
    onSecondaryContainer = Color(0xFFFFE2B8),
    tertiary = Color(0xFF9ED4EF),
    onTertiary = Color(0xFF083342),
    tertiaryContainer = Color(0xFF244E63),
    onTertiaryContainer = Color(0xFFD6ECF6),
    background = Color(0xFF071016),
    onBackground = Color(0xFFF1F7EF),
    surface = Color(0xFF0D1C22),
    onSurface = Color(0xFFF1F7EF),
    surfaceVariant = Color(0xFF21343B),
    onSurfaceVariant = Color(0xFFC0D2CB),
    outline = Color(0xFF8EA59D),
    error = Color(0xFFFFB4A8),
    onError = Color(0xFF650B00),
    errorContainer = Color(0xFF8F1E12),
    onErrorContainer = Color(0xFFFFDAD4)
)

private val AppTypography = Typography(
    headlineSmall = TextStyle(
        fontWeight = FontWeight.ExtraBold,
        fontSize = 30.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.7).sp
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = (-0.35).sp
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
    small = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(32.dp)
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
