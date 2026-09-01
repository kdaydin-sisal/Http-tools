package com.httptools.companion.cert

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.ByteArrayInputStream
import java.io.File
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

/**
 * Best-effort check of whether the Mac tool's CA certificate is already trusted
 * on this device, plus a guided (still manual, per Android's security model)
 * install flow.
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

    /**
     * Builds the intent that opens Android's system "Install certificate" flow.
     *
     * We deliberately do NOT use `KeyChain.createInstallIntent()` with raw cert bytes:
     * on several OEM builds (observed on Samsung One UI) that path shows an unhelpful
     * "certificate provided by null, install it from the Settings app" dead-end instead
     * of the real install screen. Writing the cert to a file under the app's cache dir
     * and launching `ACTION_VIEW` with a `content://` URI (via FileProvider) and the CA
     * cert MIME type reliably opens the same "Install CA certificate" screen used when a
     * .cer file is downloaded in a browser.
     */
    fun createInstallIntent(context: Context, certBytes: ByteArray): Intent {
        val certsDir = File(context.cacheDir, "certs").apply { mkdirs() }
        val certFile = File(certsDir, "http-tools-ca.cer")
        certFile.writeBytes(certBytes)

        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", certFile)

        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/x-x509-ca-cert")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}
