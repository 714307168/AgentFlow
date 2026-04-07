package com.claudecode.remote.data.remote

import com.claudecode.remote.BuildConfig
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response

const val RELAY_API_VERSION = "1"
const val RELAY_API_HEADER_VERSION = "X-AgentFlow-API-Version"
const val RELAY_API_HEADER_CLIENT = "X-AgentFlow-Client"
const val RELAY_API_HEADER_CLIENT_VERSION = "X-AgentFlow-Client-Version"
private const val RELAY_API_CLIENT_NAME = "android-app"

class RelayApiVersionInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        return chain.proceed(request.withRelayApiHeaders())
    }
}

fun Request.Builder.applyRelayApiHeaders(): Request.Builder =
    header(RELAY_API_HEADER_VERSION, RELAY_API_VERSION)
        .header(RELAY_API_HEADER_CLIENT, RELAY_API_CLIENT_NAME)
        .header(RELAY_API_HEADER_CLIENT_VERSION, BuildConfig.VERSION_NAME)

fun Request.withRelayApiHeaders(): Request =
    newBuilder().applyRelayApiHeaders().build()
