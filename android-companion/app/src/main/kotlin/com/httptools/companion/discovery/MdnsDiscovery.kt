package com.httptools.companion.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.httptools.companion.pairing.PairingInfo
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow

/**
 * Fallback pairing path for devices where camera access is unavailable or denied.
 * Browses for the Mac tool's advertised mDNS/Bonjour service
 * (`_httptools._tcp`, see electron/main.ts mDNS advertisement) and resolves
 * candidates into [PairingInfo]-shaped entries for the user to pick from.
 *
 * Note: mDNS discovery only gives us host/port, not the pairing token — the
 * resolved service's TXT record carries a short-lived token published alongside
 * the advertisement so this fallback path is equally secure to the QR path.
 */
class MdnsDiscovery(private val context: Context) {
    data class DiscoveredService(
        val name: String,
        val host: String,
        val port: Int,
        val token: String?,
        val socksPort: Int?
    )

    private val serviceType = "_httptools._tcp"

    fun discover() = callbackFlow<DiscoveredService> {
        val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager

        val discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { close() }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (!serviceInfo.serviceType.startsWith(serviceType)) return
                val resolveListener = object : NsdManager.ResolveListener {
                    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
                    override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                        val token = serviceInfo.attributes["token"]?.let { String(it) }
                        val socksPort = serviceInfo.attributes["socksPort"]?.let { String(it).toIntOrNull() }
                        trySend(
                            DiscoveredService(
                                name = serviceInfo.serviceName,
                                host = serviceInfo.host?.hostAddress ?: return,
                                port = serviceInfo.port,
                                token = token,
                                socksPort = socksPort
                            )
                        )
                    }
                }
                nsdManager.resolveService(serviceInfo, resolveListener)
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
        }

        nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discoveryListener)

        awaitClose { nsdManager.stopServiceDiscovery(discoveryListener) }
    }

    companion object {
        fun DiscoveredService.toPairingInfo(): PairingInfo? =
            if (token != null && socksPort != null) {
                PairingInfo(host = host, port = port, socksPort = socksPort, token = token)
            } else null
    }
}
