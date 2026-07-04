package com.huntelkator.voicestreamnext

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class AudioStreamer(private val context: Context, private val api: VoiceStreamApi) {
    private val active = AtomicBoolean(false)
    private val recording = AtomicBoolean(false)
    private val outgoingReady = AtomicBoolean(false)
    private val reconnecting = AtomicBoolean(false)
    private val wakeConfirmationInFlight = AtomicBoolean(false)
    private val realtimeWebRtcHandoff = AtomicBoolean(false)
    private val microphoneRouter = MicrophoneRouter(context)
    private val cuePlayer = LocalCuePlayer()
    private val preRollBuffer = PcmFrameBuffer(PRE_ROLL_FRAME_COUNT)
    private val pendingStreamBuffer = PcmFrameBuffer(MAX_PENDING_STREAM_FRAME_COUNT)
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var recorder: AudioRecord? = null
    private var socket: WebSocket? = null
    private var realtimeWebRtcSession: RealtimeWebRtcSession? = null
    private var wakeDetector: VoskWakeWordDetector? = null
    private val approvalCodeRecognizer = ApprovalCodeRecognizer()
    private var approvalCodeSettings = ApprovalCodeSettings()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val approvalFinalizeRunnable = Runnable {
        currentOnStatus?.let { onStatus ->
            handleApprovalUpdate(approvalCodeRecognizer.flush(SystemClock.elapsedRealtime()), onStatus)
        }
        if (approvalCodeRecognizer.isCollecting && active.get()) {
            scheduleApprovalFinalize()
        }
    }
    private val recognizerTextUploadRunnable = Runnable {
        uploadPendingRecognizerTextForDebugging()
    }
    @Volatile private var approvalSettings = VoiceApprovalSettings()
    @Volatile private var currentSocketUrl = ""
    @Volatile private var currentTarget = Constants.STREAM_TARGET_ASSISTANT
    @Volatile private var currentOnStatus: ((String) -> Unit)? = null
    @Volatile private var reconnectAttempt = 0
    @Volatile private var awakeMode = false
    @Volatile private var sleeping = false
    @Volatile private var currentMicrophone = "Mic: phone"
    @Volatile private var pendingAssistantProfileId: String? = null
    @Volatile private var currentVoiceSessionId = ""
    @Volatile private var realtimeWebRtcClientSessionId = ""
    @Volatile private var recordingStartedAtMs = 0L
    @Volatile private var recordingMaxDurationMs = 0L
    @Volatile private var lastUploadedRecognizerText = ""
    @Volatile private var lastRecognizerUploadAtMs = 0L
    @Volatile private var pendingRecognizerText = ""
    private val recordingCountdownRunnable = object : Runnable {
        override fun run() {
            val onStatus = currentOnStatus
            if (!recording.get() || onStatus == null || recordingMaxDurationMs <= 0L || recordingStartedAtMs <= 0L) return
            onStatus(recordingStatus(currentTarget))
            mainHandler.postDelayed(this, 1_000L)
        }
    }

    var statusListener: ((StreamStatus) -> Unit)? = null

    fun applyMicrophonePreference(): String {
        val activeRecorder = recorder
        val selection = if (activeRecorder != null && active.get()) {
            microphoneRouter.routeForRecording(activeRecorder)
        } else {
            null
        }
        currentMicrophone = selection?.label ?: microphoneRouter.describeCurrentSelection()
        return currentMicrophone
    }

    private fun emitStatus(onStatus: (String) -> Unit, text: String, microphone: String? = null, approvalStatus: String = "") {
        if (!microphone.isNullOrBlank()) {
            currentMicrophone = microphone
        }
        onStatus(text)
        statusListener?.invoke(StreamStatus(text, currentMicrophone, approvalStatus))
    }

    fun startAwake(onStatus: (String) -> Unit) {
        if (!active.compareAndSet(false, true)) {
            if (active.get() && awakeMode) {
                currentOnStatus = onStatus
                sleeping = false
                applyWakeDetectorSettingsIfReady()
                refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
                onStatus(awakeWaitingStatus())
            }
            return
        }
        if (!validateReady(onStatus)) return
        currentOnStatus = onStatus
        awakeMode = true
        sleeping = false
        approvalCodeRecognizer.configure(approvalCodeSettings)
        wakeDetector = VoskWakeWordDetector(
            context,
            { status -> onStatus(status) },
            { text -> mainHandler.post { handleLocalRecognizerText(text, onStatus) } },
        ).also { detector ->
            applyWakeDetectorSettingsIfReady()
            detector.prepare()
        }
        refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
        onStatus(awakeWaitingStatus())
        thread(name = "VoiceStreamNextAwakeAudio") {
            runRecorder(onStatus, detectWake = true)
        }
    }

    fun start(sessionId: String, target: String, onStatus: (String) -> Unit) {
        val cleanTarget = cleanTarget(target)
        if (!active.compareAndSet(false, true)) {
            if (active.get() && awakeMode) {
                currentOnStatus = onStatus
                beginRecordingWithSession(sessionId, cleanTarget, onStatus)
            }
            return
        }
        if (!validateReady(onStatus)) return
        currentOnStatus = onStatus
        awakeMode = false
        sleeping = false
        beginRecordingWithSession(sessionId, cleanTarget, onStatus)
        if (cleanTarget == Constants.STREAM_TARGET_REALTIME) return
        thread(name = "VoiceStreamNextAudio") {
            runRecorder(onStatus, detectWake = false)
        }
    }

    fun refreshVoiceSettingsFromControl() {
        refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
    }

    fun enterSleep(): Boolean {
        val onStatus = currentOnStatus
        if (!awakeMode) {
            active.set(false)
            recording.set(false)
            outgoingReady.set(false)
            stopRecordingCountdown()
            closeRealtimeWebRtc(sendCancel = true)
            closeSocket("sleep requested", sendEnd = true)
            runCatching { recorder?.stop() }
            onStatus?.invoke("Off")
            return false
        }
        if (sleeping) return true
        sleeping = true
        resetApprovalCollection()
        applyWakeDetectorSettingsIfReady()
        refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
        cuePlayer.play(LocalCue.SLEEP)
        if (recording.get() && onStatus != null) {
            endRecording(onStatus, sleepingStatus())
            closeRealtimeWebRtc(sendCancel = true)
        } else {
            onStatus?.invoke(sleepingStatus())
        }
        return true
    }

    fun stopRecordingToAwake(): Boolean {
        val onStatus = currentOnStatus ?: return false
        if (!active.get() || !awakeMode) return false
        sleeping = false
        applyWakeDetectorSettingsIfReady()
        if (recording.get()) {
            endRecording(onStatus, awakeWaitingStatus())
            closeRealtimeWebRtc(sendCancel = true)
            closeSocket("recording stopped", sendEnd = false)
        } else {
            onStatus(awakeWaitingStatus())
        }
        wakeDetector?.reset()
        return true
    }

    fun canPlayAssistantAudio(): Boolean {
        return active.get()
    }

    fun stop() {
        active.set(false)
        recording.set(false)
        outgoingReady.set(false)
        reconnecting.set(false)
        wakeConfirmationInFlight.set(false)
        awakeMode = false
        sleeping = false
        currentSocketUrl = ""
        currentOnStatus = null
        pendingRecognizerText = ""
        mainHandler.removeCallbacks(recognizerTextUploadRunnable)
        stopRecordingCountdown()
        resetApprovalCollection()
        wakeDetector?.release()
        wakeDetector = null
        closeRealtimeWebRtc(sendCancel = true)
        closeSocket("stopped", sendEnd = true)
        runCatching { recorder?.stop() }
    }

    private fun validateReady(onStatus: (String) -> Unit): Boolean {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            active.set(false)
            onStatus("Microphone permission is missing.")
            return false
        }
        if (api.pairedDeviceId().isBlank() || api.pairedDeviceToken().isBlank()) {
            active.set(false)
            onStatus("Pair this device before streaming.")
            return false
        }
        return true
    }

    private fun beginRecording(target: String, onStatus: (String) -> Unit) {
        if (!recording.compareAndSet(false, true)) return
        currentTarget = cleanTarget(target)
        outgoingReady.set(false)
        reconnectAttempt = 0
        pendingStreamBuffer.clear()
        pendingStreamBuffer.pushAll(preRollBuffer.drain())
        val assistantProfileId = pendingAssistantProfileId
        pendingAssistantProfileId = null
        emitStatus(onStatus, "Voice stream starting", currentMicrophone)
        thread(name = "VoiceStreamBeginRecording") {
            try {
                val deviceId = api.pairedDeviceId()
                val sessionId = api.createVoiceSession(deviceId, currentTarget, assistantProfileId)
                beginRecordingWithSession(sessionId, currentTarget, onStatus, recordingAlreadyStarted = true)
            } catch (error: Exception) {
                recording.set(false)
                pendingStreamBuffer.clear()
                val message = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
                ClientLog.w("AudioStreamer", "Voice stream failed to start target=$currentTarget", error)
                uploadVoiceStartFailure(currentTarget, message, error)
                onStatus("Voice stream failed to start: $message")
            }
        }
    }

    private fun beginRecordingWithSession(
        sessionId: String,
        target: String,
        onStatus: (String) -> Unit,
        recordingAlreadyStarted: Boolean = false,
    ) {
        if (!recordingAlreadyStarted && recording.getAndSet(true)) return
        currentTarget = cleanTarget(target)
        outgoingReady.set(false)
        reconnectAttempt = 0
        recordingStartedAtMs = SystemClock.elapsedRealtime()
        recordingMaxDurationMs = 0L
        mainHandler.removeCallbacks(recordingCountdownRunnable)
        currentVoiceSessionId = sessionId
        if (currentTarget == Constants.STREAM_TARGET_REALTIME) {
            beginRealtimeWebRtcWithSession(sessionId, onStatus)
            return
        }
        currentSocketUrl = buildSocketUrl(api.loadConfig().serverUrl, api.pairedDeviceId(), api.pairedDeviceToken(), sessionId, currentTarget)
        onStatus(recordingStatus(currentTarget))
        connectSocket(currentSocketUrl, onStatus)
    }

    private fun beginRealtimeWebRtcWithSession(sessionId: String, onStatus: (String) -> Unit) {
        outgoingReady.set(false)
        pendingStreamBuffer.clear()
        realtimeWebRtcClientSessionId = "android_${java.util.UUID.randomUUID().toString().replace("-", "")}"
        val assistantProfileId = pendingAssistantProfileId
        pendingAssistantProfileId = null
        if (recorder != null) {
            realtimeWebRtcHandoff.set(true)
            wakeDetector?.release()
            wakeDetector = null
            runCatching { recorder?.stop() }
            Thread.sleep(150)
        }
        thread(name = "VoiceStreamRealtimeWebRtc") {
            try {
                val realtime = RealtimeWebRtcSession(
                    context = context,
                    api = api,
                    voiceSessionId = sessionId,
                    clientSessionId = realtimeWebRtcClientSessionId,
                    assistantProfileId = assistantProfileId,
                    onStatus = { status -> mainHandler.post { onStatus(status) } },
                    onClosed = {
                        mainHandler.post {
                            if (currentTarget == Constants.STREAM_TARGET_REALTIME && recording.get()) {
                                endRecording(onStatus, "Awake: realtime assistant stopped.")
                            }
                        }
                    },
                )
                realtimeWebRtcSession = realtime
                val result = realtime.start()
                if (result.maxDurationMs > 0L) {
                    mainHandler.post { startRecordingCountdown(result.maxDurationMs, onStatus) }
                }
                api.uploadLog(
                    "Android realtime WebRTC session connected",
                    JSONObject()
                        .put("voiceSessionId", sessionId)
                        .put("clientSessionId", realtimeWebRtcClientSessionId)
                        .put("callId", result.callId),
                )
            } catch (error: Exception) {
                ClientLog.w("AudioStreamer", "Realtime WebRTC failed", error)
                recording.set(false)
                outgoingReady.set(false)
                stopRecordingCountdown()
                closeRealtimeWebRtc(sendCancel = true)
                val message = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
                uploadVoiceStartFailure(Constants.STREAM_TARGET_REALTIME, message, error)
                mainHandler.post {
                    onStatus("Realtime voice failed to start: $message")
                    if (awakeMode && active.get()) restartAwakeRecorder(onStatus)
                }
            } finally {
                realtimeWebRtcHandoff.set(false)
            }
        }
        onStatus(recordingStatus(Constants.STREAM_TARGET_REALTIME))
    }

    private fun endRecording(onStatus: (String) -> Unit, status: String) {
        if (!recording.getAndSet(false)) return
        outgoingReady.set(false)
        stopRecordingCountdown()
        if (currentTarget == Constants.STREAM_TARGET_REALTIME) {
            closeRealtimeWebRtc(sendCancel = true)
            pendingStreamBuffer.clear()
            onStatus(status)
            if (awakeMode && active.get() && !sleeping) restartAwakeRecorder(onStatus)
            return
        }
        sendEnd("recording ended")
        pendingStreamBuffer.clear()
        onStatus(status)
    }

    private fun connectSocket(socketUrl: String, onStatus: (String) -> Unit) {
        if (!active.get()) return
        val newSocket = client.newWebSocket(
            Request.Builder().url(socketUrl).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    ClientLog.i("AudioStreamer", "Voice websocket opened target=$currentTarget")
                    reconnectAttempt = 0
                    outgoingReady.set(true)
                    webSocket.send(JSONObject().put("type", "client_hello").put("protocolVersion", 1).put("client", "android").put("mode", currentTarget).toString())
                    flushPendingFrames()
                    onStatus(recordingStatus(currentTarget))
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (!active.get()) return
                    val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                    when (message.optString("type")) {
                        "server_ping" -> webSocket.send(JSONObject().put("type", "client_ping").put("sentAt", java.time.Instant.now().toString()).toString())
                        "server_hello" -> {
                            val maxDurationMs = message.optLong("maxDurationMs", 0L)
                            if (maxDurationMs > 0L) {
                                startRecordingCountdown(maxDurationMs, onStatus)
                            }
                        }
                        "assistant_result" -> {
                            if (currentTarget == Constants.STREAM_TARGET_REALTIME) {
                                onStatus(message.optString("assistantText", "Realtime assistant replied.").ifBlank { "Realtime assistant replied." })
                            } else {
                                recording.set(false)
                                stopRecordingCountdown()
                                onStatus("Assistant replied.")
                            }
                        }
                        "assistant_status" -> {
                            onStatus(message.optString("status", "Assistant is thinking."))
                        }
                        "transcript_result" -> {
                            if (currentTarget == Constants.STREAM_TARGET_REALTIME) {
                                onStatus(message.optString("status", "Realtime transcript received."))
                            } else {
                                recording.set(false)
                                stopRecordingCountdown()
                                onStatus(message.optString("status", "Transcript received."))
                            }
                        }
                        "terminal_detected" -> handleServerTerminalDetected(message, onStatus)
                        "finish" -> handleServerFinish(message, onStatus)
                        "sleep" -> handleServerSleep(message, onStatus)
                        "abort" -> handleServerAbort(onStatus)
                        "assistant_error" -> {
                            recording.set(false)
                            outgoingReady.set(false)
                            stopRecordingCountdown()
                            pendingStreamBuffer.clear()
                            closeSocket("server error", sendEnd = false)
                            onStatus(message.optString("error", "Voice runtime failed."))
                        }
                    }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    if (!active.get()) return
                    if (!canPlayAssistantAudio()) return
                    val data = bytes.toByteArray()
                    if (data.isNotEmpty()) {
                        AssistantAudioPlayer.playWav(context, data, onStatus = onStatus)
                        onStatus("Assistant audio received.")
                    }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, reason)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    ClientLog.w("AudioStreamer", "Voice websocket closed code=$code reason=${reason.ifBlank { "(none)" }} recording=${recording.get()} active=${active.get()}")
                    if (socket === webSocket) socket = null
                    outgoingReady.set(false)
                    if (isTerminalCloseCode(code)) {
                        recording.set(false)
                        stopRecordingCountdown()
                        pendingStreamBuffer.clear()
                        onStatus("Voice stream closed: ${reason.ifBlank { "code $code" }}")
                        return
                    }
                    if (active.get() && recording.get()) {
                        onStatus("Voice stream disconnected.")
                        scheduleReconnect()
                    } else if (!active.get()) {
                        onStatus("Voice stream closed.")
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    ClientLog.w("AudioStreamer", "Voice websocket failed responseCode=${response?.code ?: 0} message=${t.message ?: t.javaClass.simpleName}", t)
                    if (socket === webSocket) socket = null
                    outgoingReady.set(false)
                    if (!active.get() || !recording.get()) return
                    val message = t.message?.takeIf { it.isNotBlank() } ?: "server is unavailable"
                    onStatus("Voice stream connection failed: $message")
                    scheduleReconnect()
                }
            },
        )
        socket = newSocket
    }

    private fun handleServerAbort(onStatus: (String) -> Unit) {
        recording.set(false)
        outgoingReady.set(false)
        stopRecordingCountdown()
        pendingStreamBuffer.clear()
        closeSocket("server abort", sendEnd = false)
        val status = if (currentTarget == Constants.STREAM_TARGET_CLIPBOARD) {
            "Awake: voice transcription cancelled"
        } else {
            awakeWaitingStatus()
        }
        onStatus(status)
    }

    private fun handleServerTerminalDetected(message: JSONObject, onStatus: (String) -> Unit) {
        if (!recording.getAndSet(false)) return
        outgoingReady.set(false)
        stopRecordingCountdown()
        pendingStreamBuffer.clear()
        val commandType = message.optString("commandType")
        wakeDetector?.reset()
        val status = when {
            commandType == "abort" -> {
                cuePlayer.play(LocalCue.STOP_BUTTON)
                "Awake: voice command cancelled"
            }
            commandType == "sleep" -> {
                sleeping = true
                resetApprovalCollection()
                applyWakeDetectorSettingsIfReady()
                refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
                cuePlayer.play(LocalCue.SLEEP)
                sleepingStatus()
            }
            else -> {
                cuePlayer.play(LocalCue.STOP_BUTTON)
                if (currentTarget == Constants.STREAM_TARGET_CLIPBOARD) {
                    "Awake: finishing clipboard transcription"
                } else {
                    "Awake: finishing voice request"
                }
            }
        }
        onStatus(status)
        ClientLog.i(
            "AudioStreamer",
            "Server terminal phrase detected type=$commandType phrase=${message.optString("phrase")} partialTranscriptChars=${message.optInt("partialTranscriptChars")} detectedAt=${message.optString("detectedAt")}"
        )
        thread(name = "VoiceStreamTerminalDetectedLog") {
            runCatching {
                api.uploadLog(
                    "Android microphone capture stopped after terminal phrase",
                    JSONObject()
                        .put("commandType", commandType)
                        .put("phrase", message.optString("phrase"))
                        .put("detectedAt", message.optString("detectedAt"))
                        .put("partialTranscriptChars", message.optInt("partialTranscriptChars"))
                        .put("target", currentTarget)
                )
            }
        }
    }

    private fun handleServerFinish(message: JSONObject, onStatus: (String) -> Unit) {
        val copied = if (currentTarget == Constants.STREAM_TARGET_CLIPBOARD) {
            copyTranscriptToClipboard(message.optString("transcriptText"))
        } else {
            false
        }
        recording.set(false)
        outgoingReady.set(false)
        stopRecordingCountdown()
        pendingStreamBuffer.clear()
        closeSocket("server finish", sendEnd = false)
        val status = if (currentTarget == Constants.STREAM_TARGET_CLIPBOARD) {
            if (copied) "Awake: copied voice transcription" else "Awake: no voice transcription detected"
        } else {
            awakeWaitingStatus()
        }
        onStatus(status)
    }

    private fun handleServerSleep(message: JSONObject, onStatus: (String) -> Unit) {
        if (currentTarget == Constants.STREAM_TARGET_CLIPBOARD) {
            copyTranscriptToClipboard(message.optString("transcriptText"))
        }
        recording.set(false)
        outgoingReady.set(false)
        stopRecordingCountdown()
        pendingStreamBuffer.clear()
        closeSocket("server sleep", sendEnd = false)
        val wasSleeping = sleeping
        sleeping = true
        resetApprovalCollection()
        applyWakeDetectorSettingsIfReady()
        refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
        if (!wasSleeping) {
            cuePlayer.play(LocalCue.SLEEP)
        }
        onStatus(sleepingStatus())
    }

    private fun scheduleReconnect() {
        if (!active.get() || !recording.get() || currentSocketUrl.isBlank()) return
        if (!reconnecting.compareAndSet(false, true)) return
        val attempt = reconnectAttempt.coerceAtMost(MAX_RECONNECT_EXPONENT)
        reconnectAttempt += 1
        val delayMs = minOf(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * (1L shl attempt))
        ClientLog.i("AudioStreamer", "Scheduling voice websocket reconnect attempt=$reconnectAttempt delayMs=$delayMs")
        currentOnStatus?.invoke("Reconnecting voice stream in ${delayLabel(delayMs)}.")
        thread(name = "VoiceStreamNextReconnect") {
            try {
                Thread.sleep(delayMs)
            } finally {
                reconnecting.set(false)
            }
            val onStatus = currentOnStatus ?: return@thread
            val socketUrl = currentSocketUrl
            if (active.get() && recording.get() && socketUrl.isNotBlank()) {
                connectSocket(socketUrl, onStatus)
            }
        }
    }

    private fun startRecordingCountdown(maxDurationMs: Long, onStatus: (String) -> Unit) {
        recordingMaxDurationMs = maxDurationMs
        if (recordingStartedAtMs <= 0L) {
            recordingStartedAtMs = SystemClock.elapsedRealtime()
        }
        mainHandler.removeCallbacks(recordingCountdownRunnable)
        onStatus(recordingStatus(currentTarget))
        mainHandler.postDelayed(recordingCountdownRunnable, 1_000L)
    }

    private fun stopRecordingCountdown() {
        mainHandler.removeCallbacks(recordingCountdownRunnable)
        recordingStartedAtMs = 0L
        recordingMaxDurationMs = 0L
    }

    private fun closeRealtimeWebRtc(sendCancel: Boolean) {
        val session = realtimeWebRtcSession
        val voiceSessionId = currentVoiceSessionId
        val clientSessionId = realtimeWebRtcClientSessionId
        realtimeWebRtcSession = null
        if (session != null) {
            thread(name = "VoiceStreamRealtimeWebRtcClose") {
                session.close(sendCancel)
            }
        } else if (sendCancel && voiceSessionId.isNotBlank() && clientSessionId.isNotBlank()) {
            thread(name = "VoiceStreamRealtimeWebRtcCancel") {
                runCatching { api.cancelRealtimeWebRtcSession(voiceSessionId, clientSessionId) }
            }
        }
        realtimeWebRtcClientSessionId = ""
        if (currentTarget == Constants.STREAM_TARGET_REALTIME) currentVoiceSessionId = ""
    }

    private fun restartAwakeRecorder(onStatus: (String) -> Unit) {
        if (!active.get() || !awakeMode) return
        wakeDetector?.release()
        wakeDetector = VoskWakeWordDetector(
            context,
            { status -> onStatus(status) },
            { text -> mainHandler.post { handleLocalRecognizerText(text, onStatus) } },
        ).also { detector ->
            applyWakeDetectorSettingsIfReady()
            detector.prepare()
        }
        thread(name = "VoiceStreamNextAwakeAudio") {
            runRecorder(onStatus, detectWake = true)
        }
    }

    private fun delayLabel(delayMs: Long): String {
        return if (delayMs < 1000L) "${delayMs}ms" else "${delayMs / 1000L}s"
    }

    @SuppressLint("MissingPermission")
    private fun runRecorder(onStatus: (String) -> Unit, detectWake: Boolean) {
        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val bufferSize = maxOf(minBuffer, CHUNK_BYTES * 8)
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
        )
        recorder = audioRecord
        var echoCanceler: AcousticEchoCanceler? = null
        val buffer = ByteArray(CHUNK_BYTES)
        try {
            echoCanceler = configureEchoCanceler(audioRecord)
            val microphone = microphoneRouter.routeForRecording(audioRecord)
            audioRecord.startRecording()
            emitStatus(
                onStatus,
                if (detectWake) "Awake: listening. ${microphone.label}." else "Streaming microphone frames. ${microphone.label}.",
                microphone = microphone.label,
            )
            while (active.get()) {
                val read = audioRecord.read(buffer, 0, buffer.size)
                if (read <= 0) continue
                val frame = if (read == buffer.size) buffer.copyOf() else buffer.copyOf(read)
                if (detectWake) {
                    handleDetectorFrame(frame, onStatus)
                }
                if (recording.get()) {
                    sendOrBufferFrame(frame)
                }
            }
        } catch (error: Exception) {
            if (active.get()) {
                onStatus(error.message ?: "Audio capture failed.")
            }
        } finally {
            microphoneRouter.releaseRouting()
            echoCanceler?.runCatching { release() }
            runCatching { audioRecord.stop() }
            runCatching { audioRecord.release() }
            if (recorder === audioRecord) recorder = null
            if (!realtimeWebRtcHandoff.get()) {
                active.set(false)
                recording.set(false)
                outgoingReady.set(false)
                reconnecting.set(false)
                wakeConfirmationInFlight.set(false)
                closeRealtimeWebRtc(sendCancel = true)
                closeSocket("recorder stopped", sendEnd = false)
                wakeDetector?.release()
                wakeDetector = null
            }
        }
    }

    private fun configureEchoCanceler(audioRecord: AudioRecord): AcousticEchoCanceler? {
        if (!api.androidEchoCancellationEnabled()) return null
        if (!AcousticEchoCanceler.isAvailable()) {
            ClientLog.i("AudioStreamer", "Android acoustic echo canceler requested but unavailable")
            return null
        }
        return runCatching {
            val canceler = AcousticEchoCanceler.create(audioRecord.audioSessionId)
            if (canceler == null) {
                ClientLog.i("AudioStreamer", "Android acoustic echo canceler could not be created")
            } else {
                canceler.setEnabled(true)
                ClientLog.i("AudioStreamer", "Android acoustic echo canceler enabled=${canceler.enabled}")
            }
            canceler
        }.onFailure { error ->
            ClientLog.w("AudioStreamer", "Android acoustic echo canceler failed", error)
        }.getOrNull()
    }

    private fun handleDetectorFrame(frame: ByteArray, onStatus: (String) -> Unit) {
        if (shouldSuppressWakeDetectionForPlayback()) {
            wakeDetector?.reset()
            return
        }
        if (!recording.get()) {
            preRollBuffer.push(frame)
        }
        val match = wakeDetector?.acceptPcm(frame, frame.size) ?: return
        if (recording.get()) {
            wakeDetector?.reset()
            return
        }
        mainHandler.post { handleWakePhrase(match, onStatus) }
    }

    private fun handleWakePhrase(match: WakePhraseMatch, onStatus: (String) -> Unit) {
        if (!active.get()) return
        if (shouldSuppressWakeDetectionForPlayback()) {
            wakeDetector?.reset()
            return
        }
        when {
            match.hasUnlock && sleeping -> {
                wakeDetector?.reset()
                confirmUnlockWakePhrase(onStatus)
            }
            match.hasShutdown -> {
                wakeDetector?.reset()
                confirmShutdownWakePhrase(onStatus)
            }
            match.hasStart && !sleeping -> {
                sleeping = false
                pendingAssistantProfileId = match.assistantProfileId
                wakeDetector?.reset()
                cuePlayer.play(LocalCue.WAKE)
                beginRecording(if (api.heySebastianRealtimeEnabled()) Constants.STREAM_TARGET_REALTIME else Constants.STREAM_TARGET_ASSISTANT, onStatus)
            }
            match.hasPatch && !sleeping -> {
                wakeDetector?.reset()
                cuePlayer.play(LocalCue.WAKE)
                beginRecording(Constants.STREAM_TARGET_PATCH, onStatus)
            }
            match.hasClipboard && !sleeping -> {
                wakeDetector?.reset()
                cuePlayer.play(LocalCue.WAKE)
                beginRecording(Constants.STREAM_TARGET_CLIPBOARD, onStatus)
            }
            match.hasSleep -> {
                wakeDetector?.reset()
                if (sleeping) return
                sleeping = true
                resetApprovalCollection()
                applyWakeDetectorSettingsIfReady()
                refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
                cuePlayer.play(LocalCue.SLEEP)
                if (recording.get()) {
                    endRecording(onStatus, sleepingStatus())
                } else {
                    onStatus(sleepingStatus())
                }
            }
            match.hasStatus -> {
                cuePlayer.play(LocalCue.STATUS)
                onStatus(if (recording.get()) recordingStatus(currentTarget) else "Awake: waiting for assistant wake phrase")
            }
            match.hasStopAudio -> {
                wakeDetector?.reset()
                AssistantAudioPlayer.stopCurrent()
                onStatus(if (recording.get()) recordingStatus(currentTarget) else "Awake: assistant audio stopped")
            }
            match.hasRepeatAudio -> {
                wakeDetector?.reset()
                val repeated = AssistantAudioPlayer.repeatLast(context, onStatus)
                onStatus(if (repeated) "Awake: repeating assistant audio" else "Awake: no assistant audio to repeat")
            }
        }
    }

    private fun confirmUnlockWakePhrase(onStatus: (String) -> Unit) {
        if (!wakeConfirmationInFlight.compareAndSet(false, true)) return
        val expectedPhrase = approvalSettings.unlockPhrase.ifBlank { VoicePhraseDefaults.unlockPhrase }
        val pcm = concatFrames(preRollBuffer.snapshot())
        if (pcm.size < WAKE_CONFIRMATION_MIN_BYTES) {
            wakeConfirmationInFlight.set(false)
            onStatus(wakeConfirmationFailureStatus("not enough wake audio"))
            return
        }
        cuePlayer.play(LocalCue.WAKE_PENDING)
        onStatus("Sleeping. Confirming wake phrase.")
        thread(name = "VoiceStreamWakeConfirmation") {
            val result = runCatching { api.confirmWakePhrase(pcm, expectedPhrase) }
            mainHandler.post {
                wakeConfirmationInFlight.set(false)
                if (!active.get() || !sleeping) return@post
                if (result.getOrNull()?.confirmed == true) {
                    sleeping = false
                    applyWakeDetectorSettingsIfReady()
                    refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
                    wakeDetector?.reset()
                    cuePlayer.play(LocalCue.UNLOCK)
                    onStatus("Awake: waiting for assistant wake phrase")
                } else {
                    wakeDetector?.reset()
                    onStatus(wakeConfirmationFailureStatus(result.exceptionOrNull()?.message))
                }
            }
        }
    }

    private fun confirmShutdownWakePhrase(onStatus: (String) -> Unit) {
        if (!wakeConfirmationInFlight.compareAndSet(false, true)) return
        val expectedPhrase = approvalSettings.shutdownPhrase.ifBlank { VoicePhraseDefaults.shutdownPhrase }
        val detectedWhileSleeping = sleeping
        val pcm = concatFrames(preRollBuffer.snapshot())
        if (pcm.size < WAKE_CONFIRMATION_MIN_BYTES) {
            wakeConfirmationInFlight.set(false)
            onStatus(shutdownConfirmationFailureStatus("not enough wake audio", detectedWhileSleeping))
            return
        }
        cuePlayer.play(LocalCue.WAKE_PENDING)
        onStatus(if (detectedWhileSleeping) "Sleeping. Confirming shutdown phrase." else "Awake: confirming shutdown phrase.")
        thread(name = "VoiceStreamShutdownConfirmation") {
            val result = runCatching { api.confirmWakePhrase(pcm, expectedPhrase) }
            mainHandler.post {
                wakeConfirmationInFlight.set(false)
                if (!active.get()) return@post
                if (result.getOrNull()?.confirmed == true) {
                    wakeDetector?.reset()
                    cuePlayer.play(LocalCue.SLEEPING_OFF)
                    onStatus("Off")
                    stop()
                } else {
                    wakeDetector?.reset()
                    onStatus(shutdownConfirmationFailureStatus(result.exceptionOrNull()?.message, detectedWhileSleeping))
                }
            }
        }
    }

    private fun wakeConfirmationFailureStatus(message: String?): String {
        val text = message.orEmpty()
        return when {
            text.contains("not enough wake audio", ignoreCase = true) -> "Sleeping. Wake confirmation needs microphone audio."
            text.contains("credit", ignoreCase = true) -> "Sleeping. $text"
            else -> "Sleeping. Wake phrase was not confirmed."
        }
    }

    private fun shutdownConfirmationFailureStatus(message: String?, detectedWhileSleeping: Boolean): String {
        val prefix = if (detectedWhileSleeping) "Sleeping." else "Awake:"
        val text = message.orEmpty()
        return when {
            text.contains("not enough wake audio", ignoreCase = true) -> "$prefix Shutdown confirmation needs microphone audio."
            text.contains("credit", ignoreCase = true) -> "$prefix $text"
            else -> "$prefix Shutdown phrase was not confirmed."
        }
    }

    private fun shouldSuppressWakeDetectionForPlayback(): Boolean {
        return !recording.get() &&
            api.suppressWakeDuringPlaybackEnabled() &&
            AssistantAudioPlayer.isPlaybackActive()
    }

    private fun handleLocalRecognizerText(text: String, onStatus: (String) -> Unit) {
        if (!active.get()) return
        uploadRecognizerTextForDebugging(text)
        if (sleeping) return
        val update = approvalCodeRecognizer.accept(text, SystemClock.elapsedRealtime())
        handleApprovalUpdate(update, onStatus)
        if (approvalCodeRecognizer.isCollecting) {
            scheduleApprovalFinalize()
        }
    }

    private fun uploadRecognizerTextForDebugging(text: String) {
        val cleaned = text.trim().replace(Regex("\\s+"), " ").take(240)
        if (cleaned.isBlank() || cleaned == lastUploadedRecognizerText) return
        pendingRecognizerText = cleaned
        mainHandler.removeCallbacks(recognizerTextUploadRunnable)
        mainHandler.postDelayed(recognizerTextUploadRunnable, LOCAL_RECOGNIZER_LOG_DEBOUNCE_MS)
    }

    private fun uploadPendingRecognizerTextForDebugging() {
        if (!active.get()) return
        val cleaned = pendingRecognizerText
        pendingRecognizerText = ""
        if (cleaned.isBlank() || cleaned == lastUploadedRecognizerText) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastRecognizerUploadAtMs < LOCAL_RECOGNIZER_LOG_COOLDOWN_MS) return
        lastUploadedRecognizerText = cleaned
        lastRecognizerUploadAtMs = now
        val mode = when {
            sleeping -> "sleeping"
            recording.get() -> "recording"
            else -> "awake"
        }
        thread(name = "VoiceStreamRecognizerTextUpload") {
            runCatching {
                api.uploadLog(
                    "Vosk heard: $cleaned",
                    JSONObject()
                        .put("kind", "vosk_utterance")
                        .put("text", cleaned)
                        .put("mode", mode)
                        .put("target", currentTarget)
                )
            }.onFailure { error ->
                ClientLog.w("AudioStreamer", "Vosk utterance upload failed", error)
            }
        }
    }

    private fun scheduleApprovalFinalize() {
        mainHandler.removeCallbacks(approvalFinalizeRunnable)
        mainHandler.postDelayed(approvalFinalizeRunnable, approvalCodeSettings.finalizeCheckIntervalMs)
    }

    private fun resetApprovalCollection() {
        mainHandler.removeCallbacks(approvalFinalizeRunnable)
        approvalCodeRecognizer.reset()
    }

    private fun handleApprovalUpdate(update: ApprovalCodeUpdate, onStatus: (String) -> Unit) {
        when (update) {
            ApprovalCodeUpdate.None -> Unit
            is ApprovalCodeUpdate.Collecting -> {
                val text = if (update.partialCode.isBlank()) {
                    "Approval code..."
                } else {
                    "Approval: ${update.partialCode}"
                }
                emitStatus(onStatus, text, approvalStatus = text)
            }
            ApprovalCodeUpdate.Cancelled -> emitStatus(onStatus, "Approval cancelled", approvalStatus = "Approval cancelled")
            is ApprovalCodeUpdate.Completed -> handleApprovalCode(update.code, onStatus)
        }
    }

    private fun handleApprovalCode(code: String, onStatus: (String) -> Unit) {
        val settings = approvalSettings
        when {
            sleeping -> onStatus(sleepingStatus())
            code == settings.lockCode -> {
                sleeping = true
                resetApprovalCollection()
                applyWakeDetectorSettingsIfReady()
                refreshApprovalSettings { applyWakeDetectorSettingsIfReady() }
                cuePlayer.play(LocalCue.SLEEP)
                if (recording.get()) {
                    endRecording(onStatus, sleepingStatus())
                } else {
                    onStatus(sleepingStatus())
                }
            }
            else -> {
                cuePlayer.play(LocalCue.STATUS)
                val text = "Approval sent: $code"
                emitStatus(onStatus, text, approvalStatus = text)
                thread(name = "VoiceStreamApprovalUpload") {
                    runCatching { api.uploadApprovalCode(code) }
                }
            }
        }
    }

    private fun applyWakeDetectorSettingsIfReady() {
        if (!active.get()) return
        val detector = wakeDetector ?: return
        val settings = approvalSettings
        detector.applyListeningSettings(
            sleepModeEnabled = sleeping,
            unlock = settings.unlockPhrase,
            shutdown = settings.shutdownPhrase,
            approvalTrigger = settings.triggerPhrase,
            profiles = settings.assistantProfiles,
        )
    }

    private fun refreshApprovalSettings(onUpdated: (() -> Unit)? = null) {
        thread(name = "VoiceStreamApprovalSettingsRefresh") {
            val settings = runCatching { api.voiceApprovalSettings() }.getOrElse { approvalSettings }
            mainHandler.post {
                approvalSettings = settings
                approvalCodeSettings = settings.toApprovalCodeSettings()
                approvalCodeRecognizer.configure(approvalCodeSettings)
                onUpdated?.invoke()
            }
        }
    }

    private fun uploadVoiceStartFailure(target: String, message: String, error: Exception) {
        runCatching {
            api.uploadLog(
                "Android voice stream failed to start",
                JSONObject()
                    .put("target", target)
                    .put("error", message)
                    .put("type", error.javaClass.name)
            )
        }
    }

    private fun sendOrBufferFrame(frame: ByteArray) {
        if (currentTarget == Constants.STREAM_TARGET_REALTIME) return
        if (outgoingReady.get()) {
            flushPendingFrames()
            socket?.send(frame.toByteString())
        } else {
            pendingStreamBuffer.push(frame)
        }
    }

    private fun flushPendingFrames() {
        val localSocket = socket ?: return
        for (frame in pendingStreamBuffer.drain()) {
            localSocket.send(frame.toByteString())
        }
    }

    private fun closeSocket(reason: String, sendEnd: Boolean) {
        val localSocket = socket
        socket = null
        if (sendEnd) localSocket?.send(JSONObject().put("type", "end").put("reason", reason).toString())
        localSocket?.close(1000, reason)
    }

    private fun sendEnd(reason: String) {
        socket?.send(JSONObject().put("type", "end").put("reason", reason).toString())
    }

    private fun copyTranscriptToClipboard(text: String): Boolean {
        val trimmed = text.trim()
        if (trimmed.isBlank()) return false
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
        return runCatching {
            clipboard.setPrimaryClip(ClipData.newPlainText("VoiceStream transcript", trimmed))
            true
        }.getOrDefault(false)
    }

    private fun buildSocketUrl(serverUrl: String, deviceId: String, token: String, sessionId: String, target: String): String {
        val trimmed = serverUrl.trimEnd('/')
        val base = when {
            trimmed.startsWith("https://") -> "wss://${trimmed.removePrefix("https://")}"
            trimmed.startsWith("http://") -> "ws://${trimmed.removePrefix("http://")}"
            else -> trimmed
        }
        val path = if (target == Constants.STREAM_TARGET_REALTIME) "/api/voice/realtime" else "/api/voice/stream"
        return "$base$path?deviceId=${encode(deviceId)}&token=${encode(token)}&installationId=${encode(api.installationId())}&sessionId=${encode(sessionId)}&mode=${encode(target)}&clientVersion=${BuildConfig.VERSION_CODE}&protocolVersion=1"
    }

    private fun isTerminalCloseCode(code: Int): Boolean {
        return code == 4401 || code == 4403 || code == 4406 || code == 4408 || code == 4409 || code == 4410
    }

    private fun cleanTarget(target: String): String {
        return when (target) {
            Constants.STREAM_TARGET_REALTIME,
            Constants.STREAM_TARGET_PATCH,
            Constants.STREAM_TARGET_CLIPBOARD -> target
            else -> Constants.STREAM_TARGET_ASSISTANT
        }
    }

    private fun recordingStatus(target: String): String {
        val base = when (target) {
            Constants.STREAM_TARGET_REALTIME -> "Awake: realtime assistant listening"
            Constants.STREAM_TARGET_PATCH -> "Awake: patching into chat"
            Constants.STREAM_TARGET_CLIPBOARD -> "Awake: recording clipboard transcription"
            else -> "Awake: recording"
        }
        val remainingMs = recordingRemainingMs()
        return if (remainingMs != null) "$base · ${formatCountdown(remainingMs)} left" else base
    }

    private fun recordingRemainingMs(): Long? {
        val maxMs = recordingMaxDurationMs
        val startedAt = recordingStartedAtMs
        if (!recording.get() || maxMs <= 0L || startedAt <= 0L) return null
        return (maxMs - (SystemClock.elapsedRealtime() - startedAt)).coerceAtLeast(0L)
    }

    private fun formatCountdown(ms: Long): String {
        val totalSeconds = ((ms + 999L) / 1_000L).coerceAtLeast(0L)
        val minutes = totalSeconds / 60L
        val seconds = totalSeconds % 60L
        return "$minutes:${seconds.toString().padStart(2, '0')}"
    }

    private fun sleepingStatus(): String {
        return "Sleeping. Say your unlock or shutdown phrase."
    }

    private fun awakeWaitingStatus(): String {
        return "Awake: waiting for assistant wake phrase"
    }

    private fun encode(value: String): String {
        return URLEncoder.encode(value, Charsets.UTF_8.name())
    }

    private fun concatFrames(frames: List<ByteArray>): ByteArray {
        val totalBytes = frames.sumOf { it.size }
        val output = ByteArray(totalBytes)
        var offset = 0
        for (frame in frames) {
            frame.copyInto(output, offset)
            offset += frame.size
        }
        return output
    }

    private companion object {
        const val SAMPLE_RATE = 16_000
        const val CHUNK_MS = 20
        const val CHUNK_BYTES = SAMPLE_RATE * 2 * CHUNK_MS / 1000
        const val PRE_ROLL_MS = 1_500
        const val MAX_PENDING_STREAM_MS = 5_000
        const val PRE_ROLL_FRAME_COUNT = PRE_ROLL_MS / CHUNK_MS
        const val MAX_PENDING_STREAM_FRAME_COUNT = MAX_PENDING_STREAM_MS / CHUNK_MS
        const val WAKE_CONFIRMATION_MIN_BYTES = SAMPLE_RATE * 2 * 50 / 1000
        const val LOCAL_RECOGNIZER_LOG_DEBOUNCE_MS = 650L
        const val LOCAL_RECOGNIZER_LOG_COOLDOWN_MS = 1_000L
        const val BASE_RECONNECT_DELAY_MS = 500L
        const val MAX_RECONNECT_DELAY_MS = 10_000L
        const val MAX_RECONNECT_EXPONENT = 4
    }
}
