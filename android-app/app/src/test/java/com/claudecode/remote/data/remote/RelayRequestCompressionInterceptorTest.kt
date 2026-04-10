package com.claudecode.remote.data.remote

import okhttp3.Call
import okhttp3.Connection
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.GzipSource
import okio.buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.TimeUnit

class RelayRequestCompressionInterceptorTest {

    @Test
    fun `gzip header compresses request body and removes control header`() {
        val originalBody = """{"known_projects":[{"id":"project-a","name":"Alpha"}]}"""
        val request = Request.Builder()
            .url("https://relay.example.com/api/device/sync/delta")
            .header(RELAY_REQUEST_COMPRESSION_HEADER, RELAY_REQUEST_COMPRESSION_GZIP)
            .post(originalBody.toRequestBody("application/json".toMediaType()))
            .build()

        val chain = CapturingChain(request)
        RelayRequestCompressionInterceptor().intercept(chain)

        val forwarded = chain.proceededRequest
        assertNotNull(forwarded)
        assertEquals("gzip", forwarded!!.header("Content-Encoding"))
        assertNull(forwarded.header(RELAY_REQUEST_COMPRESSION_HEADER))
        assertEquals(originalBody, unzip(forwarded))
    }

    @Test
    fun `request body stays plain when compression header is absent`() {
        val originalBody = """{"known_projects":[{"id":"project-a"}]}"""
        val request = Request.Builder()
            .url("https://relay.example.com/api/device/sync/delta")
            .post(originalBody.toRequestBody("application/json".toMediaType()))
            .build()

        val chain = CapturingChain(request)
        RelayRequestCompressionInterceptor().intercept(chain)

        val forwarded = chain.proceededRequest
        assertNotNull(forwarded)
        assertNull(forwarded!!.header("Content-Encoding"))
        assertEquals(originalBody, bodyText(forwarded))
    }

    private fun unzip(request: Request): String {
        val body = request.body ?: error("request body missing")
        val buffer = Buffer()
        body.writeTo(buffer)
        return GzipSource(buffer).buffer().readUtf8()
    }

    private fun bodyText(request: Request): String {
        val body = request.body ?: error("request body missing")
        val buffer = Buffer()
        body.writeTo(buffer)
        return buffer.readUtf8()
    }

    private class CapturingChain(
        private val initialRequest: Request
    ) : Interceptor.Chain {
        var proceededRequest: Request? = null

        override fun request(): Request = initialRequest

        override fun proceed(request: Request): Response {
            proceededRequest = request
            return Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .body("{}".toResponseBody("application/json".toMediaType()))
                .build()
        }

        override fun connection(): Connection? = null

        override fun call(): Call {
            throw UnsupportedOperationException("Not needed for interceptor test")
        }

        override fun connectTimeoutMillis(): Int = 0

        override fun withConnectTimeout(timeout: Int, unit: TimeUnit): Interceptor.Chain = this

        override fun readTimeoutMillis(): Int = 0

        override fun withReadTimeout(timeout: Int, unit: TimeUnit): Interceptor.Chain = this

        override fun writeTimeoutMillis(): Int = 0

        override fun withWriteTimeout(timeout: Int, unit: TimeUnit): Interceptor.Chain = this
    }
}
