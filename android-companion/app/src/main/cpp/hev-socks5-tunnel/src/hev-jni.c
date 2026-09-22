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
static pthread_key_t current_jni_env;

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

static void
detach_current_thread (void *env)
{
    (*java_vm)->DetachCurrentThread (java_vm);
}

/*
 * Returns a JNIEnv valid for the calling thread, attaching it to the JVM
 * (and registering a destructor to detach it on thread exit) the first
 * time this is called from that thread. Needed because
 * hev_jni_resolve_app_identity() is called from the tunnel's own native
 * worker thread (started in thread_handler() below), which the JVM knows
 * nothing about until we attach it explicitly.
 */
static JNIEnv *
get_jni_env (void)
{
    JNIEnv *env;

    env = pthread_getspecific (current_jni_env);
    if (env)
        return env;

    if ((*java_vm)->GetEnv (java_vm, (void **)&env, JNI_VERSION_1_4) == JNI_OK) {
        pthread_setspecific (current_jni_env, env);
        return env;
    }

    if ((*java_vm)->AttachCurrentThread (java_vm, &env, NULL) != JNI_OK)
        return NULL;

    pthread_setspecific (current_jni_env, env);
    return env;
}

int
hev_jni_resolve_app_identity (int protocol, const char *local_addr,
                              int local_port, const char *remote_addr,
                              int remote_port, char **out_device_id,
                              char **out_package_id)
{
    JNIEnv *env;
    jstring j_local_addr = NULL;
    jstring j_remote_addr = NULL;
    jstring j_result = NULL;
    const char *result_utf = NULL;
    const char *sep;
    int res = -1;

    *out_device_id = NULL;
    *out_package_id = NULL;

    if (!service_class || !resolve_identity_method)
        return -1;

    env = get_jni_env ();
    if (!env)
        return -1;

    j_local_addr = (*env)->NewStringUTF (env, local_addr);
    j_remote_addr = (*env)->NewStringUTF (env, remote_addr);
    if (!j_local_addr || !j_remote_addr)
        goto cleanup;

    j_result = (*env)->CallStaticObjectMethod (
        env, service_class, resolve_identity_method, (jint)protocol,
        j_local_addr, (jint)local_port, j_remote_addr, (jint)remote_port);

    if ((*env)->ExceptionCheck (env)) {
        (*env)->ExceptionClear (env);
        goto cleanup;
    }

    if (!j_result)
        goto cleanup;

    result_utf = (*env)->GetStringUTFChars (env, j_result, NULL);
    if (!result_utf)
        goto cleanup;

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
            *out_device_id = device_id;
            *out_package_id = package_id;
            res = 0;
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
    if (!klass)
        return JNI_ERR;
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
        if (!resolve_identity_method)
            (*env)->ExceptionClear (env);
    }
    (*env)->DeleteLocalRef (env, klass);
    if (res < 0)
        return JNI_ERR;

    pthread_key_create (&current_jni_env, detach_current_thread);
    pthread_mutex_init (&mutex, NULL);

    return JNI_VERSION_1_4;
}

static void *
thread_handler (void *data)
{
    ThreadData *tdata = data;

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
