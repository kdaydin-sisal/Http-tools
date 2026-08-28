package hev.htproxy

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
    init {
        System.loadLibrary("hev-socks5-tunnel")
    }

    @JvmStatic external fun TProxyStartService(configPath: String, tunFd: Int): Boolean
    @JvmStatic external fun TProxyStopService(): Boolean
    @JvmStatic external fun TProxyIsRunning(): Boolean
    @JvmStatic external fun TProxyGetStats(): LongArray
}
