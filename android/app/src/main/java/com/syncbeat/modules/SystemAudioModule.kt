package com.syncbeat.modules

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

class SystemAudioModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "SystemAudioCapture"
        const val EVENT_AUDIO_DATA = "onAudioData"
        const val EVENT_CAPTURE_ERROR = "onCaptureError"
        const val MEDIA_PROJECTION_REQUEST = 1002
        private const val SAMPLE_RATE = 44100
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_STEREO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
    }

    private var mediaProjection: MediaProjection? = null
    private var audioRecord: AudioRecord? = null
    private var isCapturing = false
    private var capturePromise: Promise? = null
    private val executor = Executors.newSingleThreadExecutor()

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun requestCapture(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            promise.reject("UNSUPPORTED", "System audio capture requires Android 10+")
            return
        }
        capturePromise = promise
        val mgr = reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                as MediaProjectionManager
        val intent = mgr.createScreenCaptureIntent()
        currentActivity?.startActivityForResult(intent, MEDIA_PROJECTION_REQUEST)
            ?: promise.reject("NO_ACTIVITY", "No activity available")
    }

    @ReactMethod
    fun stopCapture() {
        isCapturing = false
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        mediaProjection?.stop()
        mediaProjection = null
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    override fun onActivityResult(
        activity: Activity, requestCode: Int, resultCode: Int, data: Intent?
    ) {
        if (requestCode != MEDIA_PROJECTION_REQUEST) return
        if (resultCode != Activity.RESULT_OK || data == null) {
            capturePromise?.reject("PERMISSION_DENIED", "User denied screen capture permission")
            capturePromise = null
            return
        }
        val mgr = reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                as MediaProjectionManager
        mediaProjection = mgr.getMediaProjection(resultCode, data)

        startAudioCapture()
        capturePromise?.resolve(null)
        capturePromise = null
    }

    override fun onNewIntent(intent: Intent?) {}

    @RequiresApi(Build.VERSION_CODES.Q)
    @SuppressLint("MissingPermission")
    private fun startAudioCapture() {
        val config = AudioPlaybackCaptureConfiguration.Builder(mediaProjection!!)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()

        val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)

        audioRecord = AudioRecord.Builder()
            .setAudioPlaybackCaptureConfig(config)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(CHANNEL_CONFIG)
                    .setEncoding(AUDIO_FORMAT)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize * 4)
            .build()

        isCapturing = true
        audioRecord?.startRecording()

        executor.execute {
            val buffer = ShortArray(bufferSize)
            while (isCapturing) {
                val read = audioRecord?.read(buffer, 0, buffer.size) ?: break
                if (read > 0) {
                    val args = Arguments.createMap()
                    args.putInt("sampleRate", SAMPLE_RATE)
                    args.putInt("channels", 2)
                    args.putInt("samples", read)
                    sendEvent(EVENT_AUDIO_DATA, args)
                }
            }
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
