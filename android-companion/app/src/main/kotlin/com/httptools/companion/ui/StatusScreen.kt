package com.httptools.companion.ui

import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.httptools.companion.cert.CaCertHelper
import com.httptools.companion.pairing.PairingInfo
import com.httptools.companion.vpn.CompanionVpnService

/**
 * Status screen: authoritative on/off toggle for the tunnel (fully controlled
 * on-device — a Mac-side disconnect can never leave this dangling since there
 * is no global state to revert), plus CA cert trust status and guided install.
 */
@Composable
fun StatusScreen(pairing: PairingInfo, caCertDer: ByteArray?, onPickApps: () -> Unit) {
    val context = LocalContext.current
    var vpnEnabled by remember { mutableStateOf(false) }
    var certTrusted by remember(caCertDer) {
        mutableStateOf(caCertDer?.let { CaCertHelper.isCertLikelyTrusted(context, it) } ?: false)
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Paired with ${pairing.host}:${pairing.port}")

        Text(if (certTrusted) "✅ CA certificate trusted" else "⚠️ CA certificate not yet trusted")
        if (!certTrusted && caCertDer != null) {
            Button(onClick = {
                context.startActivity(
                    CaCertHelper.createInstallIntent(caCertDer).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }) {
                Text("Install Certificate")
            }
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

        androidx.compose.foundation.layout.Row(
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
        ) {
            Text("Tunnel active")
            Switch(checked = vpnEnabled, onCheckedChange = { checked ->
                vpnEnabled = checked
                val serviceIntent = Intent(context, CompanionVpnService::class.java)
                if (checked) {
                    ContextCompat.startForegroundService(context, serviceIntent)
                } else {
                    context.stopService(serviceIntent)
                }
            })
        }
    }
}
