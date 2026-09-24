package com.httptools.companion.ui

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.httptools.companion.selection.InstalledAppInfo
import com.httptools.companion.selection.InstalledAppsCache
import com.httptools.companion.selection.SelectedAppsStore

/**
 * Lets the user choose which installed apps get routed through the VPN tunnel.
 * Only these apps' traffic is captured (via VpnService.Builder.addAllowedApplication);
 * everything else on the device continues using direct networking untouched.
 *
 * Selection is applied explicitly via the bottom "Apply" button rather than
 * per-checkbox-toggle, so browsing/searching doesn't silently mutate the saved
 * selection; the back arrow discards any in-progress changes. The installed-apps
 * list itself is cached on first fetch (querying PackageManager is slow with many
 * apps installed) and only re-queried when the user taps "Refresh list".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppPickerScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val store = remember { SelectedAppsStore(context) }
    val cache = remember { InstalledAppsCache(context) }
    val pm = context.packageManager

    fun queryInstalledApps(): List<InstalledAppInfo> {
        // Primary source: apps with a launcher entry (what the user can actually open).
        // Also merge in any additional non-system apps without a launcher activity
        // (e.g. ".test"/instrumentation build variants) so they remain selectable —
        // otherwise test/debug app variants silently disappear from the picker.
        val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val launchablePackages = pm.queryIntentActivities(launcherIntent, 0)
            .map { it.activityInfo.packageName }
            .toSet()

        val allNonSystem = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 || it.packageName in launchablePackages }

        return allNonSystem
            .map { InstalledAppInfo(it.packageName, pm.getApplicationLabel(it).toString()) }
            .sortedBy { it.label.lowercase() }
    }

    var installedApps by remember { mutableStateOf(cache.load() ?: emptyList()) }
    var isLoading by remember { mutableStateOf(installedApps.isEmpty()) }
    var searchQuery by remember { mutableStateOf("") }
    // Local draft selection: only persisted to SelectedAppsStore on "Apply", so
    // browsing/searching this screen can't silently change what's intercepted.
    var selected by remember { mutableStateOf(store.load()) }

    fun refresh() {
        isLoading = true
        val fresh = queryInstalledApps()
        installedApps = fresh
        cache.save(fresh)
        isLoading = false
    }

    LaunchedEffect(Unit) {
        if (installedApps.isEmpty()) refresh()
    }

    val filteredApps = if (searchQuery.isBlank()) {
        installedApps
    } else {
        installedApps.filter {
            it.label.contains(searchQuery, ignoreCase = true) || it.packageName.contains(searchQuery, ignoreCase = true)
        }
    }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = { Text("Choose Apps to Intercept") },
                    navigationIcon = {
                        IconButton(onClick = onDone) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    },
                    actions = {
                        IconButton(onClick = { refresh() }) {
                            Icon(Icons.Filled.Refresh, contentDescription = "Refresh installed apps list")
                        }
                    }
                )
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    placeholder = { Text("Search installed apps") },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = { searchQuery = "" }) {
                                Icon(Icons.Filled.Clear, contentDescription = "Clear search")
                            }
                        }
                    },
                    singleLine = true
                )
            }
        },
        bottomBar = {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = { selected = emptySet() },
                    modifier = Modifier.weight(1f),
                    enabled = selected.isNotEmpty()
                ) {
                    Text("Clear Selection")
                }
                Button(
                    onClick = {
                        store.save(selected)
                        onDone()
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Apply (${selected.size})")
                }
            }
        }
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                isLoading -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
                filteredApps.isEmpty() -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            if (searchQuery.isBlank()) "No apps found." else "No apps match \"$searchQuery\".",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                else -> {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(filteredApps, key = { it.packageName }) { app ->
                            val isSelected = selected.contains(app.packageName)
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        selected = if (isSelected) selected - app.packageName else selected + app.packageName
                                    }
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Checkbox(
                                    checked = isSelected,
                                    onCheckedChange = { checked ->
                                        selected = if (checked) selected + app.packageName else selected - app.packageName
                                    }
                                )
                                Column(Modifier.padding(start = 8.dp)) {
                                    Text(app.label, fontWeight = FontWeight.Medium)
                                    Text(
                                        app.packageName,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
                        }
                    }
                }
            }
        }
    }
}
