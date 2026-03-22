package com.claudecode.remote.data.remote

import com.claudecode.remote.data.local.TokenStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

class AuthSessionManager(
    private val tokenStore: TokenStore,
    private val relayApiProvider: () -> RelayApi,
    private val clientType: String
) {
    private val mutex = Mutex()

    suspend fun login(
        username: String,
        password: String,
        clientId: String
    ): Result<LoginResponse> = mutex.withLock {
        runCatching {
            val normalizedUsername = username.trim()
            val normalizedClientId = clientId.trim()
            require(normalizedUsername.isNotEmpty()) { "Username is required" }
            require(password.isNotEmpty()) { "Password is required" }
            require(normalizedClientId.isNotEmpty()) { "Client ID is required" }

            relayApiProvider().login(
                LoginRequest(
                    username = normalizedUsername,
                    password = password,
                    clientType = clientType,
                    clientId = normalizedClientId
                )
            ).also { response ->
                persistSession(
                    username = response.user.username,
                    password = password,
                    token = response.token,
                    expiresAt = response.expiresAt
                )
            }
        }
    }

    suspend fun ensureValidToken(
        clientId: String,
        forceRefresh: Boolean = false
    ): Result<String> = mutex.withLock {
        runCatching {
            val normalizedClientId = clientId.trim()
            require(normalizedClientId.isNotEmpty()) { "Client ID is required" }

            val currentToken = tokenStore.getToken()?.trim().orEmpty()
            if (!forceRefresh && currentToken.isNotEmpty() && !isTokenExpiringSoon()) {
                return@runCatching currentToken
            }

            val username = tokenStore.getUsername()?.trim().orEmpty()
            val password = tokenStore.getPassword().orEmpty()
            require(username.isNotEmpty()) { "Stored username is missing" }
            require(password.isNotEmpty()) { "Stored password is missing" }

            relayApiProvider().login(
                LoginRequest(
                    username = username,
                    password = password,
                    clientType = clientType,
                    clientId = normalizedClientId
                )
            ).also { response ->
                persistSession(
                    username = response.user.username,
                    password = password,
                    token = response.token,
                    expiresAt = response.expiresAt
                )
            }.token
        }
    }

    fun isTokenExpiringSoon(nowMillis: Long = System.currentTimeMillis()): Boolean {
        val expiresAtMillis = parseExpiresAtMillis(tokenStore.getTokenExpiresAt()) ?: return true
        return expiresAtMillis - nowMillis <= REFRESH_WINDOW_MILLIS
    }

    fun nextRefreshDelayMillis(nowMillis: Long = System.currentTimeMillis()): Long? {
        val expiresAtMillis = parseExpiresAtMillis(tokenStore.getTokenExpiresAt()) ?: return null
        return (expiresAtMillis - nowMillis - REFRESH_WINDOW_MILLIS).coerceAtLeast(MIN_REFRESH_DELAY_MILLIS)
    }

    private fun persistSession(
        username: String,
        password: String,
        token: String,
        expiresAt: String
    ) {
        tokenStore.saveUsername(username)
        tokenStore.savePassword(password)
        tokenStore.saveToken(token)
        tokenStore.saveTokenExpiresAt(expiresAt)
    }

    private fun parseExpiresAtMillis(expiresAt: String?): Long? =
        expiresAt
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { raw -> runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull() }

    companion object {
        private const val REFRESH_WINDOW_MILLIS = 5 * 60 * 1000L
        private const val MIN_REFRESH_DELAY_MILLIS = 30 * 1000L
    }
}
