package com.httptools.companion.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material.icons.filled.WifiTethering
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.httptools.companion.cert.CaCertHelper
import com.httptools.companion.pairing.PairingInfo
import com.httptools.companion.selection.SelectedAppsStore
import com.httptools.companion.ui.theme.StatusColors
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
    val selectedAppsStore = remember { SelectedAppsStore(context) }
    // Reflects the tunnel's actual native running state rather than purely local
    // optimistic UI state, so the switch can't desync from reality (e.g. after the
    // service was stopped externally, or on returning to this screen).
    var vpnEnabled by remember { mutableStateOf(runCatching { TProxyService.TProxyIsRunning() }.getOrDefault(false)) }
    var certTrusted by remember(caCertDer) {
        mutableStateOf(caCertDer?.let { CaCertHelper.isCertLikelyTrusted(context, it) } ?: false)
    }
    var selectedCount by remember { mutableStateOf(selectedAppsStore.load().size) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                vpnEnabled = runCatching { TProxyService.TProxyIsRunning() }.getOrDefault(false)
                selectedCount = selectedAppsStore.load().size
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("HTTP Tools", style = MaterialTheme.typography.titleLarge)
        Text(
            "Companion app for intercepting this device's traffic.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        StatusCard(
            icon = Icons.Filled.Wifi,
            iconTint = StatusColors.success,
            title = "Paired",
            subtitle = "${pairing.host}:${pairing.port}"
        )

        CertificateTrustCard(certTrusted, caCertDer, onRecheck = {
            certTrusted = caCertDer?.let { CaCertHelper.isCertLikelyTrusted(context, it) } ?: false
        })

        StatusCard(
            icon = Icons.Filled.Apps,
            iconTint = MaterialTheme.colorScheme.primary,
            title = "Apps to Intercept",
            subtitle = if (selectedCount == 0) {
                "No apps selected yet"
            } else {
                "$selectedCount app${if (selectedCount == 1) "" else "s"} selected"
            }
        ) {
            Button(onClick = onPickApps) {
                Text("Choose Apps")
            }
        }

        TunnelControlCard(
            vpnEnabled = vpnEnabled,
            enabled = selectedCount > 0,
            onToggle = { checked ->
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
            }
        )
    }
}

@Composable
private fun StatusCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: Color,
    title: String,
    subtitle: String,
    trailingContent: (@Composable () -> Unit)? = null
) {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(28.dp))
            Column(
                Modifier
                    .padding(start = 12.dp)
                    .weight(1f)
            ) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            trailingContent?.invoke()
        }
    }
}

@Composable
private fun CertificateTrustCard(certTrusted: Boolean, caCertDer: ByteArray?, onRecheck: () -> Unit) {
    val context = LocalContext.current
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (certTrusted) Icons.Filled.CheckCircle else Icons.Filled.Warning,
                    contentDescription = null,
                    tint = if (certTrusted) StatusColors.success else StatusColors.warning,
                    modifier = Modifier.size(28.dp)
                )
                Column(Modifier.padding(start = 12.dp)) {
                    Text("CA Certificate", fontWeight = FontWeight.SemiBold)
                    Text(
                        if (certTrusted) "Trusted" else "Not yet trusted",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (caCertDer == null) {
                Spacer(Modifier.height(10.dp))
                Text(
                    "Still fetching the CA certificate from the Mac — make sure it's reachable on the same network.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (!certTrusted && caCertDer != null) {
                Spacer(Modifier.height(10.dp))
                Button(onClick = {
                    context.startActivity(
                        CaCertHelper.createInstallIntent(context, caCertDer).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }) {
                    Text("Install Certificate")
                }
                Spacer(Modifier.height(8.dp))
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
                        "Encryption & credentials > Install a certificate > CA certificate.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TextButton(onClick = {
                    context.startActivity(
                        Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }) {
                    Text("Open Security Settings")
                }
            }

            if (caCertDer != null) {
                TextButton(onClick = onRecheck) {
                    Text("Recheck Trust Status")
                }
            }
        }
    }
}

@Composable
private fun TunnelControlCard(vpnEnabled: Boolean, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (vpnEnabled) StatusColors.success.copy(alpha = 0.14f) else MaterialTheme.colorScheme.surface
        )
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Filled.WifiTethering,
                        contentDescription = null,
                        tint = if (vpnEnabled) StatusColors.success else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(28.dp)
                    )
                    Column(Modifier.padding(start = 12.dp)) {
                        Text("Interception Tunnel", fontWeight = FontWeight.SemiBold)
                        Text(
                            if (vpnEnabled) "Active — capturing traffic" else "Inactive",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                Switch(checked = vpnEnabled, enabled = enabled, onCheckedChange = onToggle)
            }
            if (!enabled) {
                Spacer(Modifier.height(10.dp))
                Text(
                    "⚠️ No apps selected — the tunnel will not start until you choose at least one app.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = StatusColors.warning
                )
            }
        }
    }
}
