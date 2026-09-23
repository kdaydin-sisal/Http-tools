/*
 ============================================================================
 Name        : hev-jni.c
 Author      : hev <r@hev.cc>
 Copyright   : Copyright (c) 2019 - 2023 hev
 Description : Jave Native Interface
 ============================================================================
 */

#ifdef ANDROID

#include <jni.h>
#include <pthread.h>
#include <stdatomic.h>

#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <string.h>

#include <hev-memory-allocator.h>

#include "hev-main.h"
#include "hev-jni.h"
#include "hev-logger.h"

/* clang-format off */
#ifndef PKGNAME
#define PKGNAME hev/htproxy
#endif
#ifndef CLSNAME
#define CLSNAME TProxyService
#endif
/* clang-format on */

#define STR(s) STR_ARG (s)
#define STR_ARG(c) #c
#define N_ELEMENTS(arr) (sizeof (arr) / sizeof ((arr)[0]))

typedef struct _ThreadData ThreadData;

struct _ThreadData
{
    char *path;
    int fd;
};

static atomic_int is_running;
static int thread_joinable;
static JavaVM *java_vm;
static pthread_t work_thread;
static pthread_mutex_t mutex;

/* Cached across the tunnel's lifetime (set once in JNI_OnLoad) so that
 * hev_jni_resolve_app_identity() -- called per new TCP session, from the
 * native worker thread -- never needs to re-resolve the class/method via
 * FindClass/GetStaticMethodID (which also aren't safe to call off the
 * thread that loaded the library without extra care). */
static jclass service_class;
static jmethodID resolve_identity_method;

static jboolean native_start_service (JNIEnv *env, jobject thiz,
                                      jstring conig_path, jint fd);
static jboolean native_stop_service (JNIEnv *env, jobject thiz);
static jboolean native_is_running (JNIEnv *env, jobject thiz);
static jlongArray native_get_stats (JNIEnv *env, jobject thiz);

static JNINativeMethod native_methods[] = {
    { "TProxyStartService", "(Ljava/lang/String;I)Z",
      (void *)native_start_service },
    { "TProxyStopService", "()Z", (void *)native_stop_service },
    { "TProxyIsRunning", "()Z", (void *)native_is_running },
    { "TProxyGetStats", "()[J", (void *)native_get_stats },
};

/*
 * hev_jni_resolve_app_identity() is invoked from hev-socks5-session-tcp.c's
 * construct path, which runs as a hev-task coroutine -- a cooperatively
 * scheduled "green thread" that hev-task-system executes by manually
 * swapping the CPU stack pointer onto a small, heap-allocated stack (see
 * _setjmp/_longjmp in hev-task-executer.c, and the raw asm stack switch in
 * hev-task-execute-*.s), NOT via a normal C function call/return from the
 * real pthread's own OS-allocated stack.
 *
 * ART's JNI implementation tracks "local reference frames" using the
 * native call stack itself: every JNI entry point validates its frame
 * against the actual C call chain that reached it. Because a coroutine's
 * stack is reached via a raw stack-pointer swap rather than a genuine
 * call chain from an attached thread's real stack, ART's bookkeeping
 * ends up inconsistent, and *any* JNI call made from that stack --
 * including a fully valid one -- can be reported as touching an "invalid
 * JNI transition frame reference" and aborts the whole process
 * (confirmed on-device via logcat: "JNI DETECTED ERROR IN APPLICATION:
 * ... jstring is an invalid JNI transition frame reference"). This is
 * not a stack-*size* problem -- switching to a bigger dedicated stack via
 * hev_task_call_jump() (an earlier fix attempt) does not help, because
 * that stack is *also* reached via a raw pointer swap, not a real call
 * chain.
 *
 * Fix: never call into JNI from a hev-task coroutine's stack at all.
 * Run a small dedicated pthread ("identity thread") that has a normal,
 * OS-allocated call stack, attaches to the JVM exactly once right after
 * it starts, and then only ever runs JNI calls from that one place.
 * hev_jni_resolve_app_identity() (called synchronously from the tunnel's
 * coroutine) simply hands off the request under a mutex and blocks on a
 * condition variable for the response.
 */
static pthread_t identity_thread;
static pthread_once_t identity_thread_once = PTHREAD_ONCE_INIT;
static pthread_mutex_t identity_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t identity_req_cond = PTHREAD_COND_INITIALIZER;
static pthread_cond_t identity_res_cond = PTHREAD_COND_INITIALIZER;
static int identity_req_pending;
static int identity_res_ready;

/* Request, filled in by hev_jni_resolve_app_identity() under identity_mutex,
 * read by identity_thread_main() under the same mutex. */
static int identity_req_protocol;
static const char *identity_req_local_addr;
static int identity_req_local_port;
static const char *identity_req_remote_addr;
static int identity_req_remote_port;

/* Response, filled in by identity_thread_main() under identity_mutex. */
static int identity_res_res;
static char *identity_res_device_id;
static char *identity_res_package_id;

