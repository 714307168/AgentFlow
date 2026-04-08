package com.claudecode.remote.data.remote

import com.claudecode.remote.BuildConfig
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import okio.GzipSink
import okio.buffer

const val RELAY_API_VERSION = "1"
const val RELAY_API_HEADER_VERSION = "X-AgentFlow-API-Version"
const val RELAY_API_HEADER_CLIENT = "X-AgentFlow-Client"
const val RELAY_API_HEADER_CLIENT_VERSION = "X-AgentFlow-Client-Version"
const val RELAY_REQUEST_COMPRESSION_HEADER = "X-AgentFlow-Request-Compression"
const val RELAY_REQUEST_COMPRESSION_GZIP = "gzip"
private const val RELAY_API_CLIENT_NAME = "android-app"

class RelayApiVersionInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        return chain.proceed(request.withRelayApiHeaders())
    }
}

class RelayRequestCompressionInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val compression = request.header(RELAY_REQUEST_COMPRESSION_HEADER)?.trim().orEmpty()
        val nextBuilder = request.newBuilder().removeHeader(RELAY_REQUEST_COMPRESSION_HEADER)

        if (
            !compression.equals(RELAY_REQUEST_COMPRESSION_GZIP, ignoreCase = true) ||
            request.body == null ||
            request.header("Content-Encoding") != null
        ) {
            return chain.proceed(nextBuilder.build())
        }

        return chain.proceed(
            nextBuilder
                .header("Content-Encoding", "gzip")
                .method(request.method, request.body!!.gzip())
                .build()
        )
    }
}

fun Request.Builder.applyRelayApiHeaders(): Request.Builder =
    header(RELAY_API_HEADER_VERSION, RELAY_API_VERSION)
        .header(RELAY_API_HEADER_CLIENT, RELAY_API_CLIENT_NAME)
        .header(RELAY_API_HEADER_CLIENT_VERSION, BuildConfig.VERSION_NAME)

fun Request.withRelayApiHeaders(): Request =
    newBuilder().applyRelayApiHeaders().build()

private fun RequestBody.gzip(): RequestBody =
    object : RequestBody() {
        override fun contentType() = this@gzip.contentType()

        override fun contentLength(): Long = -1

        override fun writeTo(sink: BufferedSink) {
            GzipSink(sink).buffer().use { gzipSink ->
                this@gzip.writeTo(gzipSink)
            }
        }
    }
