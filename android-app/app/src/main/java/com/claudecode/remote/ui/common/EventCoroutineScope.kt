package com.claudecode.remote.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

@Composable
fun rememberViewTreeLifecycleOwner(): LifecycleOwner? {
    val view = LocalView.current
    return remember(view) { view.findViewTreeLifecycleOwner() }
}

@Composable
fun rememberEventCoroutineScope(): CoroutineScope {
    val lifecycleOwner = rememberViewTreeLifecycleOwner()
    val fallbackScope = remember { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }
    DisposableEffect(Unit) {
        onDispose { fallbackScope.cancel() }
    }
    return remember(lifecycleOwner, fallbackScope) { lifecycleOwner?.lifecycleScope ?: fallbackScope }
}
