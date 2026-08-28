package com.httptools.companion.pairing

/**
 * Connection info for the paired Mac tool, obtained either by scanning a QR code
 * rendered on the onboarding page or via mDNS/NSD auto-discovery.
 *
 * The Mac's `/api/pairing/qr` endpoint returns this same shape (as JSON) encoded
 * into the QR payload: {"host": "...", "port": 8001, "socksPort": 8002, "token": "...", "expiresAt": ...}
 *
 * [socksPort] is where the Mac's SOCKS5 shim (in front of Mockttp) listens — this is
 * what [com.httptools.companion.vpn.CompanionVpnService] hands to the native
 * hev-socks5-tunnel relay as its upstream SOCKS5 server.
 */
data class PairingInfo(
    val host: String,
    val port: Int,
    val socksPort: Int,
    val token: String,
    val expiresAt: Long? = null
) {
    val isExpired: Boolean
        get() = expiresAt != null && System.currentTimeMillis() > expiresAt
}
