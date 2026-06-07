// android/app/src/main/java/com/syncbeat/services/AudioCaptureService.kt
//
// FIX #4:  The notification "Stop" button now sends a local broadcast Intent
//          that the JS layer (via a NativeEventEmitter) can listen to and call
//          cleanup() in React. Previously tapping "Stop" killed the foreground
//          service but left WebRTC, Firebase signaling, and room state live.
//
// FIX #16: onDestroy now broadcasts CAPTURE_STOPPED so the JS layer knows
//          the service was killed (e.g. by Android memory pressure after
//          START_STICKY restart). The JS layer should treat this event the
//          same as the user tapping Stop.

package com.syncbeat.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.syncbeat.MainActivity

class AudioCaptureService : Service() {

    companion object {
        const val CHANNEL_ID          = "syncbeat_audio_capture"
        const val NOTIFICATION_ID     = 1001
        const val ACTION_START        = "START_CAPTURE"
        const val ACTION_STOP         = "STOP_CAPTURE"
        // FIX #4 + #16: Broadcast action that the JS NativeEventEmitter listens to.
        const val ACTION_CAPTURE_STOPPED = "com.syncbeat.CAPTURE_STOPPED"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startForeground(NOTIFICATION_ID, buildNotification())
            ACTION_STOP  -> stopCapture()
        }
        return START_STICKY
    }

    // FIX #4: Centralised stop logic used by both the notification button and onDestroy.
    private fun stopCapture() {
        // Notify the JS layer so it can call cleanup() and update Firebase.
        broadcastStopped()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // FIX #16: When Android kills the service (memory pressure, etc.), notify JS.
    override fun onDestroy() {
        super.onDestroy()
        broadcastStopped()
    }

    private fun broadcastStopped() {
        val intent = Intent(ACTION_CAPTURE_STOPPED)
        LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
    }

    private fun buildNotification(): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingOpen = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        // FIX #4: Stop action now calls stopCapture() which broadcasts CAPTURE_STOPPED
        // before killing the service, so JS can react and clean up.
        val stopIntent = Intent(this, AudioCaptureService::class.java).apply {
            action = ACTION_STOP
        }
        val pendingStop = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SyncBeat is broadcasting")
            .setContentText("Your audio is being shared with listeners")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingOpen)
            .addAction(android.R.drawable.ic_media_pause, "Stop", pendingStop)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Audio Broadcast",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shows while SyncBeat is broadcasting audio"
                setSound(null, null)
            }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }
}
