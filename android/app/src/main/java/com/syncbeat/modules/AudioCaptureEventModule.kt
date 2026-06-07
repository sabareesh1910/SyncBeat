// android/app/src/main/java/com/syncbeat/modules/AudioCaptureEventModule.kt
//
// FIX #4 + #16: Native module that bridges the AudioCaptureService's
// LocalBroadcast to the React Native JS layer via a NativeEventEmitter.
//
// Usage in JS (HostRoomScreen.js):
//
//   import {NativeEventEmitter, NativeModules} from 'react-native';
//   const emitter = new NativeEventEmitter(NativeModules.AudioCaptureEvent);
//   const sub = emitter.addListener('onCaptureStopped', () => {
//     cleanup();                        // close peer connections
//     navigation.replace('Home');       // go back to home screen
//   });
//   // In useEffect cleanup: sub.remove();

package com.syncbeat.modules

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.syncbeat.services.AudioCaptureService

class AudioCaptureEventModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioCaptureEvent"

    private var listenerCount = 0

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioCaptureService.ACTION_CAPTURE_STOPPED) {
                sendEvent("onCaptureStopped", null)
            }
        }
    }

    // React Native calls addListener when JS adds a subscription.
    @ReactMethod
    fun addListener(eventName: String) {
        if (listenerCount == 0) {
            LocalBroadcastManager.getInstance(reactContext).registerReceiver(
                receiver,
                IntentFilter(AudioCaptureService.ACTION_CAPTURE_STOPPED),
            )
        }
        listenerCount++
    }

    // React Native calls removeListeners when JS subscriptions are removed.
    @ReactMethod
    fun removeListeners(count: Int) {
        listenerCount -= count
        if (listenerCount <= 0) {
            listenerCount = 0
            try {
                LocalBroadcastManager.getInstance(reactContext).unregisterReceiver(receiver)
            } catch (_: Exception) {}
        }
    }

    private fun sendEvent(eventName: String, params: Any?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
