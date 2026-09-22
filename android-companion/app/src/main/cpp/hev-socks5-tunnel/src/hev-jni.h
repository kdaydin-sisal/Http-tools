/*
 ============================================================================
 Name        : hev-jni.h
 Author      : hev <r@hev.cc>
 Copyright   : Copyright (c) 2019 - 2023 hev
 Description : Java Native Interface
 ============================================================================
 */

#ifndef __HEV_JNI_H__
#define __HEV_JNI_H__

#ifdef ANDROID

/**
 * Resolves the app owning a TCP connection, by calling back into Kotlin's
 * TProxyService.resolveAppIdentity() (which uses
 * ConnectivityManager.getConnectionOwnerUid() + PackageManager under the
 * hood). `local_addr`/`local_port` must be the connecting app's own
 * source endpoint and `remote_addr`/`remote_port` the destination it's
 * connecting to -- i.e. exactly what getConnectionOwnerUid() itself expects,
 * NOT lwip's "local"/"remote" naming (which is inverted, since lwip is
 * impersonating the destination).
 *
 * On success, returns 0 and sets *out_device_id / *out_package_id to
 * hev_malloc()'d, NUL-terminated strings the caller must hev_free(). On any
 * failure (older Android without getConnectionOwnerUid, JNI not ready, no
 * match, malformed response, etc.) returns -1 and leaves both out params
 * NULL -- callers must treat this as "no identity available" and continue
 * without one, never as a hard error.
 */
int hev_jni_resolve_app_identity (int protocol, const char *local_addr,
                                  int local_port, const char *remote_addr,
                                  int remote_port, char **out_device_id,
                                  char **out_package_id);

#endif /* ANDROID */

#endif /* __HEV_JNI_H__ */
