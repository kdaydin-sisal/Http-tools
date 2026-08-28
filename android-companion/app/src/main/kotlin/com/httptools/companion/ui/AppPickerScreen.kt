package com.httptools.companion.ui

import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.httptools.companion.selection.SelectedAppsStore

/**
 * Lets the user choose which installed apps get routed through the VPN tunnel.
 * Only these apps' traffic is captured (via VpnService.Builder.addAllowedApplication);
 * everything else on the device continues using direct networking untouched.
 */
@Composable
fun AppPickerScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val store = remember { SelectedAppsStore(context) }
    val pm = context.packageManager

    val installedApps = remember {
        pm.getInstalledApplications(PackageManager.GET_META_DATA)
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 }
            .sortedBy { pm.getApplicationLabel(it).toString().lowercase() }
    }

    var selected by remember { mutableStateOf(store.load()) }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Choose which apps to route through the interception tunnel:")
        LazyColumn(Modifier.fillMaxSize().padding(top = 8.dp)) {
            items(installedApps) { app ->
                val packageName = app.packageName
                val label = pm.getApplicationLabel(app).toString()
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Checkbox(
                        checked = selected.contains(packageName),
                        onCheckedChange = { checked ->
                            selected = if (checked) selected + packageName else selected - packageName
                            store.save(selected)
                        }
                    )
                    Text(label)
                }
            }
        }
        Button(onClick = onDone) {
            Text("Done (${selected.size} app${if (selected.size == 1) "" else "s"} selected)")
        }
    }
}
