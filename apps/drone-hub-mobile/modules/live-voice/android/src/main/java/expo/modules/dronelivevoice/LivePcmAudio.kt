package expo.modules.dronelivevoice

import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioRouting
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.sin

/** One microphone for the whole call, including network startup. PCM16LE / 24 kHz. */
internal class LivePcmAudio(private val onAudio: (String) -> Unit, private val onError: (String) -> Unit,
  private val onHeadsetDisconnected: () -> Unit = {},
  awaitHeadset: Boolean = false,
  private val isVoiceRouteReady: () -> Boolean = { true },
  private val bluetoothWarmupMs: Long = 750) {
  @Volatile private var running = false
  @Volatile private var muted = false
  @Volatile private var playbackReady = !awaitHeadset
  private val handler = Handler(Looper.getMainLooper())
  private val readyCallbacks = mutableListOf<(Boolean) -> Unit>()
  private val routeTimeout = Runnable {
    if (running && !playbackReady) onError("The headset audio route did not connect. Try Live again.")
  }
  private var bluetoothReadyAfter: Long? = null
  private val checkReady = object : Runnable {
    override fun run() {
      if (!running || playbackReady) return
      val after = bluetoothReadyAfter
      if (after != null && (SystemClock.elapsedRealtime() < after || !isVoiceRouteReady())) {
        handler.removeCallbacks(this)
        handler.postDelayed(this, 25)
        return
      }
      player?.setVolume(1f)
      playbackReady = true
      Log.i("DroneLiveVoice", "Live output ready after route/volume settling")
      handler.removeCallbacks(routeTimeout)
      completeReady(true)
    }
  }
  private var headsetRouted = false
  private val routeListener = AudioRouting.OnRoutingChangedListener { routing ->
    if (running) {
      when (routing.routedDevice?.type) {
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID -> {
          headsetRouted = true
          if (!playbackReady) {
            // Normal track gain with silent PCM lets Android observe active
            // voice playback and apply its contextual volume. The queue remains
            // gated, so no cue or speech can escape during this warmup.
            player?.setVolume(1f)
            // Routing can precede Android's contextual Bluetooth volume update
            // by 500 ms. Keep output silent through that settling interval on
            // every start, also waiting for the actual communication-mode event.
            if (routing.routedDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO && bluetoothReadyAfter == null) {
              bluetoothReadyAfter = SystemClock.elapsedRealtime() + bluetoothWarmupMs
            } else if (routing.routedDevice?.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
              bluetoothReadyAfter = null
            }
            checkReady.run()
          }
        }
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> {
          if (headsetRouted) {
            headsetRouted = false
            onHeadsetDisconnected()
          }
        }
      }
    }
  }
  private var recorder: AudioRecord? = null
  private var player: AudioTrack? = null
  private var echo: AcousticEchoCanceler? = null
  private var noise: NoiseSuppressor? = null
  private var captureThread: Thread? = null
  private var playbackThread: Thread? = null
  private val playback = ArrayBlockingQueue<ByteArray>(100)
  private val queuedBytes = AtomicInteger(0)
  private var recordingCueQueued = false
  private var recordingCueBytes: ByteArray? = null

  fun start() {
    try {
      val rate = 48000 // Widely supported hardware rate; downsample pairs to 24 kHz.
      val minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minimum > 0) { "This microphone does not support Live audio" }
      val input = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, rate,
        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, 19200))
      recorder = input
      check(input.state == AudioRecord.STATE_INITIALIZED) { "Could not open the Live microphone" }
      if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(input.audioSessionId)?.apply { enabled = true }
      if (NoiseSuppressor.isAvailable()) noise = NoiseSuppressor.create(input.audioSessionId)?.apply { enabled = true }
      val output = AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setAudioFormat(AudioFormat.Builder().setSampleRate(24000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(maxOf(4800, AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)))
        .setTransferMode(AudioTrack.MODE_STREAM).build()
      player = output
      check(output.state == AudioTrack.STATE_INITIALIZED) { "Could not open Live playback" }
      input.startRecording()
      check(input.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Could not start the Live microphone" }
      // AudioTrack must run to report its actual route. Keep it silent while SCO connects.
      output.setVolume(if (playbackReady) 1f else 0f)
      output.play()
      running = true
      output.addOnRoutingChangedListener(routeListener, handler)
      routeListener.onRoutingChanged(output)
      if (!playbackReady) handler.postDelayed(routeTimeout, 5000)
      captureThread = Thread({
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        val samples = ShortArray(4800)
        var used = 0
        try {
          while (running) {
            val count = input.read(samples, used, samples.size - used)
            if (count <= 0) { if (running) error("Live microphone disconnected"); break }
            used += count
            if (used != samples.size) continue
            val bytes = ByteArray(samples.size)
            for (i in 0 until samples.size / 2) {
              // Capture belongs to the startup buffer, independently of output
              // routing. Waiting for playback must never erase opening speech.
              val value = if (muted) 0 else (samples[i * 2].toInt() + samples[i * 2 + 1].toInt()) / 2
              bytes[i * 2] = value.toByte()
              bytes[i * 2 + 1] = (value shr 8).toByte()
            }
            if (running) onAudio(Base64.encodeToString(bytes, Base64.NO_WRAP))
            used = 0
          }
        } catch (error: Exception) { if (running) onError(error.message ?: "Live microphone failed") }
      }, "LivePcmCapture").apply { start() }
      playbackThread = Thread({
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        // The software queue plus AudioTrack form the reserve. Silence advances
        // AudioTrack's clock while the next network chunks accumulate. Inserting
        // it only on starvation also plays short final chunks without a timer.
        val reserve = ByteArray(12000) // 250 ms, PCM16 mono / 24 kHz.
        var writtenFrames = 0L
        fun write(bytes: ByteArray) {
          var offset = 0
          while (running && offset < bytes.size) {
            val count = output.write(bytes, offset, bytes.size - offset)
            if (count <= 0) { if (running) error("Live playback disconnected"); break }
            offset += count
            writtenFrames += count / 2
          }
        }
        try {
          // A streaming track may need data before Android reports its route.
          // Prime it with silence so the recording cue can run without waiting
          // for the first server response. User speech remains queued below.
          val startupSilence = ByteArray(4800)
          while (running) {
            if (!playbackReady) {
              // Keep the voice track active while its device and volume settle.
              // AudioTrack.write supplies the real-time pacing; the short yield
              // also avoids spinning on devices that accept writes immediately.
              write(startupSilence)
              Thread.sleep(5)
              continue
            }
            val bytes = playback.poll(100, TimeUnit.MILLISECONDS) ?: continue
            // Playback head is an unsigned 32-bit frame counter; compare modulo
            // 2^32 so long sessions keep detecting starvation after it wraps.
            if (writtenFrames.toInt() == output.playbackHeadPosition) write(reserve)
            write(bytes)
            if (running && bytes === recordingCueBytes) Log.i("DroneLiveVoice", "Start cue submitted to Live output")
            queuedBytes.addAndGet(-bytes.size)
          }
        } catch (error: Exception) { if (running) onError(error.message ?: "Live playback failed") }
      }, "LivePcmPlayback").apply { start() }
    } catch (error: Exception) { stop(); throw error }
  }

  fun whenPlaybackReady(callback: (Boolean) -> Unit) {
    if (!running || playbackReady) callback(running && playbackReady)
    else readyCallbacks.add(callback)
  }

  private fun completeReady(ready: Boolean) {
    val callbacks = readyCallbacks.toList()
    readyCallbacks.clear()
    callbacks.forEach { it(ready) }
  }

  fun mute(value: Boolean) { muted = value }
  fun playRecordingCue(callback: (Boolean) -> Unit = {}) {
    if (!running || recordingCueQueued) { callback(false); return }
    recordingCueQueued = true
    // Use the same track as Live speech. A separate ToneGenerator can compete
    // with the voice output during startup even after SCO reports connected.
    // Gentle 600/750 Hz notes, 100 ms each, with a 100 ms gap and 25 ms fades.
    val bytes = ByteArray(14400)
    for (frame in 0 until 7200) {
      val offset = frame % 4800
      val ramp = minOf(1.0, offset / 600.0, (2399 - offset) / 600.0).coerceAtLeast(0.0)
      val envelope = sin(Math.PI * ramp / 2).let { it * it }
      val frequency = if (frame < 2400) 600 else 750
      val value = (sin(2 * Math.PI * frequency * frame / 24000) * 3500 * envelope).toInt()
      bytes[frame * 2] = value.toByte()
      bytes[frame * 2 + 1] = (value shr 8).toByte()
    }
    recordingCueBytes = bytes
    enqueue(bytes) // Queued before server speech, held until the output route is ready.
    whenPlaybackReady(callback)
  }

  fun play(audio: String) {
    if (!running) return
    require(audio.length <= 256000) { "Invalid Live audio chunk" }
    val bytes = Base64.decode(audio, Base64.DEFAULT)
    require(bytes.isNotEmpty() && bytes.size % 2 == 0) { "Invalid Live PCM audio" }
    enqueue(bytes)
  }

  private fun enqueue(bytes: ByteArray) {
    if (queuedBytes.addAndGet(bytes.size) > 240000 || !playback.offer(bytes)) {
      queuedBytes.addAndGet(-bytes.size)
      error("Live voice playback fell behind. Start again.")
    }
  }
  fun stop() {
    running = false
    muted = true
    // AudioRecord.stop can block. Silence queued output before waiting for the microphone.
    try { player?.setVolume(0f); player?.pause(); player?.flush() } catch (_: Exception) {}
    player?.removeOnRoutingChangedListener(routeListener)
    handler.removeCallbacks(routeTimeout)
    handler.removeCallbacks(checkReady)
    completeReady(false)
    try { recorder?.stop() } catch (_: Exception) {}
    captureThread?.join(1000)
    playbackThread?.join(1000)
    recorder?.release(); recorder = null
    player?.release(); player = null
    echo?.release(); echo = null
    noise?.release(); noise = null
    playback.clear(); queuedBytes.set(0)
  }
}
