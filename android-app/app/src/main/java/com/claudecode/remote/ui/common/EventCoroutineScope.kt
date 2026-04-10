package com.claudecode.remote.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CoroutineScope

@Composable
fun rememberEventCoroutineScope(): CoroutineScope {
    val context = LocalContext.current
    val lifecycleOwner = context as? LifecycleOwner
    val fallbackScope = rememberCoroutineScope()
    return remember(lifecycleOwner, fallbackScope) { lifecycleOwner?.lifecycleScope ?: fallbackScope }
}
