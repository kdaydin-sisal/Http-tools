package com.httptools.companion.pairing

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Persists the last-successful pairing so the app can reconnect without re-scanning
 * every launch. Stored in a private SharedPreferences file (adequate for a sideloaded
 * debug tool; not intended to protect against a rooted/compromised device).
 */
class PairingStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    fun save(info: PairingInfo) {
        prefs.edit()
            .putString("host", info.host)
            .putInt("port", info.port)
            .putInt("socksPort", info.socksPort)
            .putString("token", info.token)
            .putLong("expiresAt", info.expiresAt ?: -1L)
            .apply()
    }

    fun load(): PairingInfo? {
        val host = prefs.getString("host", null) ?: return null
        val port = prefs.getInt("port", -1)
        val socksPort = prefs.getInt("socksPort", -1)
        val token = prefs.getString("token", null) ?: return null
        if (port <= 0 || socksPort <= 0) return null
        val expiresAt = prefs.getLong("expiresAt", -1L).takeIf { it > 0 }
        return PairingInfo(host, port, socksPort, token, expiresAt)
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        /**
         * Parses a QR payload of the form produced by the Mac's `/api/pairing/qr`
         * endpoint: {"host": "...", "port": 8001, "socksPort": 8002, "token": "...", "expiresAt": 123}
         */
        fun parse(payload: String): PairingInfo? = runCatching {
            val json = JSONObject(payload)
            PairingInfo(
                host = json.getString("host"),
                port = json.getInt("port"),
                socksPort = json.getInt("socksPort"),
                token = json.getString("token"),
                expiresAt = if (json.has("expiresAt")) json.getLong("expiresAt") else null
            )
        }.getOrNull()
    }
}
