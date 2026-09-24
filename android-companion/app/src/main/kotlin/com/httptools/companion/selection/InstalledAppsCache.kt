package com.httptools.companion.selection

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** A single installed app entry as shown in the app picker. */
data class InstalledAppInfo(val packageName: String, val label: String)

/**
 * Caches the installed-apps list computed by [com.httptools.companion.ui.AppPickerScreen]
 * so reopening the "Choose apps to intercept" screen doesn't have to re-query
 * `PackageManager` (slow on devices with many installed apps) every single time.
 * The cache is only invalidated by an explicit "Refresh list" tap, since Android
 * gives no lightweight signal for "a new app was installed" that's worth wiring
 * up here.
 */
class InstalledAppsCache(context: Context) {
    private val prefs = context.getSharedPreferences("installed_apps_cache", Context.MODE_PRIVATE)

    fun load(): List<InstalledAppInfo>? {
        val raw = prefs.getString(KEY_APPS, null) ?: return null
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { index ->
                val entry = array.getJSONObject(index)
                InstalledAppInfo(entry.getString("packageName"), entry.getString("label"))
            }
        }.getOrNull()
    }

    fun save(apps: List<InstalledAppInfo>) {
        val array = JSONArray()
        for (app in apps) {
            array.put(
                JSONObject().apply {
                    put("packageName", app.packageName)
                    put("label", app.label)
                }
            )
        }
        prefs.edit().putString(KEY_APPS, array.toString()).apply()
    }

    private companion object {
        const val KEY_APPS = "apps"
    }
}
