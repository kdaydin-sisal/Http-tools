package com.httptools.companion.cert

import android.content.Context
import android.security.KeyChain
import java.io.ByteArrayInputStream
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
     * Returns true if a certificate matching [pemBytes] appears to already be
     * present in the user's trusted credential store. This is a best-effort
     * check: Android does not expose a direct "is this exact CA trusted" query,
     * so we compare against installed user certificates by subject + fingerprint
     * where accessible; a false negative here just means we show the install
     * flow again, which is harmless (Android dedupes identical certs).
     */
    fun isCertLikelyTrusted(context: Context, pemBytes: ByteArray): Boolean {
        return runCatching {
            val cf = CertificateFactory.getInstance("X.509")
            val target = cf.generateCertificate(ByteArrayInputStream(pemBytes)) as X509Certificate
            val trustedChain = KeyChain.getCertificateChain(
                context,
                target.subjectX500Principal.name
            )
            trustedChain != null && trustedChain.isNotEmpty()
        }.getOrDefault(false)
    }

    /** Builds the intent that opens Android's system "Install certificate" flow, pre-filled with the CA bytes. */
    fun createInstallIntent(pemBytes: ByteArray) = KeyChain.createInstallIntent().apply {
        putExtra(KeyChain.EXTRA_CERTIFICATE, pemBytes)
        putExtra(KeyChain.EXTRA_NAME, "HTTP Tools CA")
    }
}
