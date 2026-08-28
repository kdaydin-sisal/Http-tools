package com.httptools.companion.cert

import android.content.Context
import android.security.KeyChain
import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

/**
 * Best-effort check of whether the Mac tool's CA certificate is already trusted
 * on this device, plus a guided (still manual, per Android's security model)
 * install flow via KeyChain.createInstallIntent().
 *
 * Android does not allow silently installing a user CA without an explicit user
 * action in system settings — this class verifies status and prepares the
 * install intent, but cannot skip the user confirmation step.
 */
object CaCertHelper {

    /**
     * Returns true if a certificate matching [certBytes] appears to already be
     * present in the device's trust store (system or user-added CAs). Uses the
     * "AndroidCAStore" KeyStore, which is the actual store consulted for TLS
     * trust decisions — comparing certs directly (not via KeyChain APIs, which
     * are for client cert aliases, not CA trust lookups).
     */
    fun isCertLikelyTrusted(context: Context, certBytes: ByteArray): Boolean {
        return runCatching {
            val cf = CertificateFactory.getInstance("X.509")
            val target = cf.generateCertificate(ByteArrayInputStream(certBytes)) as X509Certificate

            val caStore = KeyStore.getInstance("AndroidCAStore").apply { load(null, null) }
            caStore.aliases().asSequence().any { alias ->
                (caStore.getCertificate(alias) as? X509Certificate)?.let { installed ->
                    installed.encoded.contentEquals(target.encoded)
                } ?: false
            }
        }.getOrDefault(false)
    }

    /** Builds the intent that opens Android's system "Install certificate" flow, pre-filled with the CA bytes. */
    fun createInstallIntent(certBytes: ByteArray) = KeyChain.createInstallIntent().apply {
        putExtra(KeyChain.EXTRA_CERTIFICATE, certBytes)
        putExtra(KeyChain.EXTRA_NAME, "HTTP Tools CA")
    }
}