static void
identity_resolve_once (JNIEnv *env)
{
    jstring j_local_addr = NULL;
    jstring j_remote_addr = NULL;
    jstring j_result = NULL;
    const char *result_utf = NULL;
    const char *sep;

    identity_res_res = -1;
    identity_res_device_id = NULL;
    identity_res_package_id = NULL;

    j_local_addr = (*env)->NewStringUTF (env, identity_req_local_addr);
    j_remote_addr = (*env)->NewStringUTF (env, identity_req_remote_addr);
    if (!j_local_addr || !j_remote_addr)
        goto cleanup;

    j_result = (*env)->CallStaticObjectMethod (
        env, service_class, resolve_identity_method,
        (jint)identity_req_protocol, j_local_addr,
        (jint)identity_req_local_port, j_remote_addr,
        (jint)identity_req_remote_port);

    if ((*env)->ExceptionCheck (env)) {
        LOG_W ("hev_jni_resolve_app_identity: Kotlin call threw an exception");
        (*env)->ExceptionClear (env);
        goto cleanup;
    }

    if (!j_result) {
        LOG_D ("hev_jni_resolve_app_identity: Kotlin returned null");
        goto cleanup;
    }

    result_utf = (*env)->GetStringUTFChars (env, j_result, NULL);
    if (!result_utf)
        goto cleanup;

    LOG_D ("hev_jni_resolve_app_identity: Kotlin returned \"%s\" for "
          "local=%s:%d remote=%s:%d",
          result_utf, identity_req_local_addr, identity_req_local_port,
          identity_req_remote_addr, identity_req_remote_port);

    /* Expected wire format from Kotlin: "<deviceId>|<packageId>". */
    sep = strchr (result_utf, '|');
    if (sep && sep != result_utf && sep[1] != '\0') {
        size_t device_len = sep - result_utf;
        size_t package_len = strlen (sep + 1);
        char *device_id = hev_malloc (device_len + 1);
        char *package_id = hev_malloc (package_len + 1);

        if (device_id && package_id) {
            memcpy (device_id, result_utf, device_len);
            device_id[device_len] = '\0';
            memcpy (package_id, sep + 1, package_len);
            package_id[package_len] = '\0';
            identity_res_device_id = device_id;
            identity_res_package_id = package_id;
            identity_res_res = 0;
        } else {
            hev_free (device_id);
            hev_free (package_id);
        }
    }

cleanup:
    if (result_utf)
        (*env)->ReleaseStringUTFChars (env, j_result, result_utf);
    if (j_local_addr)
        (*env)->DeleteLocalRef (env, j_local_addr);
    if (j_remote_addr)
        (*env)->DeleteLocalRef (env, j_remote_addr);
    if (j_result)
        (*env)->DeleteLocalRef (env, j_result);
}

static void *
identity_thread_main (void *data)
{
    JNIEnv *env = NULL;

    if ((*java_vm)->AttachCurrentThread (java_vm, &env, NULL) != JNI_OK) {
        LOG_E ("identity_thread_main: failed to attach JVM");
        return NULL;
    }

    pthread_mutex_lock (&identity_mutex);
    for (;;) {
        while (!identity_req_pending)
            pthread_cond_wait (&identity_req_cond, &identity_mutex);

        identity_resolve_once (env);

        identity_req_pending = 0;
        identity_res_ready = 1;
        pthread_cond_signal (&identity_res_cond);
    }
    pthread_mutex_unlock (&identity_mutex);

    return NULL;
}

static void
identity_thread_start (void)
{
    pthread_create (&identity_thread, NULL, identity_thread_main, NULL);
}

int
hev_jni_resolve_app_identity (int protocol, const char *local_addr,
                              int local_port, const char *remote_addr,
                              int remote_port, char **out_device_id,
                              char **out_package_id)
{
    int res;

    *out_device_id = NULL;
    *out_package_id = NULL;

    if (!service_class || !resolve_identity_method) {
        LOG_W ("hev_jni_resolve_app_identity: service_class/method not cached "
              "(JNI_OnLoad lookup failed?)");
        return -1;
    }

    pthread_once (&identity_thread_once, identity_thread_start);

    pthread_mutex_lock (&identity_mutex);

    identity_req_protocol = protocol;
    identity_req_local_addr = local_addr;
    identity_req_local_port = local_port;
    identity_req_remote_addr = remote_addr;
    identity_req_remote_port = remote_port;
    identity_req_pending = 1;
    identity_res_ready = 0;
    pthread_cond_signal (&identity_req_cond);

    while (!identity_res_ready)
        pthread_cond_wait (&identity_res_cond, &identity_mutex);

    res = identity_res_res;
    *out_device_id = identity_res_device_id;
    *out_package_id = identity_res_package_id;

    pthread_mutex_unlock (&identity_mutex);

    return res;
}

