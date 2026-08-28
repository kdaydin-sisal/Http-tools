package com.httptools.companion.cert

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Fetches the paired Mac tool's CA certificate (DER bytes) from its existing
 * `/certs/ca.cer` endpoint, so the companion app can check trust status and
 * offer the guided install flow without requiring the user to transfer the
 * cert file manually.
 */
object CaCertFetcher {
    suspend fun fetch(host: String, port: Int): ByteArray? = withContext(Dispatchers.IO) {
        runCatching {
            val url = URL("http://$host:$port/certs/ca.cer")
            (url.openConnection() as HttpURLConnection).run {
                connectTimeout = 5000
                readTimeout = 5000
                requestMethod = "GET"
                try {
                    if (responseCode != HttpURLConnection.HTTP_OK) {
                        throw IOException("Unexpected response code $responseCode fetching CA cert")
                    }
                    inputStream.use { it.readBytes() }
                } finally {
                    disconnect()
                }
            }
        }.getOrNull()
    }
}
