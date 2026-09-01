package com.httptools.companion.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
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
        Log.i(TAG, "onStartCommand action=${intent?.action} tunFd=${tunFd != null}")
        if (intent?.action == ACTION_STOP) {
            Log.i(TAG, "onStartCommand: ACTION_STOP received, tearing down")
            stopTunnel()
            stopSelf()
            return START_NOT_STICKY
        }
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
            .addAddress(TUNNEL_IPV6_ADDRESS, 128)
            .addRoute("0.0.0.0", 0)
            // Without an IPv6 default route, VpnService silently drops any IPv6
            // traffic from tunneled apps instead of passing it through (it has
            // no matching route once the app is scoped into the VPN) -- this
            // looked identical to "no captures ever arrive" for apps/OS
            // components that prefer IPv6 (common with Android's dual-stack
            // "happy eyeballs" behavior), even though IPv4 DNS-over-UDP kept
            // working fine.
            .addRoute("::", 0)
            .addDnsServer("8.8.8.8")
            .setMtu(TUNNEL_MTU)

        selectedApps.forEach { pkg ->
            runCatching { builder.addAllowedApplication(pkg) }
        }

        tunFd = builder.establish()
        Log.i(TAG, "builder.establish() returned tunFd=${tunFd != null}")

        if (tunFd == null) {
            // establish() returns null if VPN permission isn't granted, or (per
            // Android's VpnService docs) if another always-on VPN app has locked
            // out other VPN clients. Surface this loudly since it otherwise fails
            // silently with no captures and no obvious error to the user.
            Log.w(TAG, "establish() returned null tunFd -- VPN was not actually created; " +
                "another VPN (e.g. an MDM/corporate VPN) may be blocking it")
            stopSelf()
            return START_NOT_STICKY
        }

        tunFd?.let { fd ->
            val configPath = writeTunnelConfig(pairing.host, pairing.socksPort)
            val startResult = runCatching { TProxyService.TProxyStartService(configPath, fd.fd) }
            val started = startResult.getOrDefault(false)
            Log.i(TAG, "TProxyStartService(config=$configPath, fd=${fd.fd}) -> $started " +
                "(exception=${startResult.exceptionOrNull()})")
            if (!started) {
                fd.close()
                tunFd = null
                stopSelf()
            }
        }

        return START_NOT_STICKY
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
              mtu: $TUNNEL_MTU
              ipv4: $TUNNEL_IPV4_ADDRESS
              ipv6: $TUNNEL_IPV6_ADDRESS
            socks5:
              port: $socksPort
              address: $socksHost
              udp: 'udp'
            misc:
              log-file: ${filesDir.absolutePath}/tunnel-debug.log
              log-level: debug
        """.trimIndent()
        val file = File(filesDir, "tunnel-config.yml")
        file.writeText(config)
        return file.absolutePath
    }

    private fun stopTunnel() {
        val stopped = runCatching { TProxyService.TProxyStopService() }.getOrNull()
        Log.i(TAG, "stopTunnel: TProxyStopService returned $stopped, closing tunFd=${tunFd != null}")
        tunFd?.close()
        tunFd = null
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy called")
        stopTunnel()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.i(TAG, "onTaskRemoved called")
        // Belt-and-suspenders: if the user swipes the app away from recents,
        // tear the tunnel down instead of leaving it (and the foreground
        // notification) running invisibly in the background. The explicit
        // switch-off path already calls stopService(), but this guarantees
        // the tunnel never outlives the app being closed even if that path
        // is missed (e.g. app killed before the toggle handler runs).
        stopTunnel()
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onRevoke() {
        // User revoked VPN permission from system settings — tear down cleanly.
        Log.i(TAG, "onRevoke called")
        stopTunnel()
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
        private const val TAG = "CompanionVpnService"
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "companion_vpn"
        private const val TUNNEL_IPV4_ADDRESS = "10.111.0.1"
        private const val TUNNEL_IPV6_ADDRESS = "fc00::1"
        // A conservative MTU that fits safely under real-world Wi-Fi/cellular
        // path MTUs after the SOCKS5/TCP framing overhead added by
        // hev-socks5-tunnel. The previous 8500 value in the native tunnel's
        // config never matched what VpnService.Builder actually configured on
        // the tun interface (setMtu() was never called, so Android used its own
        // default) -- that mismatch could corrupt or silently drop packets that
        // exceeded the interface's real MTU, which looked identical to "no
        // captures ever arrive" despite the VPN being otherwise healthy.
        private const val TUNNEL_MTU = 1500
        const val ACTION_START = "com.httptools.companion.vpn.START"
        const val ACTION_STOP = "com.httptools.companion.vpn.STOP"
    }
}
