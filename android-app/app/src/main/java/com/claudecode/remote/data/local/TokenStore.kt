package com.claudecode.remote.data.local

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class TokenStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "claude_secure_prefs",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun saveTokenExpiresAt(expiresAt: String) {
        prefs.edit().putString(KEY_TOKEN_EXPIRES_AT, expiresAt).apply()
    }

    fun getTokenExpiresAt(): String? = prefs.getString(KEY_TOKEN_EXPIRES_AT, null)

    fun saveDeviceId(id: String) {
        prefs.edit().putString(KEY_DEVICE_ID, id).apply()
    }

    fun getDeviceId(): String? = prefs.getString(KEY_DEVICE_ID, null)

    fun saveServerUrl(url: String) {
        prefs.edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun getServerUrl(): String? = prefs.getString(KEY_SERVER_URL, null)

    fun saveE2EEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_E2E_ENABLED, enabled).apply()
    }

    fun isE2EEnabled(): Boolean = prefs.getBoolean(KEY_E2E_ENABLED, false)

    fun saveE2EPrivateKey(key: String) {
        prefs.edit().putString(KEY_E2E_PRIVATE, key).apply()
    }

    fun getE2EPrivateKey(): String? = prefs.getString(KEY_E2E_PRIVATE, null)

    fun saveE2EPublicKey(key: String) {
        prefs.edit().putString(KEY_E2E_PUBLIC, key).apply()
    }

    fun getE2EPublicKey(): String? = prefs.getString(KEY_E2E_PUBLIC, null)

    fun saveLanguage(lang: String) {
        prefs.edit().putString(KEY_LANGUAGE, lang).apply()
    }

    fun getLanguage(): String = prefs.getString(KEY_LANGUAGE, "en") ?: "en"

    fun saveUsername(username: String) {
        prefs.edit().putString(KEY_USERNAME, username).apply()
    }

    fun getUsername(): String? = prefs.getString(KEY_USERNAME, null)

    fun savePassword(password: String) {
        prefs.edit().putString(KEY_PASSWORD, password).apply()
    }

    fun getPassword(): String? = prefs.getString(KEY_PASSWORD, null)

    fun hasSavedCredentials(): Boolean =
        !getUsername().isNullOrBlank() && !getPassword().isNullOrBlank()

    fun hasDeviceBinding(): Boolean =
        !getDeviceId().isNullOrBlank()

    fun hasSavedSession(): Boolean =
        !getToken().isNullOrBlank() || hasSavedCredentials()

    fun canResumeSession(): Boolean =
        hasDeviceBinding() && hasSavedCredentials()

    fun shouldAutoStartRelay(): Boolean =
        hasDeviceBinding() && hasSavedSession()

    fun saveAutoUpdateCheckEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_UPDATE_CHECK, enabled).apply()
    }

    fun isAutoUpdateCheckEnabled(): Boolean = prefs.getBoolean(KEY_AUTO_UPDATE_CHECK, true)

    fun saveAutoUpdateDownloadEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_UPDATE_DOWNLOAD, enabled).apply()
    }

    fun isAutoUpdateDownloadEnabled(): Boolean = prefs.getBoolean(KEY_AUTO_UPDATE_DOWNLOAD, false)

    fun saveCrashLogsEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_CRASH_LOGS_ENABLED, enabled).apply()
    }

    fun isCrashLogsEnabled(): Boolean = prefs.getBoolean(KEY_CRASH_LOGS_ENABLED, true)

    fun saveDraft(projectId: String, draft: String) {
        val key = projectDraftKey(projectId)
        if (draft.isBlank()) {
            prefs.edit().remove(key).apply()
        } else {
            prefs.edit().putString(key, draft).apply()
        }
    }

    fun getDraft(projectId: String): String =
        prefs.getString(projectDraftKey(projectId), "") ?: ""

    fun clearDraft(projectId: String) {
        prefs.edit().remove(projectDraftKey(projectId)).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_TOKEN = "jwt_token"
        private const val KEY_TOKEN_EXPIRES_AT = "jwt_token_expires_at"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_E2E_ENABLED = "e2e_enabled"
        private const val KEY_E2E_PRIVATE = "e2e_private_key"
        private const val KEY_E2E_PUBLIC = "e2e_public_key"
        private const val KEY_LANGUAGE = "language"
        private const val KEY_USERNAME = "username"
        private const val KEY_PASSWORD = "password"
        private const val KEY_AUTO_UPDATE_CHECK = "auto_update_check"
        private const val KEY_AUTO_UPDATE_DOWNLOAD = "auto_update_download"
        private const val KEY_CRASH_LOGS_ENABLED = "crash_logs_enabled"

        private fun projectDraftKey(projectId: String): String = "draft_$projectId"
    }
}
