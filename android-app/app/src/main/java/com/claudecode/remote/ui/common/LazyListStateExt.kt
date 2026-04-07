package com.claudecode.remote.ui.common

import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListState
import kotlin.math.abs

private const val BOTTOM_ALIGNMENT_TOLERANCE_PX = 1
private const val MAX_BOTTOM_ALIGNMENT_PASSES = 3

suspend fun LazyListState.scrollToItemBottom(index: Int) {
    if (index < 0) {
        return
    }
    scrollToItem(index)
    alignItemBottom(index)
}

suspend fun LazyListState.animateScrollToItemBottom(index: Int) {
    if (index < 0) {
        return
    }
    animateScrollToItem(index)
    alignItemBottom(index)
}

private suspend fun LazyListState.alignItemBottom(index: Int) {
    repeat(MAX_BOTTOM_ALIGNMENT_PASSES) {
        val info = layoutInfo
        val targetItem = info.visibleItemsInfo.lastOrNull { it.index == index } ?: return
        val delta = (targetItem.offset + targetItem.size) - info.viewportEndOffset
        if (abs(delta) <= BOTTOM_ALIGNMENT_TOLERANCE_PX) {
            return
        }
        val consumed = scrollBy(delta.toFloat())
        if (abs(consumed) <= BOTTOM_ALIGNMENT_TOLERANCE_PX) {
            return
        }
    }
}
