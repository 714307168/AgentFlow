package com.claudecode.remote.data.crypto

import android.util.Base64
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.security.KeyPair
import java.security.SecureRandom

/**
 * End-to-end encryption using X25519 key exchange + AES-256-GCM.
 * The relay server never sees plaintext payloads.
 */
class E2ECrypto {

    private var keyPair: KeyPair
    private val sharedSecrets = mutableMapOf<String, SecretKey>()
    private val secureRandom = SecureRandom()

    init {
        keyPair = generateKeyPair()
    }

    fun getPublicKeyBase64(): String =
        Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP)

    fun deriveSharedSecret(peerId: String, peerPublicKeyBase64: String) {
        val peerKeyBytes = Base64.decode(peerPublicKeyBase64, Base64.NO_WRAP)
        val keyFactory = KeyFactory.getInstance("EC")
        val peerPublicKey = keyFactory.generatePublic(X509EncodedKeySpec(peerKeyBytes))

        val keyAgreement = KeyAgreement.getInstance("ECDH")
        keyAgreement.init(keyPair.private)
        keyAgreement.doPhase(peerPublicKey, true)

        val sharedSecret = keyAgreement.generateSecret()
        // Use first 32 bytes as AES-256 key
        val aesKey = SecretKeySpec(sharedSecret.copyOf(32), "AES")
        sharedSecrets[peerId] = aesKey
    }

    fun hasKey(peerId: String): Boolean = sharedSecrets.containsKey(peerId)

    fun encrypt(peerId: String, plaintext: String): EncryptedPayload? {
        val key = sharedSecrets[peerId] ?: return null
        val nonce = ByteArray(12)
        secureRandom.nextBytes(nonce)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        return EncryptedPayload(
            ciphertext = Base64.encodeToString(ciphertext, Base64.NO_WRAP),
            nonce = Base64.encodeToString(nonce, Base64.NO_WRAP),
            encrypted = true
        )
    }

    fun decrypt(peerId: String, payload: EncryptedPayload): String? {
        val key = sharedSecrets[peerId] ?: return null
        val nonce = Base64.decode(payload.nonce, Base64.NO_WRAP)
        val ciphertext = Base64.decode(payload.ciphertext, Base64.NO_WRAP)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, nonce))
        val plaintext = cipher.doFinal(ciphertext)
        return String(plaintext, Charsets.UTF_8)
    }

    fun removeKey(peerId: String) {
        sharedSecrets.remove(peerId)
    }

    fun regenerateKeys() {
        sharedSecrets.clear()
        keyPair = generateKeyPair()
    }

    private fun generateKeyPair(): KeyPair {
        val kpg = KeyPairGenerator.getInstance("EC")
        kpg.initialize(ECGenParameterSpec("secp256r1"))
        return kpg.generateKeyPair()
    }

    data class EncryptedPayload(
        val ciphertext: String,
        val nonce: String,
        val encrypted: Boolean = true
    )
}