jint
JNI_OnLoad (JavaVM *vm, void *reserved)
{
    JNIEnv *env = NULL;
    jclass klass;
    jint res;

    java_vm = vm;
    res = (*vm)->GetEnv (vm, (void **)&env, JNI_VERSION_1_4);
    if (res != JNI_OK)
        return JNI_ERR;

    klass = (*env)->FindClass (env, STR (PKGNAME) "/" STR (CLSNAME));
    if (!klass) {
        LOG_E ("JNI_OnLoad: FindClass(" STR (PKGNAME) "/" STR (CLSNAME) ") failed");
        return JNI_ERR;
    }
    res = (*env)->RegisterNatives (env, klass, native_methods,
                                   N_ELEMENTS (native_methods));
    if (res == 0) {
        service_class = (*env)->NewGlobalRef (env, klass);
        resolve_identity_method = (*env)->GetStaticMethodID (
            env, klass, "resolveAppIdentity",
            "(ILjava/lang/String;ILjava/lang/String;I)Ljava/lang/String;");
        // Non-fatal if missing (e.g. an older companion app build without
        // this method) -- hev_jni_resolve_app_identity() checks both are
        // set before ever calling in, so captures simply stay untagged.
        if (!resolve_identity_method) {
            LOG_W ("JNI_OnLoad: resolveAppIdentity method not found");
            (*env)->ExceptionClear (env);
        } else {
            LOG_I ("JNI_OnLoad: resolveAppIdentity method cached OK");
        }
    }
    (*env)->DeleteLocalRef (env, klass);
    if (res < 0)
        return JNI_ERR;

    pthread_mutex_init (&mutex, NULL);

    return JNI_VERSION_1_4;
}

static void *
thread_handler (void *data)
{
    ThreadData *tdata = data;

    /* No JNI is attached/used on this thread: all JNI calls now happen
     * exclusively on the dedicated identity_thread (see
     * hev_jni_resolve_app_identity() above), which has its own normal,
     * OS-allocated call stack rather than one of hev-task-system's
     * coroutine stacks. See the large comment above
     * identity_resolve_once() for why that separation is required. */
    hev_socks5_tunnel_main (tdata->path, tdata->fd);

    atomic_store_explicit (&is_running, 0, memory_order_release);

    free (tdata->path);
    free (tdata);

    return NULL;
}

static jboolean
native_start_service (JNIEnv *env, jobject thiz, jstring config_path, jint fd)
{
    const jbyte *bytes;
    ThreadData *tdata;
    int res;
    jboolean result = JNI_FALSE;

    pthread_mutex_lock (&mutex);

    if (atomic_load_explicit (&is_running, memory_order_acquire))
        goto exit;

    if (thread_joinable) {
        pthread_join (work_thread, NULL);
        thread_joinable = 0;
    }

    tdata = malloc (sizeof (ThreadData));
    if (!tdata)
        goto exit;
    tdata->fd = fd;

    bytes = (const jbyte *)(*env)->GetStringUTFChars (env, config_path, NULL);
    if (!bytes) {
        free (tdata);
        goto exit;
    }
    tdata->path = strdup ((const char *)bytes);
    (*env)->ReleaseStringUTFChars (env, config_path, (const char *)bytes);
    if (!tdata->path) {
        free (tdata);
        goto exit;
    }

    atomic_store_explicit (&is_running, 1, memory_order_release);
    res = pthread_create (&work_thread, NULL, thread_handler, tdata);
    if (res != 0) {
        atomic_store_explicit (&is_running, 0, memory_order_release);
        free (tdata->path);
        free (tdata);
        goto exit;
    }

    thread_joinable = 1;
    result = JNI_TRUE;
exit:
    pthread_mutex_unlock (&mutex);
    return result;
}

static jboolean
native_stop_service (JNIEnv *env, jobject thiz)
{
    int res = 0;

    pthread_mutex_lock (&mutex);

    if (!thread_joinable)
        goto exit;

    if (atomic_load_explicit (&is_running, memory_order_acquire))
        hev_socks5_tunnel_quit ();
    res = pthread_join (work_thread, NULL);

    thread_joinable = 0;
    atomic_store_explicit (&is_running, 0, memory_order_release);
exit:
    pthread_mutex_unlock (&mutex);
    return res == 0 ? JNI_TRUE : JNI_FALSE;
}

static jboolean
native_is_running (JNIEnv *env, jobject thiz)
{
    return atomic_load_explicit (&is_running, memory_order_acquire) ? JNI_TRUE :
                                                                      JNI_FALSE;
}

static jlongArray
native_get_stats (JNIEnv *env, jobject thiz)
{
    size_t tx_packets, rx_packets, tx_bytes, rx_bytes;
    jlongArray res;
    jlong array[4];

    hev_socks5_tunnel_stats (&tx_packets, &tx_bytes, &rx_packets, &rx_bytes);
    array[0] = tx_packets;
    array[1] = tx_bytes;
    array[2] = rx_packets;
    array[3] = rx_bytes;

    res = (*env)->NewLongArray (env, 4);
    (*env)->SetLongArrayRegion (env, res, 0, 4, array);

    return res;
}

#endif /* ANDROID */
