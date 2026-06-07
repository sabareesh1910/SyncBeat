// android/app/src/main/java/com/syncbeat/MainActivity.kt
//
// Handles the Android "Start capturing?" permission prompt result
// and forwards it to react-native-webrtc for MediaProjection.

package com.syncbeat

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "syncbeat"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
    }

    // react-native-webrtc uses this to receive the MediaProjection token
    // which is needed to capture system audio
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (resultCode == Activity.RESULT_OK && data != null) {
            // Start our foreground service so capture keeps running in background
            val serviceIntent = Intent(
                this,
                com.syncbeat.services.AudioCaptureService::class.java
            ).apply {
                action = com.syncbeat.services.AudioCaptureService.ACTION_START
            }
            startForegroundService(serviceIntent)
        }
    }
}
