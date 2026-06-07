// android/app/src/main/java/com/syncbeat/modules/AudioCaptureEventPackage.kt
//
// Registers AudioCaptureEventModule so React Native can find it.
// This is added to MainApplication.kt's getPackages() list.

package com.syncbeat.modules

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AudioCaptureEventPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
        listOf(
            AudioCaptureEventModule(ctx),
            ClipboardModule(ctx),
        )

    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
