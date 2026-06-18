package com.hearby.mobile

import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class DeviceLocalesModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DeviceLocales"

  override fun getConstants(): MutableMap<String, Any> {
    val configuration = reactApplicationContext.resources.configuration
    val preferredLocales =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          (0 until configuration.locales.size())
              .mapNotNull { index -> configuration.locales[index]?.toLanguageTag() }
        } else {
          listOf(configuration.locale.toLanguageTag())
        }

    return mutableMapOf("preferredLocales" to preferredLocales)
  }
}
