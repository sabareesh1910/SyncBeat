package com.syncbeat.modules

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.syncbeat.services.ListenerService

class ListenerServiceModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ListenerService"

    @ReactMethod
    fun start(roomCode: String) {
        val intent = Intent(reactContext, ListenerService::class.java).apply {
            action = ListenerService.ACTION_START
            putExtra("roomCode", roomCode)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    @ReactMethod
    fun stop() {
        val intent = Intent(reactContext, ListenerService::class.java).apply {
            action = ListenerService.ACTION_STOP
        }
        reactContext.startService(intent)
    }
}
