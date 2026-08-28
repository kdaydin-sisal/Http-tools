package com.httptools.companion.pairing

/**
 * Connection info for the paired Mac tool, obtained either by scanning a QR code
 * rendered on the onboarding page or via mDNS/NSD auto-discovery.
 *
 * The Mac's `/api/pairing/qr` endpoint returns this same shape (as JSON) encoded
 * into the QR payload: {"host": "...", "port": 8000, "token": "...", "expiresAt": ...}
 */
data class PairingInfo(
    val host: String,
    val port: Int,
    val token: String,
    val expiresAt: Long? = null
) {
    val isExpired: Boolean
        get() = expiresAt != null && System.currentTimeMillis() > expiresAt
}
