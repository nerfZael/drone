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
    if (stoppedOutput && headsetRouted) {
      val device = routing.routedDevice
      if (isHeadset(device)) {
        stoppedCueRouteReady = true
        if (stoppedCuePlaying) player?.setVolume(1f)
      } else if (device != null) finishStoppedCue()
    }
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
  private val playbackProgress = AtomicInteger(0)
  private var recoveryWatchdog: Runnable? = null
  private var recordingCueQueued = false
  private var recordingCueBytes: ByteArray? = null
  private var stoppedOutput = false
  @Volatile private var stoppedCuePlaying = false
  @Volatile private var stoppedCueRouteReady = false
  private val stoppedCueCallbacks = mutableListOf<() -> Unit>()
  private val stoppedCueTimeout = Runnable { finishStoppedCue() }
  private var stoppedCueFrames = 0
  private val checkStoppedCue = object : Runnable {
    override fun run() {
      val output = player ?: return
      if (output.playbackHeadPosition >= stoppedCueFrames) finishStoppedCue()
      else handler.postDelayed(this, 10)
    }
  }

  fun start(recordingCue: Boolean = false) {
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
      Log.i("DroneLiveVoice", "Microphone recording started; startup buffering available")
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
            playbackProgress.incrementAndGet()
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
            // A local cue needs no reserve for network jitter. Keep that extra
            // 250 ms for assistant speech only, after the headset readiness gate.
            if (bytes !== recordingCueBytes && writtenFrames.toInt() == output.playbackHeadPosition) write(reserve)
            if (bytes === recordingCueBytes) {
              val queuedFrames = (writtenFrames - (output.playbackHeadPosition.toLong() and 0xffffffffL)) and 0xffffffffL
              Log.i("DroneLiveVoice", "Start cue playback begins after ${queuedFrames / 24} ms queued audio")
            }
            write(bytes)
            if (running && bytes === recordingCueBytes) Log.i("DroneLiveVoice", "Start cue submitted to Live output")
            queuedBytes.addAndGet(-bytes.size)
          }
        } catch (error: Exception) { if (running) onError(error.message ?: "Live playback failed") }
      }, "LivePcmPlayback").apply { start() }
      // Queue locally before resolving startPcm or opening any remote transport.
      // The JS capture acknowledgement may arrive later and is deduplicated.
      if (recordingCue) playRecordingCue()
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

  @Synchronized private fun enqueue(bytes: ByteArray) {
    if (!running) return
    if (queuedBytes.get() + bytes.size > 240000 || playback.remainingCapacity() == 0) {
      // Catch up to current speech instead of turning a temporary output backlog
      // into a disconnected conversation. Keep the local start cue and any write
      // already in flight; never pause/re-route the headset from the producer.
      var droppedBytes = 0
      for (pending in playback.toTypedArray()) {
        if (pending !== recordingCueBytes && playback.remove(pending)) {
          queuedBytes.addAndGet(-pending.size)
          droppedBytes += pending.size
        }
      }
      Log.i("DroneLiveVoice", "Playback backlog recovered: droppedBytes=$droppedBytes retainedBytes=${queuedBytes.get()}")
      handler.post {
        if (running && recoveryWatchdog == null) {
          val progress = playbackProgress.get()
          val watchdog = Runnable {
            recoveryWatchdog = null
            if (running && queuedBytes.get() > 0 && playbackProgress.get() == progress) {
              // Let the mobile connection's reconnect path rebuild a stuck output.
              onError("Live audio output stalled during playback recovery.")
            }
          }
          recoveryWatchdog = watchdog
          handler.postDelayed(watchdog, 5000)
        }
      }
    }
    // A large write can itself still be in flight. Discard this chunk too if it
    // cannot fit; preserve the memory bound even when the device stops consuming.
    if (queuedBytes.get() + bytes.size > 240000) return
    queuedBytes.addAndGet(bytes.size)
    if (!playback.offer(bytes)) queuedBytes.addAndGet(-bytes.size)
  }
  // Stop capture and discard assistant speech immediately, retaining only the
  // already-routed output for the local acknowledgement. No second tone player.
  fun stop(keepOutputForCue: Boolean = false) {
    val retainOutput = keepOutputForCue && running && playbackReady &&
      (!headsetRouted || isHeadset(player?.routedDevice))
    running = false
    recoveryWatchdog?.let { handler.removeCallbacks(it) }
    recoveryWatchdog = null
    muted = true
    // AudioRecord.stop can block. Silence queued output before waiting for the microphone.
    try { player?.setVolume(0f); player?.pause(); player?.flush() } catch (_: Exception) {}
    if (!retainOutput) finishStoppedCue()
    handler.removeCallbacks(routeTimeout)
    handler.removeCallbacks(checkReady)
    completeReady(false)
    try { recorder?.stop() } catch (_: Exception) {}
    captureThread?.join(1000)
    playbackThread?.join(1000)
    recorder?.release(); recorder = null
    echo?.release(); echo = null
    noise?.release(); noise = null
    playback.clear(); queuedBytes.set(0)
    if (retainOutput) {
      stoppedOutput = true
      // Bound retention even if JS never requests the acknowledgement.
      handler.postDelayed(stoppedCueTimeout, 1500)
    }
  }

  fun playStoppedCue(complete: () -> Unit) {
    val output = player
    if (!stoppedOutput || output == null) { complete(); return }
    stoppedCueCallbacks.add(complete)
    if (stoppedCuePlaying) return
    stoppedCuePlaying = true
    val bytes = stoppedCuePcm()
    try {
      // A paused track reports no routed device. Restart silently and verify
      // its route again before writing the cue; never infer it from audio mode.
      stoppedCueRouteReady = !headsetRouted
      output.setVolume(if (stoppedCueRouteReady) 1f else 0f)
      output.play()
      routeListener.onRoutingChanged(output)
      if (!stoppedCuePlaying) return
      playbackThread = Thread({
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        try {
          var writtenFrames = 0
          val silence = ByteArray(4800)
          while (stoppedCuePlaying && !stoppedCueRouteReady) {
            val count = output.write(silence, 0, silence.size)
            check(count > 0) { "Could not prime the stopped cue route" }
            writtenFrames += count / 2
            Thread.sleep(5)
          }
          var offset = 0
          if (stoppedCuePlaying) Log.i("DroneLiveVoice", "Stopped cue begins on retained Live output")
          while (stoppedCuePlaying && offset < bytes.size) {
            val count = output.write(bytes, offset, bytes.size - offset)
            check(count > 0) { "Could not play the stopped cue" }
            offset += count
            writtenFrames += count / 2
          }
          handler.post {
            if (stoppedCuePlaying) {
              stoppedCueFrames = writtenFrames
              checkStoppedCue.run()
            }
          }
        } catch (_: Exception) { handler.post { finishStoppedCue() } }
      }, "LiveStoppedCue").apply { start() }
    } catch (_: Exception) { finishStoppedCue() }
  }

  private fun finishStoppedCue() {
    stoppedCuePlaying = false; stoppedOutput = false
    handler.removeCallbacks(stoppedCueTimeout); handler.removeCallbacks(checkStoppedCue)
    val output = player; player = null
    try { output?.setVolume(0f); output?.pause(); output?.flush() } catch (_: Exception) {}
    output?.removeOnRoutingChangedListener(routeListener)
    // Pausing unblocks a streaming write before releasing its track.
    if (playbackThread !== Thread.currentThread()) playbackThread?.join(1000)
    output?.release()
    val callbacks = stoppedCueCallbacks.toList(); stoppedCueCallbacks.clear()
    callbacks.forEach { it() }
  }

  private fun isHeadset(device: AudioDeviceInfo?) = when (device?.type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID -> true
    else -> false
  }
}
