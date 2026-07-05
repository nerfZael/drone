package com.huntelkator.voicestreamnext

import android.content.Context
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class RealtimeWebRtcSession(
    private val context: Context,
    private val api: VoiceStreamApi,
    private val voiceSessionId: String,
    private val clientSessionId: String,
    private val assistantProfileId: String?,
    private val onStatus: (String) -> Unit,
    private val onClosed: () -> Unit = {},
) {
    private val closed = AtomicBoolean(false)
    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var peer: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    private val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
    private val remoteAudioTracks = CopyOnWriteArraySet<AudioTrack>()
    private var audioFocusRequest: AudioFocusRequest? = null
    private var originalCommunicationDevice: AudioDeviceInfo? = null
    private var originalSpeakerphoneOn: Boolean? = null
    private var communicationDeviceSet = false
    private var inputTranscript = ""
    private val volumePreferenceListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == Constants.PREF_ASSISTANT_SPEECH_PLAYBACK_VOLUME_PERCENT) applyRemoteAudioVolumeToAll()
    }

    fun start(): RealtimeWebRtcStartResult {
        prefs.registerOnSharedPreferenceChangeListener(volumePreferenceListener)
        requestRealtimeAudioFocus()
        routeRealtimeAudioToSpeakerWhenNeeded()
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions()
        )
        eglBase = EglBase.create()
        val audioModuleBuilder = JavaAudioDeviceModule.builder(context)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
        configureWebRtcOutputUsage(audioModuleBuilder)
        val audioModule = audioModuleBuilder
            .createAudioDeviceModule()
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(audioModule)
            .createPeerConnectionFactory()
        audioModule.release()
        val localFactory = factory ?: throw IllegalStateException("WebRTC factory was not created.")
        val rtcConfig = PeerConnection.RTCConfiguration(emptyList())
        peer = localFactory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                if (!closed.get() && state != null) onStatus("Realtime WebRTC: ${state.name.lowercase()}")
                if (!closed.get() && (state == PeerConnection.IceConnectionState.DISCONNECTED || state == PeerConnection.IceConnectionState.FAILED || state == PeerConnection.IceConnectionState.CLOSED)) {
                    onClosed()
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
            override fun onIceCandidate(candidate: IceCandidate?) = Unit
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
            override fun onAddStream(stream: MediaStream?) {
                stream?.audioTracks?.forEach { configureRemoteAudioTrack(it) }
            }
            override fun onRemoveStream(stream: MediaStream?) = Unit
            override fun onDataChannel(channel: DataChannel?) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                (receiver?.track() as? AudioTrack)?.let { configureRemoteAudioTrack(it) }
                streams?.forEach { stream -> stream.audioTracks.forEach { configureRemoteAudioTrack(it) } }
            }
        }) ?: throw IllegalStateException("WebRTC peer connection was not created.")
        val localPeer = peer ?: throw IllegalStateException("WebRTC peer connection was not created.")
        audioSource = localFactory.createAudioSource(MediaConstraints())
        audioTrack = localFactory.createAudioTrack("voice_stream_realtime_audio", audioSource)
        localPeer.addTrack(audioTrack, listOf("voice_stream_realtime"))
        dataChannel = localPeer.createDataChannel("oai-events", DataChannel.Init())
        dataChannel?.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit
            override fun onStateChange() = Unit
            override fun onMessage(buffer: DataChannel.Buffer) {
                handleRealtimeEvent(buffer.data.toUtf8String())
            }
        })
        val offer = createOffer(localPeer)
        setLocalDescription(localPeer, offer)
        val result = api.startRealtimeWebRtcSession(voiceSessionId, clientSessionId, offer.description, assistantProfileId)
        setRemoteDescription(localPeer, SessionDescription(SessionDescription.Type.ANSWER, result.sdpAnswer))
        onStatus("Realtime assistant is listening.")
        return result
    }

    fun close(sendCancel: Boolean = true) {
        if (!closed.compareAndSet(false, true)) return
        closeAfterMarked(sendCancel)
    }

    private fun closeAfterMarked(sendCancel: Boolean) {
        if (sendCancel) {
            runCatching { api.cancelRealtimeWebRtcSession(voiceSessionId, clientSessionId) }
        }
        runCatching { dataChannel?.unregisterObserver() }
        runCatching { dataChannel?.close() }
        dataChannel = null
        runCatching { peer?.close() }
        peer = null
        runCatching { audioTrack?.dispose() }
        audioTrack = null
        remoteAudioTracks.clear()
        runCatching { audioSource?.dispose() }
        audioSource = null
        runCatching { factory?.dispose() }
        factory = null
        runCatching { eglBase?.release() }
        eglBase = null
        restoreRealtimeAudioRouting()
        abandonRealtimeAudioFocus()
        runCatching { prefs.unregisterOnSharedPreferenceChangeListener(volumePreferenceListener) }
    }

    private fun createOffer(peer: PeerConnection): SessionDescription {
        val latch = CountDownLatch(1)
        var offerDescription: SessionDescription? = null
        var failure: String? = null
        peer.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(description: SessionDescription?) {
                offerDescription = description
                latch.countDown()
            }

            override fun onCreateFailure(error: String?) {
                failure = error ?: "createOffer failed"
                latch.countDown()
            }
        }, MediaConstraints())
        awaitSdp("createOffer", latch)
        if (!failure.isNullOrBlank()) throw IllegalStateException(failure)
        return offerDescription ?: throw IllegalStateException(failure ?: "WebRTC offer was empty.")
    }

    private fun setLocalDescription(peer: PeerConnection, description: SessionDescription) {
        setDescription("setLocalDescription") { observer -> peer.setLocalDescription(observer, description) }
    }

    private fun setRemoteDescription(peer: PeerConnection, description: SessionDescription) {
        setDescription("setRemoteDescription") { observer -> peer.setRemoteDescription(observer, description) }
    }

    private fun setDescription(label: String, block: (SdpObserver) -> Unit) {
        val latch = CountDownLatch(1)
        var failure: String? = null
        block(object : SimpleSdpObserver() {
            override fun onSetSuccess() {
                latch.countDown()
            }

            override fun onSetFailure(error: String?) {
                failure = error ?: "$label failed"
                latch.countDown()
            }
        })
        awaitSdp(label, latch)
        if (!failure.isNullOrBlank()) throw IllegalStateException(failure)
    }

    private fun awaitSdp(label: String, latch: CountDownLatch) {
        if (!latch.await(12, TimeUnit.SECONDS)) throw IllegalStateException("$label timed out")
    }

    private fun configureRemoteAudioTrack(track: AudioTrack) {
        remoteAudioTracks.add(track)
        applyRemoteAudioVolume(track)
    }

    private fun applyRemoteAudioVolumeToAll() {
        remoteAudioTracks.forEach { applyRemoteAudioVolume(it) }
    }

    private fun applyRemoteAudioVolume(track: AudioTrack) {
        val volume = AssistantSpeechPlaybackVolume.percent(context)
        val gain = AssistantSpeechPlaybackVolume.gain(volume)
        val applied = runCatching { track.setVolume(gain) }.isSuccess
        ClientLog.i("RealtimeWebRtc", "Configured remote realtime audio volume=$volume% gain=$gain applied=$applied usage=media")
    }

    private fun requestRealtimeAudioFocus() {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener { }
            .build()
        val result = runCatching { audioManager.requestAudioFocus(request) }.getOrDefault(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
        if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            audioFocusRequest = request
        } else {
            ClientLog.w("RealtimeWebRtc", "Realtime audio focus not granted result=$result")
        }
    }

    private fun abandonRealtimeAudioFocus() {
        val request = audioFocusRequest ?: return
        audioFocusRequest = null
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return
        runCatching { audioManager.abandonAudioFocusRequest(request) }
    }

    private fun routeRealtimeAudioToSpeakerWhenNeeded() {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return
        if (hasExternalOutput(audioManager)) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val speaker = runCatching {
                audioManager.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            }.getOrNull()
            if (speaker != null) {
                originalCommunicationDevice = runCatching { audioManager.communicationDevice }.getOrNull()
                communicationDeviceSet = runCatching { audioManager.setCommunicationDevice(speaker) }.getOrDefault(false)
                if (!communicationDeviceSet) originalCommunicationDevice = null
            }
        } else {
            @Suppress("DEPRECATION")
            originalSpeakerphoneOn = runCatching { audioManager.isSpeakerphoneOn }.getOrNull()
            @Suppress("DEPRECATION")
            runCatching { audioManager.isSpeakerphoneOn = true }
        }
    }

    private fun restoreRealtimeAudioRouting() {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && communicationDeviceSet) {
            val previous = originalCommunicationDevice
            if (previous != null) {
                runCatching { audioManager.setCommunicationDevice(previous) }
            } else {
                runCatching { audioManager.clearCommunicationDevice() }
            }
        }
        communicationDeviceSet = false
        originalCommunicationDevice = null
        originalSpeakerphoneOn?.let { speakerphoneOn ->
            @Suppress("DEPRECATION")
            runCatching { audioManager.isSpeakerphoneOn = speakerphoneOn }
        }
        originalSpeakerphoneOn = null
    }

    private fun hasExternalOutput(audioManager: AudioManager): Boolean {
        return runCatching {
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { device ->
                device.isSink && when (device.type) {
                    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                    AudioDeviceInfo.TYPE_WIRED_HEADSET,
                    AudioDeviceInfo.TYPE_USB_DEVICE,
                    AudioDeviceInfo.TYPE_USB_HEADSET -> true
                    else -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && device.type == AudioDeviceInfo.TYPE_BLE_HEADSET
                }
            }
        }.getOrDefault(false)
    }

    private fun configureWebRtcOutputUsage(builder: JavaAudioDeviceModule.Builder) {
        val usage = AudioAttributes.USAGE_MEDIA
        val configuredOnBuilder = runCatching {
            builder.javaClass.getMethod("setAudioTrackUsageAttribute", Int::class.javaPrimitiveType!!).invoke(builder, usage)
            true
        }.getOrDefault(false)
        if (configuredOnBuilder) {
            ClientLog.i("RealtimeWebRtc", "Configured WebRTC output usage=media")
            return
        }

        val configuredOnTrack = runCatching {
            Class.forName("org.webrtc.audio.WebRtcAudioTrack")
                .getMethod("setAudioTrackUsageAttribute", Int::class.javaPrimitiveType!!)
                .invoke(null, usage)
            true
        }.getOrDefault(false)
        if (configuredOnTrack) {
            ClientLog.i("RealtimeWebRtc", "Configured WebRTC audio track usage=media")
        } else {
            ClientLog.w("RealtimeWebRtc", "WebRTC output usage override is unavailable; using default WebRTC routing")
        }
    }

    private fun handleRealtimeEvent(raw: String) {
        if (closed.get()) return
        val event = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (event.optString("type")) {
            "conversation.item.input_audio_transcription.delta" -> {
                inputTranscript += event.optString("delta")
                if (RealtimeTerminalPhrase.isCommandOnlyStop(inputTranscript)) stopForTerminalPhrase(inputTranscript)
            }
            "conversation.item.input_audio_transcription.completed",
            "conversation.item.input_audio_transcription.done" -> {
                val transcript = event.optString("transcript").ifBlank { inputTranscript }
                inputTranscript = ""
                if (RealtimeTerminalPhrase.isStopCommand(transcript)) {
                    stopForTerminalPhrase(transcript, delayMs = if (RealtimeTerminalPhrase.isCommandOnlyStop(transcript)) 0L else CONTENT_STOP_DELAY_MS)
                }
            }
            "conversation.item.done",
            "conversation.item.added" -> {
                val transcript = inputTextFromItem(event.optJSONObject("item"))
                if (RealtimeTerminalPhrase.isStopCommand(transcript)) {
                    stopForTerminalPhrase(transcript, delayMs = if (RealtimeTerminalPhrase.isCommandOnlyStop(transcript)) 0L else CONTENT_STOP_DELAY_MS)
                }
            }
        }
    }

    private fun inputTextFromItem(item: JSONObject?): String {
        if (item == null || item.optString("type") != "message" || item.optString("role") != "user") return ""
        val content = item.optJSONArray("content") ?: return ""
        val parts = mutableListOf<String>()
        for (index in 0 until content.length()) {
            val part = content.optJSONObject(index) ?: continue
            val type = part.optString("type")
            if (type == "input_text" || type == "text") parts.add(part.optString("text"))
        }
        return parts.joinToString(" ")
    }

    private fun stopForTerminalPhrase(transcript: String, delayMs: Long = 0L) {
        if (!closed.compareAndSet(false, true)) return
        ClientLog.i("RealtimeWebRtc", "Realtime terminal phrase detected locally transcriptChars=${transcript.length}")
        onStatus("Realtime assistant stopped.")
        thread(name = "VoiceStreamRealtimeWebRtcTerminalClose") {
            if (delayMs > 0L) runCatching { Thread.sleep(delayMs) }
            closeAfterMarked(sendCancel = true)
        }
        onClosed()
    }

    private fun ByteBuffer.toUtf8String(): String {
        val copy = duplicate()
        val bytes = ByteArray(copy.remaining())
        copy.get(bytes)
        return String(bytes, Charsets.UTF_8)
    }

    private companion object {
        private const val CONTENT_STOP_DELAY_MS = 500L
    }
}

open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription?) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String?) = Unit
    override fun onSetFailure(error: String?) = Unit
}
