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

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_TOKEN = "jwt_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_E2E_ENABLED = "e2e_enabled"
        private const val KEY_E2E_PRIVATE = "e2e_private_key"
        private const val KEY_E2E_PUBLIC = "e2e_public_key"
        private const val KEY_LANGUAGE = "language"
        private const val KEY_USERNAME = "username"
    }
}
