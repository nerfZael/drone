package com.huntelkator.voicestreamnext

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import java.util.ArrayDeque
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class VoiceSessionService : Service() {
    private lateinit var api: VoiceStreamApi
    private lateinit var streamer: AudioStreamer
    private lateinit var microphoneRouter: MicrophoneRouter
    private lateinit var audioManager: AudioManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val controlClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private var wakeLock: PowerManager.WakeLock? = null
    @Volatile private var controlSocket: WebSocket? = null
    @Volatile private var lastStatus = "Off"
    @Volatile private var lastMode = Constants.MODE_OFF
    @Volatile private var currentMicrophone = "Mic: phone"
    @Volatile private var lastApprovalStatus = ""
    @Volatile private var serviceActive = false
    @Volatile private var controlReconnectAttempt = 0
    @Volatile private var controlReconnectRunnable: Runnable? = null
    private val deferredSpeechAudio = ArrayDeque<ByteArray>()
    private val deferredSpeechAudioLock = Any()

    private val audioDeviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
            refreshMicrophoneAfterDeviceChange()
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
            refreshMicrophoneAfterDeviceChange()
        }
    }

    private val logUploadRunnable = object : Runnable {
        override fun run() {
            if (serviceActive) {
                uploadDiagnostics("periodic", force = false)
                mainHandler.postDelayed(this, LOG_UPLOAD_INTERVAL_MS)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        api = VoiceStreamApi(applicationContext)
        streamer = AudioStreamer(applicationContext, api)
        microphoneRouter = MicrophoneRouter(applicationContext)
        audioManager = getSystemService(AudioManager::class.java)
        currentMicrophone = microphoneRouter.describeCurrentSelection()
        audioManager.registerAudioDeviceCallback(audioDeviceCallback, mainHandler)
        streamer.statusListener = { update ->
            if (update.microphone.isNotBlank()) {
                currentMicrophone = update.microphone
            }
            if (update.approvalStatus.isNotBlank()) {
                publishApprovalStatus(update.approvalStatus)
            }
        }
        createNotificationChannel()
        ClientLog.i("Service", "VoiceSessionService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            null -> {
                ClientLog.w("Service", "Ignoring service start without an action")
                if (!serviceActive) stopSelf(startId)
            }
            Constants.ACTION_QUERY_STATUS -> {
                publishStatus(lastStatus, lastMode, currentMicrophone, lastApprovalStatus)
                if (!serviceActive) {
                    stopSelf(startId)
                }
            }
            Constants.ACTION_SET_MICROPHONE -> {
                setMicrophone(intent.getStringExtra(Constants.EXTRA_MICROPHONE_DEVICE_KEY).orEmpty())
                if (!serviceActive) {
                    stopSelf(startId)
                }
            }
            Constants.ACTION_STOP_VOICE -> stopVoice()
            Constants.ACTION_STOP_RECORDING -> {
                if (!streamer.stopRecordingToAwake()) {
                    if (serviceActive) startAwake() else stopSelf(startId)
                }
            }
            Constants.ACTION_SLEEP -> {
                if (serviceActive) {
                    enterSleep()
                } else {
                    stopSelf(startId)
                }
            }
            Constants.ACTION_START_AWAKE -> {
                serviceActive = true
                startAwake()
            }
            Constants.ACTION_START_VOICE -> {
                serviceActive = true
                startVoice(intent.getStringExtra(Constants.EXTRA_STREAM_TARGET) ?: Constants.STREAM_TARGET_ASSISTANT)
            }
            else -> {
                ClientLog.w("Service", "Ignoring unknown service action ${intent.action}")
                if (!serviceActive) stopSelf(startId)
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        serviceActive = false
        mainHandler.removeCallbacks(logUploadRunnable)
        streamer.statusListener = null
        streamer.stop()
        AssistantAudioPlayer.stopAll()
        closeControlChannel()
        runCatching { audioManager.unregisterAudioDeviceCallback(audioDeviceCallback) }
        releaseWakeLock()
        publishStatus("Off", Constants.MODE_OFF, currentMicrophone, "")
        super.onDestroy()
    }

    private fun startAwake() {
        uploadDiagnostics("awake-start", force = true)
        schedulePeriodicDiagnostics()
        publishStatus("Waking local detector", Constants.MODE_LOADING, currentMicrophone, lastApprovalStatus)
        startForeground(NOTIFICATION_ID, notification("Waking local detector"))
        acquireWakeLock()
        connectControlChannel()
        streamer.startAwake { status ->
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, notification(status))
            publishStatus(status, modeFromStatus(status), currentMicrophone, lastApprovalStatus)
            if (status == "Off") stopVoice()
        }
    }

    private fun startVoice(target: String) {
        uploadDiagnostics("voice-start", force = true)
        schedulePeriodicDiagnostics()
        publishStatus("Voice stream starting", Constants.MODE_LOADING, currentMicrophone, lastApprovalStatus)
        startForeground(NOTIFICATION_ID, notification("Voice stream starting"))
        acquireWakeLock()
        connectControlChannel()
        thread(name = "VoiceStreamNextServiceStart") {
            try {
                val deviceId = api.pairedDeviceId()
                if (deviceId.isBlank()) {
                    publishStatus("Pair this device before streaming.", Constants.MODE_ERROR, currentMicrophone, lastApprovalStatus)
                    stopVoice()
                    return@thread
                }
                val sessionId = api.createVoiceSession(deviceId, target)
                api.uploadLog("Android foreground voice service started")
                ClientLog.i("Service", "Voice session started target=$target sessionId=$sessionId")
                streamer.start(sessionId, target) { status ->
                    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    manager.notify(NOTIFICATION_ID, notification(status))
                    publishStatus(status, modeFromStatus(status), currentMicrophone, lastApprovalStatus)
                    if (status == "Off") stopVoice()
                }
            } catch (error: Exception) {
                val message = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
                ClientLog.w("Service", "Voice stream failed to start", error)
                runCatching {
                    api.uploadLog(
                        "Android foreground voice service failed to start",
                        org.json.JSONObject()
                            .put("target", target)
                            .put("error", message)
                            .put("type", error.javaClass.name)
                    )
                }
                publishStatus("Voice stream failed to start: $message", Constants.MODE_ERROR, currentMicrophone, lastApprovalStatus)
                stopVoice()
            }
        }
    }

    private fun stopVoice() {
        uploadDiagnostics("service-stop", force = true)
        serviceActive = false
        mainHandler.removeCallbacks(logUploadRunnable)
        streamer.stop()
        AssistantAudioPlayer.stopAll()
        closeControlChannel()
        releaseWakeLock()
        publishStatus("Off", Constants.MODE_OFF, currentMicrophone, "")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun enterSleep() {
        AssistantAudioPlayer.stopAll()
        if (!streamer.enterSleep()) {
            stopVoice()
        }
    }

    private fun setMicrophone(deviceKey: String) {
        microphoneRouter.saveSelectedDeviceKey(deviceKey)
        currentMicrophone = streamer.applyMicrophonePreference()
        publishStatus(lastStatus, lastMode, currentMicrophone, lastApprovalStatus)
    }

    private fun refreshMicrophoneAfterDeviceChange() {
        mainHandler.post {
            currentMicrophone = streamer.applyMicrophonePreference()
            publishStatus(lastStatus, lastMode, currentMicrophone, lastApprovalStatus)
        }
    }

    private fun schedulePeriodicDiagnostics() {
        mainHandler.removeCallbacks(logUploadRunnable)
        mainHandler.postDelayed(logUploadRunnable, LOG_UPLOAD_INTERVAL_MS)
    }

    private fun uploadDiagnostics(reason: String, force: Boolean) {
        DiagnosticsUploader.upload(applicationContext, api, reason, force)
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(PowerManager::class.java)
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "VoiceStreamNext:VoiceSession").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { lock ->
            runCatching {
                if (lock.isHeld) lock.release()
            }
        }
        wakeLock = null
    }

    private fun publishApprovalStatus(status: String) {
        lastApprovalStatus = status
        broadcastState()
        sendControlStatus(lastStatus, lastMode, currentMicrophone, lastApprovalStatus)
        mainHandler.postDelayed({
            if (lastApprovalStatus == status) {
                lastApprovalStatus = ""
                broadcastState()
            }
        }, APPROVAL_STATUS_MS)
    }

    private fun publishStatus(status: String, mode: String, microphone: String, approvalStatus: String) {
        lastStatus = status
        lastMode = mode
        currentMicrophone = microphone.ifBlank { currentMicrophone }
        if (approvalStatus.isNotBlank()) {
            lastApprovalStatus = approvalStatus
        }
        broadcastState()
        if (!sendControlStatus(status, mode, currentMicrophone, lastApprovalStatus)) {
            thread(name = "VoiceStreamNextStatusUpload") {
                runCatching {
                    api.uploadClientStatus(
                        mode = mode,
                        status = status,
                        microphone = currentMicrophone,
                        lastError = if (mode == Constants.MODE_ERROR) status else null,
                    )
                }
            }
        }
        if (mode == Constants.MODE_OFF || mode == Constants.MODE_SLEEPING) {
            clearDeferredSpeechAudio()
        } else {
            drainDeferredSpeechAudioIfReady()
        }
    }

    private fun broadcastState() {
        sendBroadcast(Intent(Constants.ACTION_STATUS).apply {
            setPackage(packageName)
            putExtra(Constants.EXTRA_STATUS, lastStatus)
            putExtra(Constants.EXTRA_MODE, lastMode)
            putExtra(Constants.EXTRA_MICROPHONE, currentMicrophone)
            putExtra(Constants.EXTRA_APPROVAL_STATUS, lastApprovalStatus)
        })
    }

    private fun broadcastSpeechHistoryChanged() {
        sendBroadcast(Intent(Constants.ACTION_SPEECH_HISTORY_CHANGED).apply {
            setPackage(packageName)
        })
    }

    private fun connectControlChannel() {
        cancelControlReconnect()
        if (controlSocket != null) return
        val deviceId = api.pairedDeviceId()
        val token = api.pairedDeviceToken()
        if (deviceId.isBlank() || token.isBlank()) return
        val url = buildControlUrl(api.loadConfig().serverUrl, deviceId, token)
        ClientLog.i("Service", "Opening control websocket")
        controlSocket = controlClient.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    ClientLog.i("Service", "Control websocket opened")
                    controlReconnectAttempt = 0
                    sendControlStatus(lastStatus, lastMode, currentMicrophone, lastApprovalStatus, webSocket)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                    when (message.optString("type")) {
                        "control_hello" -> rememberReturnedDevice(message.optJSONObject("device"))
                        "server_ping" -> webSocket.send(
                            JSONObject()
                                .put("type", "client_ping")
                                .put("sentAt", java.time.Instant.now().toString())
                                .toString()
                        )
                        "speech_audio" -> {
                            val audioBase64 = message.optString("audioBase64")
                            if (audioBase64.isNotBlank()) {
                                runCatching {
                                    val audio = Base64.decode(audioBase64, Base64.DEFAULT)
                                    SpeechHistoryStore.add(
                                        context = applicationContext,
                                        audio = audio,
                                        text = message.optString("text").takeIf { it.isNotBlank() },
                                        source = message.optString("source").takeIf { it.isNotBlank() },
                                        contentType = message.optString("contentType", "audio/wav"),
                                    )
                                    broadcastSpeechHistoryChanged()
                                    queueOrPlaySpeechAudio(audio)
                                }.onFailure { error ->
                                    ClientLog.w("Service", "Assistant audio decode failed", error)
                                    publishStatus("Assistant audio failed: ${error.message ?: error.javaClass.simpleName}", Constants.MODE_ERROR, currentMicrophone, lastApprovalStatus)
                                }
                            }
                        }
                        "server_command" -> handleRemoteControlCommand(webSocket, message)
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    ClientLog.w("Service", "Control websocket closed code=$code reason=${reason.ifBlank { "(none)" }} active=$serviceActive mode=$lastMode")
                    if (controlSocket === webSocket) controlSocket = null
                    if (!isTerminalControlCloseCode(code)) scheduleControlReconnect("closed")
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    ClientLog.w("Service", "Control websocket failed responseCode=${response?.code ?: 0} message=${t.message ?: t.javaClass.simpleName}", t)
                    if (controlSocket === webSocket) controlSocket = null
                    scheduleControlReconnect("failed")
                }
            }
        )
    }

    private fun rememberReturnedDevice(device: JSONObject?) {
        val returnedDeviceId = device?.optString("id").orEmpty()
        val token = api.pairedDeviceToken()
        if (returnedDeviceId.isBlank() || token.isBlank() || returnedDeviceId == api.pairedDeviceId()) return
        api.savePairing(
            DevicePairing(returnedDeviceId, token),
            device?.optString("displayName")?.takeIf { it.isNotBlank() } ?: Constants.DEFAULT_DEVICE_NAME
        )
    }

    private fun closeControlChannel() {
        cancelControlReconnect()
        controlSocket?.close(1000, "service stopped")
        controlSocket = null
    }

    private fun scheduleControlReconnect(reason: String) {
        if (!shouldMaintainControlChannel()) return
        if (controlReconnectRunnable != null) return
        val attempt = controlReconnectAttempt.coerceAtMost(MAX_CONTROL_RECONNECT_EXPONENT)
        controlReconnectAttempt += 1
        val delayMs = minOf(MAX_CONTROL_RECONNECT_DELAY_MS, BASE_CONTROL_RECONNECT_DELAY_MS * (1L shl attempt))
        ClientLog.i("Service", "Scheduling control websocket reconnect reason=$reason attempt=$controlReconnectAttempt delayMs=$delayMs")
        val runnable = Runnable {
            controlReconnectRunnable = null
            if (shouldMaintainControlChannel()) {
                connectControlChannel()
            }
        }
        controlReconnectRunnable = runnable
        mainHandler.postDelayed(runnable, delayMs)
    }

    private fun cancelControlReconnect() {
        controlReconnectRunnable?.let { mainHandler.removeCallbacks(it) }
        controlReconnectRunnable = null
    }

    private fun shouldMaintainControlChannel(): Boolean = serviceActive && lastMode != Constants.MODE_OFF

    private fun isTerminalControlCloseCode(code: Int): Boolean = code == 4401 || code == 4403 || code == 4406 || code == 4408

    private fun sendControlStatus(
        status: String,
        mode: String,
        microphone: String,
        approvalStatus: String,
        socket: WebSocket? = controlSocket,
    ): Boolean {
        val localSocket = socket ?: return false
        val payload = JSONObject()
            .put("type", "client_status")
            .put("mode", mode)
            .put("status", if (approvalStatus.isNotBlank()) "$status | $approvalStatus" else status)
            .put("microphone", microphone)
            .put("protocolVersion", 1)
            .put("clientVersion", BuildConfig.VERSION_CODE)
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("lastError", if (mode == Constants.MODE_ERROR) status else JSONObject.NULL)
            .put("reportedAt", java.time.Instant.now().toString())
        return localSocket.send(payload.toString())
    }

    private fun queueOrPlaySpeechAudio(audio: ByteArray) {
        if (speechPlaybackBlocked() || streamer.isRecordingAudio()) {
            synchronized(deferredSpeechAudioLock) {
                deferredSpeechAudio.add(audio)
            }
            ClientLog.i("Service", "Assistant audio deferred while voice recording is active mode=$lastMode")
            return
        }
        if (!streamer.canPlayQueuedAssistantAudio()) {
            ClientLog.i("Service", "Assistant audio received but playback skipped mode=$lastMode")
            return
        }
        playSpeechAudio(audio)
    }

    private fun drainDeferredSpeechAudioIfReady() {
        if (speechPlaybackBlocked() || streamer.isRecordingAudio() || !streamer.canPlayQueuedAssistantAudio()) return
        AssistantAudioPlayer.resumePlayback()
        val queued = ArrayList<ByteArray>()
        synchronized(deferredSpeechAudioLock) {
            while (!deferredSpeechAudio.isEmpty()) {
                queued.add(deferredSpeechAudio.removeFirst())
            }
        }
        if (queued.isEmpty()) return
        ClientLog.i("Service", "Playing ${queued.size} deferred assistant audio item(s)")
        queued.forEach { audio -> playSpeechAudio(audio) }
    }

    private fun clearDeferredSpeechAudio() {
        synchronized(deferredSpeechAudioLock) {
            deferredSpeechAudio.clear()
        }
    }

    private fun playSpeechAudio(audio: ByteArray) {
        AssistantAudioPlayer.playWav(applicationContext, audio) { status ->
            publishStatus(status, lastMode, currentMicrophone, lastApprovalStatus)
        }
        publishStatus("Assistant audio received.", lastMode, currentMicrophone, lastApprovalStatus)
    }

    private fun speechPlaybackBlocked(): Boolean {
        return lastMode == Constants.MODE_RECORDING || lastMode == "transcribing"
    }

    private fun handleRemoteControlCommand(webSocket: WebSocket, message: JSONObject) {
        val command = message.optString("command")
        val commandId = message.optString("commandId")
        fun ack(ok: Boolean, mode: String = lastMode, status: String = lastStatus, error: String? = null) {
            val payload = JSONObject()
                .put("type", "command_ack")
                .put("commandId", commandId)
                .put("command", command)
                .put("ok", ok)
                .put("mode", mode)
                .put("status", status)
            if (error != null) payload.put("error", error)
            webSocket.send(payload.toString())
        }
        when (command) {
            "query_status" -> {
                ack(true)
                publishStatus(lastStatus, lastMode, currentMicrophone, lastApprovalStatus)
            }
            "sleep" -> {
                enterSleep()
                ack(true, Constants.MODE_SLEEPING, lastStatus)
            }
            "off" -> {
                stopVoice()
                ack(true, Constants.MODE_OFF, "Off.")
            }
            "awake" -> {
                startAwake()
                ack(true, Constants.MODE_AWAKE, lastStatus)
            }
            else -> ack(false, lastMode, lastStatus, "unknown command")
        }
    }

    private fun buildControlUrl(serverUrl: String, deviceId: String, token: String): String {
        val trimmed = serverUrl.trimEnd('/')
        val base = when {
            trimmed.startsWith("https://") -> "wss://${trimmed.removePrefix("https://")}"
            trimmed.startsWith("http://") -> "ws://${trimmed.removePrefix("http://")}"
            else -> trimmed
        }
        return "$base/api/devices/${encode(deviceId)}/control?token=${encode(token)}&installationId=${encode(api.installationId())}&clientVersion=${BuildConfig.VERSION_CODE}&protocolVersion=1"
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun modeFromStatus(status: String): String {
        val lower = status.lowercase()
        return when {
            lower.contains("missing") || lower.contains("failed") || lower.contains("error") -> Constants.MODE_ERROR
            lower.contains("sleeping") || lower.startsWith("sleep") || lower.startsWith("unlock:") -> Constants.MODE_SLEEPING
            lower.contains("waking") || lower.contains("starting") || lower.contains("reconnecting") || lower.contains("thinking") || lower.contains("queued") || lower.contains("waiting for approval") -> Constants.MODE_LOADING
            lower.contains("assistant replied") || lower.contains("transcript received") || lower.contains("audio received") -> Constants.MODE_AWAKE
            lower.contains("assistant audio") -> Constants.MODE_AWAKE
            lower.contains("waiting") || lower.contains("listening") || lower.contains("copied voice transcription") || lower.contains("no voice transcription") -> Constants.MODE_AWAKE
            lower.contains("closed") || lower == "off" -> Constants.MODE_OFF
            lower.contains("approval") -> if (lower.contains("sent")) Constants.MODE_AWAKE else lastMode
            else -> Constants.MODE_RECORDING
        }
    }

    private fun notification(text: String): Notification {
        val stopIntent = Intent(this, VoiceSessionService::class.java).apply {
            action = Constants.ACTION_STOP_VOICE
        }
        val stopPendingIntent = PendingIntent.getService(
            this,
            2,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setLargeIcon(BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher))
            .setContentTitle("VoiceStream")
            .setContentText(text)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .build()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "VoiceStream", NotificationManager.IMPORTANCE_LOW))
    }

    private companion object {
        const val CHANNEL_ID = "voice_stream_next_capture"
        const val NOTIFICATION_ID = 821
        const val LOG_UPLOAD_INTERVAL_MS = 60_000L
        const val APPROVAL_STATUS_MS = 4_000L
        const val BASE_CONTROL_RECONNECT_DELAY_MS = 500L
        const val MAX_CONTROL_RECONNECT_DELAY_MS = 10_000L
        const val MAX_CONTROL_RECONNECT_EXPONENT = 5
    }
}
