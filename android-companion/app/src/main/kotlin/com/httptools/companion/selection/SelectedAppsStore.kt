package com.httptools.companion.selection

import android.content.Context

/** Persists the set of package names the user has chosen to route through the VPN tunnel. */
class SelectedAppsStore(context: Context) {
    private val prefs = context.getSharedPreferences("selected_apps", Context.MODE_PRIVATE)

    fun load(): Set<String> = prefs.getStringSet("packages", emptySet()) ?: emptySet()

    fun save(packages: Set<String>) {
        prefs.edit().putStringSet("packages", packages).apply()
    }
}
