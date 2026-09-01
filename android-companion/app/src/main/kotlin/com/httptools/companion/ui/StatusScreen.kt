package com.httptools.companion.ui

import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.httptools.companion.cert.CaCertHelper
import com.httptools.companion.pairing.PairingInfo
import com.httptools.companion.vpn.CompanionVpnService
import hev.htproxy.TProxyService

/**
 * Status screen: authoritative on/off toggle for the tunnel (fully controlled
 * on-device — a Mac-side disconnect can never leave this dangling since there
 * is no global state to revert), plus CA cert trust status and guided install.
 */
@Composable
fun StatusScreen(pairing: PairingInfo, caCertDer: ByteArray?, onPickApps: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val selectedAppsStore = remember { com.httptools.companion.selection.SelectedAppsStore(context) }
    // Reflects the tunnel's actual native running state rather than purely local
    // optimistic UI state, so the switch can't desync from reality (e.g. after the
    // service was stopped externally, or on returning to this screen).
    var vpnEnabled by remember { mutableStateOf(runCatching { TProxyService.TProxyIsRunning() }.getOrDefault(false)) }
    var certTrusted by remember(caCertDer) {
        mutableStateOf(caCertDer?.let { CaCertHelper.isCertLikelyTrusted(context, it) } ?: false)
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                vpnEnabled = runCatching { TProxyService.TProxyIsRunning() }.getOrDefault(false)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Paired with ${pairing.host}:${pairing.port}")

        Text(if (certTrusted) "✅ CA certificate trusted" else "⚠️ CA certificate not yet trusted")
        if (!certTrusted && caCertDer != null) {
            Button(onClick = {
                context.startActivity(
                    CaCertHelper.createInstallIntent(context, caCertDer).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }) {
                Text("Install Certificate")
            }
            // Android 11+ (API 30+) no longer allows apps to trigger the CA install
            // flow directly to completion — CertInstaller shows a dialog explaining
            // the cert must be installed from Settings, then the user has to
            // navigate there themselves (Settings > Security > More security
            // settings > Encryption & credentials > Install a certificate > CA
            // certificate). Surface that explicitly and offer a shortcut into
            // Settings so the user isn't left guessing after tapping "Install
            // Certificate" above.
            Text(
                "On Android 11+, tapping Install Certificate opens a dialog that " +
                    "then requires finishing the install from Settings > Security > " +
                    "Encryption & credentials > Install a certificate > CA certificate."
            )
            androidx.compose.material3.TextButton(onClick = {
                context.startActivity(
                    Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }) {
                Text("Open Security Settings")
            }
        }
        if (caCertDer == null) {
            Text("Still fetching the CA certificate from the Mac — make sure it's reachable on the same network.")
        }
        if (caCertDer != null) {
            androidx.compose.material3.TextButton(onClick = {
                certTrusted = CaCertHelper.isCertLikelyTrusted(context, caCertDer)
            }) {
                Text("Recheck trust status")
            }
        }

        Button(onClick = onPickApps) {
            Text("Choose apps to intercept")
        }

        val selectedCount = selectedAppsStore.load().size
        if (selectedCount == 0) {
            Text("⚠️ No apps selected — the tunnel will not start until you choose at least one app.")
        } else {
            Text("$selectedCount app${if (selectedCount == 1) "" else "s"} selected for interception.")
        }

        androidx.compose.foundation.layout.Row(
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
        ) {
            Text("Tunnel active")
            Switch(checked = vpnEnabled, enabled = selectedCount > 0, onCheckedChange = { checked ->
                android.util.Log.i("StatusScreen", "Switch toggled to $checked")
                vpnEnabled = checked
                val serviceIntent = Intent(context, CompanionVpnService::class.java)
                if (checked) {
                    ContextCompat.startForegroundService(context, serviceIntent)
                } else {
                    // Don't rely on stopService()+onDestroy(): while the tunnel is
                    // established, Android's VPN subsystem holds its own binding to
                    // this service to track the VPN network's lifecycle, so
                    // stopService() only clears the "started" flag and does NOT
                    // trigger onDestroy() while that binding is active. Instead,
                    // explicitly tell the service to tear down the tunnel/tun fd
                    // itself via a dedicated stop action, which also calls stopSelf().
                    serviceIntent.action = CompanionVpnService.ACTION_STOP
                    context.startService(serviceIntent)
                }
            })
        }
    }
}
