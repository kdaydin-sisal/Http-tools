package com.httptools.companion.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Custom color palette that mirrors the Mac dashboard's dark slate/blue look
 * (see `dashboard-html.ts`'s `--bg`/`--panel`/`--accent` variables), so the
 * companion app feels like part of the same product rather than a bare
 * Material-defaults screen. Always dark — this is a developer/power-user tool
 * whose companion "brand" (dashboard, icons) is dark-themed, so consistency
 * matters more here than following the OS light/dark setting.
 */
private val AccentBlueLight = Color(0xFF60A5FA)
private val SuccessGreen = Color(0xFF10B981)
private val WarningAmber = Color(0xFFF59E0B)
private val DangerRed = Color(0xFFEF4444)

private val DarkColors = darkColorScheme(
    primary = AccentBlueLight,
    onPrimary = Color(0xFF0B1220),
    secondary = SuccessGreen,
    background = Color(0xFF0F172A),
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF111827),
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1E293B),
    onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF334155),
    error = DangerRed,
    onError = Color(0xFF0B1220),
)

private val AppTypography = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
    bodyMedium = TextStyle(fontSize = 14.sp),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium),
)

/** Semantic status colors, exposed alongside the theme for cards/badges that need them. */
object StatusColors {
    val success = SuccessGreen
    val warning = WarningAmber
    val danger = DangerRed
}

@Composable
fun HttpToolsTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DarkColors, typography = AppTypography, content = content)
}
