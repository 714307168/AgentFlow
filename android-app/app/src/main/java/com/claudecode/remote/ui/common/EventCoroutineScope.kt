package com.claudecode.remote.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CoroutineScope

@Composable
fun rememberViewTreeLifecycleOwner(): LifecycleOwner? {
    val view = LocalView.current
    return remember(view) { view.findViewTreeLifecycleOwner() }
}

@Composable
fun rememberEventCoroutineScope(): CoroutineScope {
    val lifecycleOwner = rememberViewTreeLifecycleOwner()
    val fallbackScope = rememberCoroutineScope()
    return remember(lifecycleOwner, fallbackScope) { lifecycleOwner?.lifecycleScope ?: fallbackScope }
}
