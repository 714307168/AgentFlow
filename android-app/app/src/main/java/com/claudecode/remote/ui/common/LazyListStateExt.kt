package com.claudecode.remote.ui.common

import androidx.compose.runtime.withFrameNanos
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListState
import kotlin.math.abs

private const val BOTTOM_ALIGNMENT_TOLERANCE_PX = 1
private const val MAX_BOTTOM_ALIGNMENT_PASSES = 6

suspend fun LazyListState.scrollToItemBottom(index: Int) {
    if (index < 0) {
        return
    }
    settleItemBottom(index) {
        scrollToItem(index)
    }
}

suspend fun LazyListState.animateScrollToItemBottom(index: Int) {
    if (index < 0) {
        return
    }
    settleItemBottom(index) {
        animateScrollToItem(index)
    }
}

private suspend fun LazyListState.settleItemBottom(
    index: Int,
    initialScroll: suspend LazyListState.() -> Unit
) {
    initialScroll()
    withFrameNanos { }
    repeat(MAX_BOTTOM_ALIGNMENT_PASSES) {
        val delta = bottomAlignmentDelta(index)
        if (delta == null) {
            scrollToItem(index)
            withFrameNanos { }
            return@repeat
        }
        if (abs(delta) <= BOTTOM_ALIGNMENT_TOLERANCE_PX) {
            return
        }
        val consumed = scrollBy(delta.toFloat())
        withFrameNanos { }
        if (abs(consumed) <= BOTTOM_ALIGNMENT_TOLERANCE_PX) {
            return
        }
    }
}

private fun LazyListState.bottomAlignmentDelta(index: Int): Int? {
    val info = layoutInfo
    val targetItem = info.visibleItemsInfo.lastOrNull { it.index == index } ?: return null
    return (targetItem.offset + targetItem.size) - info.viewportEndOffset
}
