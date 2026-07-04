package com.huntelkator.voicestreamnext

import android.content.Context
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class RealtimeWebRtcSession(
    private val context: Context,
    private val api: VoiceStreamApi,
    private val voiceSessionId: String,
    private val clientSessionId: String,
    private val assistantProfileId: String?,
    private val onStatus: (String) -> Unit,
) {
    private val closed = AtomicBoolean(false)
    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var peer: PeerConnection? = null
    private var dataChannel: DataChannel? = null

    fun start(): RealtimeWebRtcStartResult {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions()
        )
        eglBase = EglBase.create()
        val audioModule = JavaAudioDeviceModule.builder(context)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
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
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
            override fun onIceCandidate(candidate: IceCandidate?) = Unit
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
            override fun onAddStream(stream: MediaStream?) = Unit
            override fun onRemoveStream(stream: MediaStream?) = Unit
            override fun onDataChannel(channel: DataChannel?) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) = Unit
        }) ?: throw IllegalStateException("WebRTC peer connection was not created.")
        val localPeer = peer ?: throw IllegalStateException("WebRTC peer connection was not created.")
        audioSource = localFactory.createAudioSource(MediaConstraints())
        audioTrack = localFactory.createAudioTrack("voice_stream_realtime_audio", audioSource)
        localPeer.addTrack(audioTrack, listOf("voice_stream_realtime"))
        dataChannel = localPeer.createDataChannel("oai-events", DataChannel.Init())
        val offer = createOffer(localPeer)
        setLocalDescription(localPeer, offer)
        val result = api.startRealtimeWebRtcSession(voiceSessionId, clientSessionId, offer.description, assistantProfileId)
        setRemoteDescription(localPeer, SessionDescription(SessionDescription.Type.ANSWER, result.sdpAnswer))
        onStatus("Realtime assistant is listening.")
        return result
    }

    fun close(sendCancel: Boolean = true) {
        if (!closed.compareAndSet(false, true)) return
        if (sendCancel) {
            runCatching { api.cancelRealtimeWebRtcSession(voiceSessionId, clientSessionId) }
        }
        runCatching { dataChannel?.close() }
        dataChannel = null
        runCatching { peer?.close() }
        peer = null
        runCatching { audioTrack?.dispose() }
        audioTrack = null
        runCatching { audioSource?.dispose() }
        audioSource = null
        runCatching { factory?.dispose() }
        factory = null
        runCatching { eglBase?.release() }
        eglBase = null
    }

    private fun createOffer(peer: PeerConnection): SessionDescription {
        val latch = CountDownLatch(1)
        var description: SessionDescription? = null
        var failure: String? = null
        peer.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription?) {
                description = desc
                latch.countDown()
            }

            override fun onCreateFailure(error: String?) {
                failure = error ?: "createOffer failed"
                latch.countDown()
            }
        }, MediaConstraints())
        awaitSdp("createOffer", latch)
        if (!failure.isNullOrBlank()) throw IllegalStateException(failure)
        return description ?: throw IllegalStateException(failure ?: "WebRTC offer was empty.")
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
}

open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription?) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String?) = Unit
    override fun onSetFailure(error: String?) = Unit
}
