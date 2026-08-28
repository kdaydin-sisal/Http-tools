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
import com.httptools.companion.selection.SelectedAppsStore

/**
 * Foreground VpnService scoped to only the user-selected apps
 * (via [android.net.VpnService.Builder.addAllowedApplication]). All other apps
 * and system traffic bypass the tunnel entirely and are never touched — this is
 * the core fix for the "unplugging breaks device networking" problem: there is
 * no global proxy setting for us to fail to revert, because we never set one.
 *
 * Packet relay engine (hev-socks5-tunnel via JNI) is wired in as part of the
 * companion-vpnservice-relay todo; this class currently establishes/tears down
 * the tun interface and foreground notification, with the native relay start
 * left as a clearly marked extension point.
 */
class CompanionVpnService : VpnService() {

    private var tunFd: ParcelFileDescriptor? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val selectedApps = SelectedAppsStore(this).load()

        startForeground(NOTIFICATION_ID, buildNotification())

        val builder = Builder()
            .setSession("HTTP Tools Companion")
            .addAddress("10.111.0.1", 32)
            .addRoute("0.0.0.0", 0)
            .addDnsServer("8.8.8.8")

        if (selectedApps.isEmpty()) {
            // Nothing selected yet — do not establish a tunnel that would capture
            // everything by default; require an explicit app selection first.
            stopSelf()
            return START_NOT_STICKY
        }

        selectedApps.forEach { pkg ->
            runCatching { builder.addAllowedApplication(pkg) }
        }

        tunFd = builder.establish()

        tunFd?.let { fd ->
            // TODO(companion-vpnservice-relay): hand `fd` and the stored PairingInfo
            // off to the native hev-socks5-tunnel engine (JNI) which reassembles
            // per-connection TCP streams from the tun interface and relays them as
            // SOCKS5 CONNECT to the paired Mac's SOCKS5 shim in front of Mockttp.
        }

        return START_STICKY
    }

    override fun onDestroy() {
        tunFd?.close()
        tunFd = null
        super.onDestroy()
    }

    override fun onRevoke() {
        // User revoked VPN permission from system settings — tear down cleanly.
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
        const val ACTION_START = "com.httptools.companion.vpn.START"
        const val ACTION_STOP = "com.httptools.companion.vpn.STOP"
    }
}
