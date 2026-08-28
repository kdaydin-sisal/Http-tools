package com.httptools.companion.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import com.httptools.companion.MainActivity
import com.httptools.companion.pairing.PairingStore
import com.httptools.companion.selection.SelectedAppsStore
import hev.htproxy.TProxyService
import java.io.File

/**
 * Foreground VpnService scoped to only the user-selected apps
 * (via [android.net.VpnService.Builder.addAllowedApplication]). All other apps
 * and system traffic bypass the tunnel entirely and are never touched — this is
 * the core fix for the "unplugging breaks device networking" problem: there is
 * no global proxy setting for us to fail to revert, because we never set one.
 *
 * The tun interface's packets are handed to the native hev-socks5-tunnel engine
 * (see `app/src/main/cpp/`), which reassembles per-connection TCP streams and
 * relays them as SOCKS5 CONNECT requests to the paired Mac's SOCKS5 shim
 * (which itself forwards into Mockttp for interception/MITM).
 */
class CompanionVpnService : VpnService() {

    private var tunFd: ParcelFileDescriptor? = null


    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val selectedApps = SelectedAppsStore(this).load()
        val pairing = PairingStore(this).load()

        if (pairing == null || pairing.isExpired) {
            // No valid pairing yet — nothing to relay to, so don't establish a tunnel.
            stopSelf()
            return START_NOT_STICKY
        }

        if (selectedApps.isEmpty()) {
            // Nothing selected yet — do not establish a tunnel that would capture
            // everything by default; require an explicit app selection first. Checked
            // before startForeground() so we never call stopSelf() immediately after
            // starting foreground (which races into ForegroundServiceDidNotStartInTimeException).
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification())

        val builder = Builder()
            .setSession("HTTP Tools Companion")
            .addAddress(TUNNEL_IPV4_ADDRESS, 32)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("8.8.8.8")

        selectedApps.forEach { pkg ->
            runCatching { builder.addAllowedApplication(pkg) }
        }

        tunFd = builder.establish()

        tunFd?.let { fd ->
            val configPath = writeTunnelConfig(pairing.host, pairing.socksPort)
            val started = runCatching { TProxyService.TProxyStartService(configPath, fd.fd) }.getOrDefault(false)
            if (!started) {
                fd.close()
                tunFd = null
                stopSelf()
            }
        }

        return START_STICKY
    }

    /**
     * hev-socks5-tunnel is configured via a YAML file (see its `conf/main.yml`
     * for the full schema) rather than passed arguments — we generate a minimal
     * one per-start pointing `socks5.address`/`socks5.port` at the paired Mac.
     */
    private fun writeTunnelConfig(socksHost: String, socksPort: Int): String {
        val config = """
            tunnel:
              name: tun0
              mtu: 8500
              ipv4: $TUNNEL_IPV4_ADDRESS
            socks5:
              port: $socksPort
              address: $socksHost
              udp: 'udp'
        """.trimIndent()
        val file = File(filesDir, "tunnel-config.yml")
        file.writeText(config)
        return file.absolutePath
    }

    override fun onDestroy() {
        runCatching { TProxyService.TProxyStopService() }
        tunFd?.close()
        tunFd = null
        super.onDestroy()
    }

    override fun onRevoke() {
        // User revoked VPN permission from system settings — tear down cleanly.
        runCatching { TProxyService.TProxyStopService() }
        tunFd?.close()
        tunFd = null
        stopSelf()
        super.onRevoke()
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Interception tunnel status",
                NotificationManager.IMPORTANCE_LOW
            )
            manager.createNotificationChannel(channel)
        }

        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("HTTP Tools tunnel active")
            .setContentText("Routing selected apps through the Mac interception proxy")
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "companion_vpn"
        private const val TUNNEL_IPV4_ADDRESS = "10.111.0.1"
        const val ACTION_START = "com.httptools.companion.vpn.START"
        const val ACTION_STOP = "com.httptools.companion.vpn.STOP"
    }
}
