// macOS only: whether this app may show notifications, as System Settings
// › Notifications has it. Electron offers no way to ask, and a notification
// sent while they are off is reported as shown, so ClaudeWatch asks here.
//
// It must run inside the app's own process: macOS answers for the calling
// executable's code identity, so a separate helper binary, even one inside
// the bundle, gets its own (empty) answer.
//
// Exports status(): Promise<'authorized' | 'provisional' | 'denied' |
// 'notDetermined' | 'unknown'>. Built by scripts/build-native.mjs
// against Node-API, so one binary works across Electron versions.

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <stdlib.h>
#include <string.h>
#include <node_api.h>

typedef struct {
  napi_deferred deferred;
  napi_threadsafe_function tsfn;
} Request;

static const char *Describe(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusAuthorized: return "authorized";
    case UNAuthorizationStatusProvisional: return "provisional";
    case UNAuthorizationStatusDenied: return "denied";
    case UNAuthorizationStatusNotDetermined: return "notDetermined";
  }
  return "unknown";
}

// Runs on the JS thread: settle the promise with the answer, then clean up.
static void Resolve(napi_env env, napi_value js_cb, void *context, void *data) {
  Request *req = (Request *)context;
  char *answer = (char *)data;
  if (env != NULL) {
    napi_value value;
    napi_create_string_utf8(env, answer, NAPI_AUTO_LENGTH, &value);
    napi_resolve_deferred(env, req->deferred, value);
  }
  free(answer);
  napi_release_threadsafe_function(req->tsfn, napi_tsfn_release);
  free(req);
}

static napi_value Status(napi_env env, napi_callback_info info) {
  napi_value promise;
  Request *req = calloc(1, sizeof(Request));
  napi_create_promise(env, &req->deferred, &promise);

  napi_value name;
  napi_create_string_utf8(env, "notificationStatus", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, NULL, NULL, req, Resolve,
                                  &req->tsfn);

  // The completion handler runs on a background queue; hand the answer back.
  [[UNUserNotificationCenter currentNotificationCenter]
      getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        napi_call_threadsafe_function(req->tsfn, strdup(Describe(settings.authorizationStatus)),
                                      napi_tsfn_blocking);
      }];
  return promise;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "status", NAPI_AUTO_LENGTH, Status, NULL, &fn);
  napi_set_named_property(env, exports, "status", fn);
  return exports;
}
