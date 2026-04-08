package com.claudecode.remote.data.remote

import retrofit2.HttpException

const val RELAY_FEATURE_DEVICE_SYNC_META = "device_sync_meta"
const val RELAY_FEATURE_DEVICE_SYNC_DELTA = "device_sync_delta"

fun Throwable.isLegacyRelayMissingFeature(): Boolean {
    val httpError = this as? HttpException ?: return false
    return httpError.code() == 404 || httpError.code() == 405
}
