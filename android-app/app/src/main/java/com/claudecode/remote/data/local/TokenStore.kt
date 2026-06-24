package com.claudecode.remote.data.local

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest

class TokenStore(context: Context) {
    private val appContext = context.applicationContext
    private val prefs: SharedPreferences by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        openPreferences(appContext)
    }

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun saveTokenExpiresAt(expiresAt: String) {
        prefs.edit().putString(KEY_TOKEN_EXPIRES_AT, expiresAt).apply()
    }

    fun getTokenExpiresAt(): String? = prefs.getString(KEY_TOKEN_EXPIRES_AT, null)

    fun clearToken() {
        prefs.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_TOKEN_EXPIRES_AT)
            .apply()
    }

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

    fun isE2EEnabled(): Boolean = prefs.getBoolean(KEY_E2E_ENABLED, true)

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

    fun saveCredentials(username: String, password: String) {
        prefs.edit()
            .putString(KEY_USERNAME, username)
            .putString(KEY_PASSWORD, password)
            .apply()
    }

    fun hasSavedCredentials(): Boolean =
        !getUsername().isNullOrBlank() && !getPassword().isNullOrBlank()

    fun hasDeviceBinding(): Boolean =
        !getDeviceId().isNullOrBlank()

    fun hasSavedSession(): Boolean =
        !getToken().isNullOrBlank() || hasSavedCredentials()

    fun canResumeSession(): Boolean =
        hasDeviceBinding() && hasSavedCredentials()

    fun shouldAutoStartRelay(): Boolean =
        hasDeviceBinding() && hasSavedCredentials()

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

    fun saveProjectChatSnapshot(projectId: String, snapshotJson: String) {
        val key = projectChatSnapshotKey(projectId)
        if (snapshotJson.isBlank()) {
            prefs.edit().remove(key).apply()
        } else {
            prefs.edit().putString(key, snapshotJson).apply()
        }
    }

    fun getProjectChatSnapshot(projectId: String): String? =
        prefs.getString(projectChatSnapshotKey(projectId), null)

    fun clearProjectChatSnapshot(projectId: String) {
        prefs.edit().remove(projectChatSnapshotKey(projectId)).apply()
    }

    fun saveCollapsedSessionGroups(groupKeys: Set<String>) {
        prefs.edit().putStringSet(KEY_COLLAPSED_SESSION_GROUPS, groupKeys.toSet()).apply()
    }

    fun getCollapsedSessionGroups(): Set<String> =
        prefs.getStringSet(KEY_COLLAPSED_SESSION_GROUPS, emptySet())?.toSet() ?: emptySet()

    fun saveCollapsedAgentGroups(groupKeys: Set<String>) {
        prefs.edit().putStringSet(KEY_COLLAPSED_AGENT_GROUPS, groupKeys.toSet()).apply()
    }

    fun getCollapsedAgentGroups(): Set<String> =
        prefs.getStringSet(KEY_COLLAPSED_AGENT_GROUPS, emptySet())?.toSet() ?: emptySet()

    fun saveJoinedWorkgroupAgentIds(agentIds: Set<String>) {
        prefs.edit().putStringSet(KEY_JOINED_WORKGROUP_AGENT_IDS, agentIds.toSet()).apply()
    }

    fun getJoinedWorkgroupAgentIds(): Set<String> =
        prefs.getStringSet(KEY_JOINED_WORKGROUP_AGENT_IDS, emptySet())?.toSet() ?: emptySet()

    fun saveDeviceSyncRevision(revision: String) {
        val normalized = revision.trim()
        if (normalized.isEmpty()) {
            prefs.edit().remove(KEY_DEVICE_SYNC_REVISION).apply()
        } else {
            prefs.edit().putString(KEY_DEVICE_SYNC_REVISION, normalized).apply()
        }
    }

    fun getDeviceSyncRevision(): String? = prefs.getString(KEY_DEVICE_SYNC_REVISION, null)

    fun saveEffectiveScopeJson(rawJson: String?) {
        val normalized = rawJson?.trim().orEmpty()
        if (normalized.isEmpty()) {
            prefs.edit().remove(KEY_EFFECTIVE_SCOPE_JSON).apply()
        } else {
            prefs.edit().putString(KEY_EFFECTIVE_SCOPE_JSON, normalized).apply()
        }
    }

    fun getEffectiveScopeJson(): String? = prefs.getString(KEY_EFFECTIVE_SCOPE_JSON, null)

    fun saveRelayFeatureSupport(serverUrl: String?, featureKey: String, supported: Boolean) {
        val key = relayFeatureSupportKey(serverUrl, featureKey)
        prefs.edit().putBoolean(key, supported).apply()
    }

    fun getRelayFeatureSupport(serverUrl: String?, featureKey: String): Boolean? {
        val key = relayFeatureSupportKey(serverUrl, featureKey)
        if (!prefs.contains(key)) {
            return null
        }
        return prefs.getBoolean(key, false)
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val TAG = "TokenStore"
        private const val PREFS_FILE_NAME = "claude_secure_prefs"
        private const val FALLBACK_PREFS_FILE_NAME = "claude_secure_prefs_fallback"
        private const val ENCRYPTED_KEYSET_PREFS = "__androidx_security_crypto_encrypted_prefs_key_keyset__"
        private const val ENCRYPTED_VALUE_KEYSET_PREFS = "__androidx_security_crypto_encrypted_prefs_value_keyset__"
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
        private const val KEY_COLLAPSED_SESSION_GROUPS = "collapsed_session_groups"
        private const val KEY_COLLAPSED_AGENT_GROUPS = "collapsed_agent_groups"
        private const val KEY_JOINED_WORKGROUP_AGENT_IDS = "joined_workgroup_agent_ids"
        private const val KEY_DEVICE_SYNC_REVISION = "device_sync_revision"
        private const val KEY_EFFECTIVE_SCOPE_JSON = "effective_scope_json"

        private fun projectDraftKey(projectId: String): String = "draft_$projectId"
        private fun projectChatSnapshotKey(projectId: String): String = "chat_snapshot_$projectId"
        private fun relayFeatureSupportKey(serverUrl: String?, featureKey: String): String {
            val normalizedServerUrl = serverUrl?.trim()?.lowercase().orEmpty()
            val normalizedFeatureKey = featureKey.trim().lowercase()
            val digest = MessageDigest.getInstance("SHA-256")
                .digest("$normalizedServerUrl|$normalizedFeatureKey".toByteArray())
                .joinToString(separator = "") { byte -> "%02x".format(byte) }
            return "relay_feature_$digest"
        }

        private fun openPreferences(context: Context): SharedPreferences {
            createEncryptedPreferences(context)?.let { return it }

            Log.w(TAG, "Falling back to unencrypted preference storage after encrypted preference recovery failed")
            return context.getSharedPreferences(FALLBACK_PREFS_FILE_NAME, Context.MODE_PRIVATE)
        }

        private fun createEncryptedPreferences(context: Context): SharedPreferences? {
            runCatching { return createEncryptedPreferencesOrThrow(context) }
                .onFailure { error ->
                    Log.e(TAG, "Failed to open encrypted preferences; attempting recovery", error)
                }

            clearEncryptedPreferenceState(context)

            return runCatching { createEncryptedPreferencesOrThrow(context) }
                .onFailure { error ->
                    Log.e(TAG, "Encrypted preference recovery failed", error)
                }
                .getOrNull()
        }

        private fun createEncryptedPreferencesOrThrow(context: Context): SharedPreferences =
            EncryptedSharedPreferences.create(
                context,
                PREFS_FILE_NAME,
                MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )

        private fun clearEncryptedPreferenceState(context: Context) {
            listOf(
                PREFS_FILE_NAME,
                ENCRYPTED_KEYSET_PREFS,
                ENCRYPTED_VALUE_KEYSET_PREFS
            ).forEach { name ->
                runCatching {
                    context.deleteSharedPreferences(name)
                    File(File(context.applicationInfo.dataDir, "shared_prefs"), "$name.xml")
                        .takeIf { it.exists() }
                        ?.delete()
                }.onFailure { error ->
                    Log.w(TAG, "Failed to delete shared preferences during encrypted storage recovery: $name", error)
                }
            }

            runCatching {
                val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                if (keyStore.containsAlias(MasterKey.DEFAULT_MASTER_KEY_ALIAS)) {
                    keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                }
            }.onFailure { error ->
                Log.w(TAG, "Failed to clear Android Keystore master key during encrypted storage recovery", error)
            }
        }
    }
}
