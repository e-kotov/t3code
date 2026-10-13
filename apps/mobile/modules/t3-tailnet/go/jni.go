//go:build android || t3jni

package main

/*
#include <jni.h>
#include <stdlib.h>

static const char* t3GetString(JNIEnv* env, jstring s) {
	return s == NULL ? NULL : (*env)->GetStringUTFChars(env, s, NULL);
}

static void t3ReleaseString(JNIEnv* env, jstring s, const char* chars) {
	if (s != NULL && chars != NULL) (*env)->ReleaseStringUTFChars(env, s, chars);
}

static jstring t3NewString(JNIEnv* env, const char* chars) {
	return (*env)->NewStringUTF(env, chars);
}
*/
import "C"

import "unsafe"

// Java_expo_modules_t3tailnet_TailnetNative_call implements
// TailnetNative.call(method: String, args: String): String.
//
//export Java_expo_modules_t3tailnet_TailnetNative_call
func Java_expo_modules_t3tailnet_TailnetNative_call(env *C.JNIEnv, _ C.jclass, method, args C.jstring) C.jstring {
	out := C.CString(dispatch(javaString(env, method), javaString(env, args)))
	defer C.free(unsafe.Pointer(out))
	return C.t3NewString(env, out)
}

func javaString(env *C.JNIEnv, s C.jstring) string {
	chars := C.t3GetString(env, s)
	if chars == nil {
		return ""
	}
	defer C.t3ReleaseString(env, s, chars)
	return C.GoString(chars)
}
