package hev.htproxy

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import android.util.Log
import java.net.InetSocketAddress
import java.util.UUID

/**
 * JNI binding for hev-socks5-tunnel's native library. The package/class name here
 * (`hev.htproxy.TProxyService`) must match the `PKGNAME`/`CLSNAME` macros baked into
 * hev-socks5-tunnel's `src/hev-jni.c` (defaults: `hev/htproxy` / `TProxyService`) —
 * `JNI_OnLoad` looks up this exact class via `FindClass` and registers natives on it.
 *
 * [com.httptools.companion.vpn.CompanionVpnService] is the actual call site; this
 * object only exists to satisfy the native library's hardcoded lookup path.
 */
object TProxyService {
    private const val TAG = "TProxyService"
    private const val PREFS_NAME = "tproxy_service"
    private const val PREF_DEVICE_ID = "device_id"

    /** Set once at VPN start by [com.httptools.companion.vpn.CompanionVpnService]. */
    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var cachedDeviceId: String? = null

    init {
        System.loadLibrary("hev-socks5-tunnel")
    }

    @JvmStatic external fun TProxyStartService(configPath: String, tunFd: Int): Boolean
    @JvmStatic external fun TProxyStopService(): Boolean
    @JvmStatic external fun TProxyIsRunning(): Boolean
    @JvmStatic external fun TProxyGetStats(): LongArray

    /**
     * Must be called (with an application context, to avoid leaking an Activity)
     * before the native tunnel starts, so [resolveAppIdentity] has what it needs
     * when the native side calls back into it for each new TCP session.
     */
    @JvmStatic
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /**
     * Called from native code (hev-jni.c's `hev_jni_resolve_app_identity`) on the
     * tunnel's own worker thread, once per new TCP session, to resolve which app
     * on the device owns it. Returns `"<deviceId>|<packageId>"` on success, or
     * `""` when unresolvable -- this includes devices below API 29 (which lack
     * [ConnectivityManager.getConnectionOwnerUid]), lookup failures, and any
     * unexpected exception. This method must never throw across the JNI
     * boundary, so every failure path is caught and mapped to `""` instead.
     *
     * [localAddr]/[localPort] must be the connecting app's own source endpoint
     * and [remoteAddr]/[remotePort] the destination it's connecting to, per
     * [ConnectivityManager.getConnectionOwnerUid]'s own contract.
     */
    @Suppress("unused") // called from native code
    @JvmStatic
    fun resolveAppIdentity(
        protocol: Int,
        localAddr: String,
        localPort: Int,
        remoteAddr: String,
        remotePort: Int
    ): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Log.d(TAG, "resolveAppIdentity: unsupported SDK ${Build.VERSION.SDK_INT}")
            return ""
        }

        val context = appContext ?: run {
            Log.w(TAG, "resolveAppIdentity: no appContext (init() not called yet?)")
            return ""
        }

        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: run {
                    Log.w(TAG, "resolveAppIdentity: no ConnectivityManager")
                    return ""
                }
            val uid = cm.getConnectionOwnerUid(
                protocol,
                InetSocketAddress(localAddr, localPort),
                InetSocketAddress(remoteAddr, remotePort)
            )
            if (uid < 0) {
                Log.d(TAG, "resolveAppIdentity: no owner uid for proto=$protocol local=$localAddr:$localPort remote=$remoteAddr:$remotePort")
                return ""
            }

            val packageName = packageNameForUid(context, uid) ?: run {
                Log.w(TAG, "resolveAppIdentity: uid $uid has no package name")
                return ""
            }
            Log.d(TAG, "resolveAppIdentity: resolved uid=$uid package=$packageName for local=$localAddr:$localPort remote=$remoteAddr:$remotePort")
            "${deviceId(context)}|$packageName"
        } catch (e: Exception) {
            Log.w(TAG, "resolveAppIdentity: exception for local=$localAddr:$localPort remote=$remoteAddr:$remotePort", e)
            ""
        }
    }

    private fun packageNameForUid(context: Context, uid: Int): String? {
        val packages = context.packageManager.getPackagesForUid(uid)
        // A UID can back multiple packages (shared UID apps); the first is a
        // reasonable, stable-enough choice for attribution/display purposes.
        return packages?.firstOrNull()
    }

    /**
     * A stable per-install identifier for this device, persisted in
     * SharedPreferences and generated once on first use. Distinguishes captures
     * from this device from any other device that may pair with the same Mac,
     * matching the `deviceId` field the Mac side's dashboard groups/filters by.
     */
    @SuppressLint("ApplySharedPref")
    private fun deviceId(context: Context): String {
        cachedDeviceId?.let { return it }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getString(PREF_DEVICE_ID, null)
        val id = existing ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(PREF_DEVICE_ID, it).commit()
        }
        cachedDeviceId = id
        return id
    }
}
