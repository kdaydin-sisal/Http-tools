package com.httptools.companion.pairing

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.httptools.companion.discovery.MdnsDiscovery
import com.httptools.companion.discovery.MdnsDiscovery.Companion.toPairingInfo
import java.util.concurrent.Executors

/**
 * Pairing screen: QR scan is the primary flow (camera preview + ML Kit barcode
 * decoding of the payload from the Mac's onboarding page). If camera permission
 * is denied or no camera hardware exists, we fall back to listing devices found
 * via mDNS/NSD auto-discovery instead of requiring any manual host/port entry.
 */
@Composable
fun PairingScreen(onPaired: (PairingInfo) -> Unit) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    var permissionRequested by remember { mutableStateOf(false) }
    var cameraDenied by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
        cameraDenied = !granted
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission && !permissionRequested) {
            permissionRequested = true
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    if (hasCameraPermission && !cameraDenied) {
        QrScannerView(onPaired = onPaired, onPermissionDenied = { cameraDenied = true })
    } else if (permissionRequested) {
        // Permission flow has resolved (granted/denied) — show the appropriate view.
        MdnsFallbackView(onPaired = onPaired, onRetryCamera = {
            hasCameraPermission = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
            if (hasCameraPermission) {
                cameraDenied = false
            } else {
                permissionLauncher.launch(Manifest.permission.CAMERA)
            }
        })
    }
}

@Composable
private fun QrScannerView(onPaired: (PairingInfo) -> Unit, onPermissionDenied: () -> Unit) {
    val context = LocalContext.current
    var lastError by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Scan the pairing QR code shown on the Mac onboarding page")
        Box(Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    val previewView = PreviewView(ctx)
                    val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                    val executor = Executors.newSingleThreadExecutor()
                    val scanner = BarcodeScanning.getClient()

                    cameraProviderFuture.addListener({
                        val cameraProvider = cameraProviderFuture.get()
                        val preview = Preview.Builder().build().also {
                            it.surfaceProvider = previewView.surfaceProvider
                        }
                        val analysis = ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()

                        analysis.setAnalyzer(executor) { imageProxy ->
                            val mediaImage = imageProxy.image
                            if (mediaImage != null) {
                                val image = InputImage.fromMediaImage(
                                    mediaImage,
                                    imageProxy.imageInfo.rotationDegrees
                                )
                                scanner.process(image)
                                    .addOnSuccessListener { barcodes ->
                                        barcodes.firstNotNullOfOrNull { it.rawValue }?.let { raw ->
                                            val info = PairingStore.parse(raw)
                                            if (info != null && !info.isExpired) {
                                                onPaired(info)
                                            } else {
                                                lastError = "Invalid or expired QR code"
                                            }
                                        }
                                    }
                                    .addOnCompleteListener { imageProxy.close() }
                            } else {
                                imageProxy.close()
                            }
                        }

                        try {
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                ctx as androidx.lifecycle.LifecycleOwner,
                                CameraSelector.DEFAULT_BACK_CAMERA,
                                preview,
                                analysis
                            )
                        } catch (e: Exception) {
                            onPermissionDenied()
                        }
                    }, ContextCompat.getMainExecutor(ctx))

                    previewView
                }
            )
        }
        lastError?.let { Text(it) }
        Button(onClick = onPermissionDenied) {
            Text("Use device discovery instead")
        }
    }
}

@Composable
private fun MdnsFallbackView(onPaired: (PairingInfo) -> Unit, onRetryCamera: () -> Unit) {
    val context = LocalContext.current
    val discovery = remember { MdnsDiscovery(context) }
    var found by remember { mutableStateOf(listOf<MdnsDiscovery.DiscoveredService>()) }

    LaunchedEffect(Unit) {
        discovery.discover().collect { service ->
            found = (found + service).distinctBy { it.name }
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Camera unavailable — searching for the Mac tool on your network…")
        found.forEach { service ->
            Button(onClick = {
                service.toPairingInfo()?.let(onPaired)
            }) {
                Text("${service.name} (${service.host}:${service.port})")
            }
        }
        Button(onClick = onRetryCamera) {
            Text("Try camera again")
        }
    }
}
