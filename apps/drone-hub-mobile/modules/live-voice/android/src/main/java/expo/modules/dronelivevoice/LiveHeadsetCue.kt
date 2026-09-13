package expo.modules.dronelivevoice

import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRouting
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import kotlin.math.sin

/** Output-only acknowledgement after a headset hangs up its call audio. */
internal class LiveHeadsetCue(private val manager: AudioManager, private val address: String, private val complete: () -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private var output: AudioTrack? = null
  private var worker: Thread? = null
  @Volatile private var closed = false
  @Volatile private var ready = false
  private var readyAt: Long? = null
  private var writtenFrames = 0
  private val timeout = Runnable { close() }
  private val findDevice = object : Runnable {
    override fun run() {
      if (closed) return
      val device = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { matches(it) }
      if (manager.mode != AudioManager.MODE_NORMAL || device == null) {
        handler.postDelayed(this, 25)
      } else openOutput(device)
    }
  }
  private fun matches(actual: AudioDeviceInfo?) = actual?.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP &&
    actual.address == address
  private val checkReady = object : Runnable {
    override fun run() {
      if (closed || ready) return
      if (!matches(output?.routedDevice)) { close(); return }
      if (SystemClock.elapsedRealtime() < (readyAt ?: return)) {
        handler.postDelayed(this, 25)
        return
      }
      output?.setVolume(1f)
      ready = true
    }
  }
  private val routing = AudioRouting.OnRoutingChangedListener { track ->
    if (!closed) {
      if (matches(track.routedDevice)) {
        if (readyAt == null) {
          // AudioService applies media volume after leaving call mode. Prime
          // silently through that transition before submitting the short cue.
          readyAt = SystemClock.elapsedRealtime() + 750
          checkReady.run()
        }
      } else if (readyAt != null) close()
    }
  }
  private val checkFinished = object : Runnable {
    override fun run() {
      if (closed) return
      if ((output?.playbackHeadPosition ?: 0) >= writtenFrames) close()
      else handler.postDelayed(this, 10)
    }
  }

  fun start() {
    if (closed) return
    handler.postDelayed(timeout, 3000)
    findDevice.run()
  }

  private fun openOutput(device: AudioDeviceInfo) {
    try {
      val track = AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setAudioFormat(AudioFormat.Builder().setSampleRate(24000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(maxOf(4800, AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)))
        .setTransferMode(AudioTrack.MODE_STREAM).build()
      output = track
      check(track.state == AudioTrack.STATE_INITIALIZED && track.setPreferredDevice(device))
      track.setVolume(0f)
      track.addOnRoutingChangedListener(routing, handler)
      track.play()
      routing.onRoutingChanged(track)
      worker = Thread({
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        try {
          var frames = 0
          fun write(bytes: ByteArray) {
            var offset = 0
            while (!closed && offset < bytes.size) {
              val count = track.write(bytes, offset, bytes.size - offset)
              check(count > 0)
              offset += count; frames += count / 2
            }
          }
          val silence = ByteArray(4800)
          while (!closed && !ready) { write(silence); Thread.sleep(5) }
          if (!closed) {
            Log.i("DroneLiveVoice", "Stopped cue begins on headset media output after call hangup")
            write(stoppedCuePcm())
            handler.post { if (!closed) { writtenFrames = frames; checkFinished.run() } }
          }
        } catch (_: Exception) { handler.post { close() } }
      }, "LiveHeadsetStoppedCue").apply { start() }
    } catch (_: Exception) { close() }
  }

  fun close() {
    if (closed) return
    closed = true
    handler.removeCallbacks(findDevice)
    handler.removeCallbacks(timeout); handler.removeCallbacks(checkReady); handler.removeCallbacks(checkFinished)
    val track = output; output = null
    try { track?.setVolume(0f); track?.pause(); track?.flush() } catch (_: Exception) {}
    track?.removeOnRoutingChangedListener(routing)
    if (worker !== Thread.currentThread()) worker?.join(1000)
    track?.release()
    complete()
  }
}

internal fun stoppedCuePcm(): ByteArray {
  // A descending 300 ms cue, about 3 dB louder than the start cue with the same smooth fades.
  val bytes = ByteArray(14400)
  for (frame in 0 until 7200) {
    val ramp = minOf(1.0, frame / 600.0, (7199 - frame) / 600.0)
    val envelope = sin(Math.PI * ramp / 2).let { it * it }
    val phase = 2 * Math.PI * (750.0 * frame / 24000 - 150.0 * frame * frame / (24000.0 * 7200))
    val value = (sin(phase) * 5000 * envelope).toInt()
    bytes[frame * 2] = value.toByte(); bytes[frame * 2 + 1] = (value shr 8).toByte()
  }
  return bytes
}
