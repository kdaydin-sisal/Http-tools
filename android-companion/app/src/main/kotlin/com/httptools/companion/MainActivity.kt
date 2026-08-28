package com.httptools.companion

import android.net.VpnService
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.httptools.companion.pairing.PairingInfo
import com.httptools.companion.pairing.PairingScreen
import com.httptools.companion.pairing.PairingStore
import com.httptools.companion.ui.AppPickerScreen
import com.httptools.companion.ui.StatusScreen

class MainActivity : ComponentActivity() {

    private val requestVpnPermission = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { /* result handled implicitly: user can retry the toggle if declined */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // VpnService requires one-time user consent via a system dialog; request it
        // up front so the in-app toggle on the status screen "just works" afterward.
        VpnService.prepare(this)?.let { consentIntent ->
            requestVpnPermission.launch(consentIntent)
        }

        setContent {
            val pairingStore = remember { PairingStore(this) }
            var pairing by remember { mutableStateOf(pairingStore.load()) }
            val navController = rememberNavController()

            Box(
                Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing)
            ) {
                NavHost(navController = navController, startDestination = "pairing") {
                    composable("pairing") {
                        if (pairing != null && pairing?.isExpired == false) {
                            StatusRoute(pairing!!, navController)
                        } else {
                            PairingScreen(onPaired = { info: PairingInfo ->
                                pairingStore.save(info)
                                pairing = info
                                navController.navigate("status") { popUpTo("pairing") { inclusive = true } }
                            })
                        }
                    }
                    composable("status") {
                        pairing?.let { StatusRoute(it, navController) }
                    }
                    composable("apps") {
                        AppPickerScreen(onDone = { navController.popBackStack() })
                    }
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun StatusRoute(pairing: PairingInfo, navController: androidx.navigation.NavController) {
    // CA cert bytes are fetched from the paired Mac's existing /api/ca-cert-style endpoint
    // once wired (companion-cert-trust todo); left null here in the initial scaffold.
    StatusScreen(pairing = pairing, caCertPem = null, onPickApps = { navController.navigate("apps") })
}
