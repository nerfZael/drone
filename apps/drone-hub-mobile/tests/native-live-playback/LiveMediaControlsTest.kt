package expo.modules.dronelivevoice

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioTrack
import android.media.ToneGenerator
import android.media.session.PlaybackState
import android.os.Handler
import android.view.KeyEvent
import expo.modules.kotlin.Promise

internal object LiveVoiceSession {
  var stopAudio: (() -> Unit)? = null
  var refreshNotification: (() -> Unit)? = null
}

private fun playOnlyHeadsetButton() {
  val actions = mutableListOf<String>()
  val controls = LiveMediaControls(Context(), "play-only-headset", actions::add)
  val audio = LivePcmAudio({}, { error(it) })
  audio.start()
  val track = AudioTrack.latest
  track.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  LiveVoiceSession.stopAudio = { audio.stop() }
  fun press(action: Int = KeyEvent.ACTION_DOWN, repeat: Int = 0) {
    check(controls.session.callback!!.onMediaButtonEvent(Intent(extras = mapOf(
      Intent.EXTRA_KEY_EVENT to KeyEvent(action, KeyEvent.KEYCODE_MEDIA_PLAY, repeat)))))
  }
  try {
    controls.session.callback!!.onPlay() // Explicit transport Play is still idempotent.
    check(actions.isEmpty())
    press()
    check(actions == listOf("pause") && !controls.isPlaying()) { "A headset sending PLAY while Live is running must pause" }
    check(track.paused && track.released && track.volume == 0f && track.routedDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
    press(KeyEvent.ACTION_UP)
    press(repeat = 1)
    controls.session.callback!!.onPause()
    controls.update("recording") // Late startup acknowledgement cannot undo the physical pause.
    check(actions == listOf("pause") && !controls.isPlaying())
    press(); press(KeyEvent.ACTION_UP)
    check(actions == listOf("pause", "play") && controls.isPlaying())
    controls.session.callback!!.onPlay()
    check(actions == listOf("pause", "play"))
    press(); press(KeyEvent.ACTION_UP)
    check(actions == listOf("pause", "play", "pause") && !controls.isPlaying())
  } finally {
    audio.stop()
    controls.close()
    LiveVoiceSession.stopAudio = null
  }
  println("PLAY-only headset presses toggle active/paused Live once per press and silence audio before headset teardown")
}

private fun stalePauseHeadsetButton() {
  val actions = mutableListOf<String>()
  val controls = LiveMediaControls(Context(), "stale-headset-state", actions::add)
  fun key(code: Int, action: Int = KeyEvent.ACTION_DOWN, repeat: Int = 0) {
    check(controls.session.callback!!.onMediaButtonEvent(Intent(extras = mapOf(
      Intent.EXTRA_KEY_EVENT to KeyEvent(action, code, repeat)))))
  }
  try {
    key(KeyEvent.KEYCODE_MEDIA_PLAY)
    key(KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.ACTION_UP)
    check(actions == listOf("pause"))
    controls.session.callback!!.onPause() // Explicit transport pause remains idempotent.
    key(KeyEvent.KEYCODE_MEDIA_PAUSE) // Headset has not yet observed our paused state.
    check(actions == listOf("pause", "play") && controls.isPlaying()) {
      "A physical Pause press while paused must resume immediately"
    }
    // The old route may hang up after this resume was accepted, before the new
    // microphone starts. This is cleanup, not a second stop request.
    controls.pauseForHeadsetDisconnect()
    check(actions == listOf("pause", "play") && controls.isPlaying())
    key(KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.ACTION_UP)
    key(KeyEvent.KEYCODE_MEDIA_PAUSE, repeat = 1)
    controls.session.callback!!.onPlay()
    check(actions == listOf("pause", "play"))
    key(KeyEvent.KEYCODE_MEDIA_PAUSE)
    check(actions == listOf("pause", "play", "pause") && !controls.isPlaying())
  } finally { controls.close() }
  println("Physical Play/Pause keys toggle despite stale headset state; explicit transports and key releases/repeats stay idempotent")
}

private fun standbyDoesNotTakeAudioFocus() {
  val context = Context()
  val manager = context.getSystemService(AudioManager::class.java)
  val actions = mutableListOf<String>()
  val controls = LiveMediaControls(context, "standby", actions::add, initialState = "paused")
  try {
    check(!controls.isPlaying() && controls.session.isActive)
    check(manager.focusRequests == 0) { "Enabling the shortcut must not interrupt another media app" }
    check(LiveVoiceSession.stopAudio == null)
    controls.session.callback!!.onMediaButtonEvent(Intent(extras = mapOf(
      Intent.EXTRA_KEY_EVENT to KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))))
    check(actions == listOf("play") && controls.isPlaying())
    check(manager.focusRequests == 1)
    controls.session.callback!!.onPause()
    check(actions == listOf("play", "pause"))
  } finally { controls.close() }
  println("Standby headset shortcut receives Play without requesting audio focus or starting capture until pressed")
}

private fun controlClockRunsWhilePausedAndStopsOnClose() {
  var ticks = 0
  val controls = LiveMediaControls(Context(), "clock", {}, initialState = "paused", onTick = { ticks++ })
  try {
    Handler.advanceTimeBy(1_000)
    check(ticks == 4 && !controls.isPlaying())
    controls.command("play")
    Handler.advanceTimeBy(500)
    check(ticks == 6)
    controls.close()
    Handler.advanceTimeBy(1_000)
    check(ticks == 6) { "Closed controls must stop their native clock" }
  } finally { controls.close() }
  println("Handler control clock runs without display frames, including standby, and cancels on close")
}


private fun stoppedCueKeepsHeadsetOutput() {
  for (ending in listOf("rendered", "track-lost", "sco-lost", "timeout", "resume", "close")) {
    val context = Context()
    val controls = LiveMediaControls(context, "stop-cue", {})
    check(controls.session.playbackAttributes?.usage == android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION) {
      "Headset volume must control the voice stream used by PCM"
    }
    val captured = java.util.concurrent.atomic.AtomicInteger()
    val audio = LivePcmAudio({ captured.incrementAndGet() }, { error(it) })
    audio.start()
    val track = AudioTrack.latest
    track.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
    LiveVoiceSession.stopAudio = { controls.stopAudio(audio); LiveVoiceSession.stopAudio = null }
    try {
      controls.command("pause")
      check(track.paused && track.volume == 0f && !track.released)
      val captureCount = captured.get()
      controls.update("paused") // JS acknowledgement must retain the cue's player.
      if (ending == "rendered") track.routedDevice = null // Android does this while paused.
      val cue = Promise()
      controls.playStoppedCue(cue)
      if (ending == "rendered") {
        Thread.sleep(20)
        check(!cue.resolved && track.volume == 0f)
        check(track.snapshot().all { span -> span.bytes.all { it == 0.toByte() } })
        track.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
      }
      val deadline = System.nanoTime() + 2_000_000_000L
      while (track.snapshot().filter { span -> span.bytes.any { it != 0.toByte() } }.sumOf { it.bytes.size } < 14400) {
        check(System.nanoTime() < deadline) { "Stop cue did not reach the existing track" }
        Thread.sleep(1)
      }
      check(AudioTrack.latest === track && ToneGenerator.played == 0)
      check(!cue.resolved && !track.released && track.volume == 1f)
      val duplicate = Promise()
      controls.playStoppedCue(duplicate)
      check(!duplicate.resolved) { "Duplicate requests must also await the cue before releasing its route" }
      check(captured.get() == captureCount) { "Stop cue must never keep the microphone running" }
      when (ending) {
        "track-lost" -> track.route(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        "sco-lost" -> controls.pauseForHeadsetDisconnect()
        "timeout" -> Handler.advanceTimeBy(1500)
        "resume" -> controls.command("play")
        "close" -> controls.close()
        else -> { track.nowFrames = track.snapshot().last().end; Handler.advanceTimeBy(20) }
      }
      check(duplicate.resolved)
      check(cue.resolved && track.released && track.volume == 0f)
      check(track.routeListener == null)
    } finally { controls.close(); audio.stop(); LiveVoiceSession.stopAudio = null }
  }
  // Cancel before startup has reached the headset: no phone fallback cue.
  val controls = LiveMediaControls(Context(), "cancel-cue", {})
  val audio = LivePcmAudio({}, { error(it) }, awaitHeadset = true)
  audio.start()
  val track = AudioTrack.latest
  controls.stopAudio(audio)
  val cue = Promise()
  controls.playStoppedCue(cue)
  check(cue.resolved && track.released && ToneGenerator.played == 0)
  controls.close()
  println("Stop cue reuses routed PCM after capture stops, waits for rendering, and cancels silently on route loss/startup cancellation")
}

private fun hangupCueUsesHeadsetMediaAfterRouteRelease() {
  for (ending in listOf("rendered", "resume", "close", "lost", "timeout", "absent", "different", "late")) {
    val context = Context()
    val controls = LiveMediaControls(context, "hangup-cue", {})
    controls.rememberBluetoothHeadset(AudioDeviceInfo(AudioDeviceInfo.TYPE_BLUETOOTH_SCO))
    context.audioManager.outputs = when (ending) {
      "absent", "late" -> emptyArray()
      "different" -> arrayOf(AudioDeviceInfo(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, "other-headset"))
      else -> arrayOf(AudioDeviceInfo(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP))
    }
    val captures = java.util.concurrent.atomic.AtomicInteger()
    val audio = LivePcmAudio({ captures.incrementAndGet() }, { error(it) })
    audio.start()
    val voice = AudioTrack.latest
    voice.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
    LiveVoiceSession.stopAudio = { controls.stopAudio(audio); LiveVoiceSession.stopAudio = null }
    try {
      controls.pauseForHeadsetDisconnect() // Physical headset hangup, not a media Pause key.
      val stopped = Promise()
      controls.playStoppedCue(stopped)
      check(stopped.resolved && voice.released && voice.volume == 0f)
      check(AudioTrack.latest === voice) { "Do not open media audio before call-route teardown" }
      val count = captures.get()
      context.audioManager.mode = AudioManager.MODE_NORMAL
      val released = Promise()
      controls.playReleasedStoppedCue(released)
      if (ending == "absent" || ending == "different") {
        Handler.advanceTimeBy(3000)
        check(released.resolved && AudioTrack.latest === voice)
        continue
      }
      if (ending == "late") {
        Handler.advanceTimeBy(250)
        check(!released.resolved && AudioTrack.latest === voice)
        context.audioManager.outputs = arrayOf(AudioDeviceInfo(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP))
        Handler.advanceTimeBy(25)
      }
      val media = AudioTrack.latest
      check(media !== voice && media.attributes?.usage == android.media.AudioAttributes.USAGE_MEDIA)
      check(media.preferredDevice?.address == "headset")
      media.route(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) // A2DP is still recovering from the call.
      Thread.sleep(20)
      check(media.volume == 0f && !released.resolved)
      check(media.snapshot().all { span -> span.bytes.all { it == 0.toByte() } })
      media.route(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
      Handler.advanceTimeBy(750)
      val deadline = System.nanoTime() + 2_000_000_000L
      while (media.snapshot().none { span -> span.bytes.any { it != 0.toByte() } }) {
        check(System.nanoTime() < deadline); Thread.sleep(1)
      }
      check(captures.get() == count) { "Post-hangup cue must not reopen capture" }
      check(!released.resolved && media.volume == 1f)
      when (ending) {
        "resume" -> controls.command("play")
        "close" -> controls.close()
        "lost" -> media.route(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        "timeout" -> Handler.advanceTimeBy(3000)
        else -> {
          media.nowFrames = media.snapshot().last().end
          // Let the writer hand completion back to the main queue, then advance
          // the render check. This must finish well before the 3-second timeout.
          repeat(10) { if (!released.resolved) { Thread.sleep(2); Handler.advanceTimeBy(10) } }
        }
      }
      check(released.resolved && media.released && media.volume == 0f) { "Ending $ending: promise=${released.resolved}, released=${media.released}, volume=${media.volume}" }
    } finally { controls.close(); audio.stop(); LiveVoiceSession.stopAudio = null }
  }
  check(Handler.pending.isEmpty())
  println("Physical call hangup plays the stop cue only on the same headset's media route after teardown; no microphone, speaker fallback, or stale resume cue")
}

private fun normalRecordingGestures() {
  val context = Context()
  val actions = mutableListOf<String>()
  val controls = LiveMediaControls(context, "normal", actions::add, initialState = "normal-idle")
  fun key(action: Int, held: Long = 0, repeat: Int = 0, cancelled: Boolean = false, down: Long = 100) {
    controls.session.callback!!.onMediaButtonEvent(Intent(extras = mapOf(
      Intent.EXTRA_KEY_EVENT to KeyEvent(action, KeyEvent.KEYCODE_HEADSETHOOK, repeat, down, down + held, cancelled))))
  }
  try {
    check(!controls.isPlaying() && context.audioManager.focusRequests == 0)
    for ((duration, expected) in listOf(0L to "recording-tap", 299L to "recording-tap",
        300L to "recording-hold", 799L to "recording-hold", 800L to "recording-cancel",
        1299L to "recording-cancel", 1300L to "recording-reset", 5000L to "recording-reset")) {
      actions.clear()
      key(KeyEvent.ACTION_DOWN)
      key(KeyEvent.ACTION_DOWN, duration, repeat = 1)
      check(actions.isEmpty()) { "A hold must not execute intermediate actions before release" }
      key(KeyEvent.ACTION_UP, duration)
      key(KeyEvent.ACTION_UP, duration)
      check(actions == listOf(expected)) { "$duration ms: $actions" }
    }
    actions.clear()
    key(KeyEvent.ACTION_DOWN); key(KeyEvent.ACTION_UP, 2000, cancelled = true)
    key(KeyEvent.ACTION_DOWN); key(KeyEvent.ACTION_UP, 2000, down = 200)
    check(actions.isEmpty())
    // A missing release must not swallow every future physical press.
    key(KeyEvent.ACTION_DOWN, down = 100)
    key(KeyEvent.ACTION_DOWN, down = 300)
    key(KeyEvent.ACTION_UP, held = 100, down = 300)
    check(actions == listOf("recording-tap"))
    actions.clear()
    controls.update("normal-paused")
    controls.session.callback!!.onPlay()
    check(actions == listOf("recording-resume")) { "System Play must resume, not send a paused recording" }
    actions.clear()
    controls.update("normal-recording")
    check(controls.isPlaying() && context.audioManager.focusRequests == 0)
    key(KeyEvent.ACTION_DOWN)
    controls.update("normal-paused") // State acknowledgements within Normal do not lose the hold.
    key(KeyEvent.ACTION_UP, 400)
    check(actions == listOf("recording-hold"))
    controls.update("normal-recording")
    val oldAudio = LivePcmAudio({}, { error(it) })
    oldAudio.start()
    val oldTrack = AudioTrack.latest
    oldTrack.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
    controls.stopAudio(oldAudio)
    controls.pauseForHeadsetDisconnect()
    check(oldTrack.released) { "A pending Live stop cue must also be silenced in Normal mode" }
    check(actions.last() == "recording-pause")
    controls.update("normal-idle")
    controls.command("toggle")
    check(actions.last() == "recording-tap")
    actions.clear()
    key(KeyEvent.ACTION_DOWN)
    controls.update("connecting") // Switching modes invalidates a pending recording gesture.
    key(KeyEvent.ACTION_UP, 2000)
    check(actions.isEmpty())
    controls.update("normal-idle")
    key(KeyEvent.ACTION_DOWN)
    controls.close()
    key(KeyEvent.ACTION_UP, 2000)
    check(actions.isEmpty())
  } finally { controls.close() }
  println("Normal headset gestures execute only on release, respect thresholds, ignore repeats/cancelled/stale events, and preserve Live mode")
}

fun main() {
  normalRecordingGestures()
  hangupCueUsesHeadsetMediaAfterRouteRelease()
  stoppedCueKeepsHeadsetOutput()
  controlClockRunsWhilePausedAndStopsOnClose()
  standbyDoesNotTakeAudioFocus()
  stalePauseHeadsetButton()
  val context = Context()
  val actions = mutableListOf<String>()
  val controls = LiveMediaControls(context, "test", actions::add)
  var audio = LivePcmAudio({}, { error(it) })
  audio.start()
  var track = AudioTrack.latest
  track.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  LiveVoiceSession.stopAudio = {
    check(controls.session.state?.state == PlaybackState.STATE_PAUSED)
    audio.stop()
  }
  fun sco(state: Int) {
    context.receiver!!.onReceive(context, Intent(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED,
      mapOf(AudioManager.EXTRA_SCO_AUDIO_STATE to state)))
  }
  fun key(code: Int, action: Int = KeyEvent.ACTION_DOWN, repeats: Int = 0) {
    check(controls.session.callback!!.onMediaButtonEvent(Intent(extras = mapOf(
      Intent.EXTRA_KEY_EVENT to KeyEvent(action, code, repeats)))))
  }
  sco(AudioManager.SCO_AUDIO_STATE_DISCONNECTED) // Sticky idle state during initial setup is harmless.
  check(actions.isEmpty())
  sco(AudioManager.SCO_AUDIO_STATE_CONNECTED)
  sco(AudioManager.SCO_AUDIO_STATE_DISCONNECTED) // No AudioTrack fallback callback or media key yet.
  check(actions == listOf("pause") && !controls.isPlaying())
  check(track.paused && track.volume == 0f && track.routedDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  val stopCue = Promise()
  controls.playStoppedCue(stopCue)
  check(stopCue.resolved && ToneGenerator.played == 0)
  controls.update("recording") // A JS capturing callback queued before the hang-up cannot resurrect playback state.
  check(!controls.isPlaying())
  key(KeyEvent.KEYCODE_MEDIA_PLAY)
  key(KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.ACTION_UP)
  key(KeyEvent.KEYCODE_MEDIA_PLAY, repeats = 1)
  check(actions == listOf("pause", "play") && controls.isPlaying())

  audio = LivePcmAudio({}, { error(it) }, awaitHeadset = true, bluetoothWarmupMs = 0)
  audio.start()
  track = AudioTrack.latest
  val startCue = Promise()
  audio.playRecordingCue { startCue.resolve() }
  track.route(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
  check(!startCue.resolved && ToneGenerator.played == 0)
  track.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  check(ToneGenerator.played == 0) // Start uses the PCM player, without a second tone track.
  Handler.runDelayed()
  check(startCue.resolved)
  // A communication-device callback provides the same early stop for BLE and wired headsets.
  val communicationListener = context.audioManager.listener!!
  communicationListener.onCommunicationDeviceChanged(AudioDeviceInfo(AudioDeviceInfo.TYPE_BLE_HEADSET))
  communicationListener.onCommunicationDeviceChanged(AudioDeviceInfo(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER))
  check(!controls.isPlaying() && track.paused && actions.last() == "pause")
  sco(AudioManager.SCO_AUDIO_STATE_DISCONNECTED) // Duplicate system signals do not toggle back on.
  check(actions == listOf("pause", "play", "pause"))
  key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
  key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.ACTION_UP)
  check(controls.isPlaying() && actions.last() == "play")
  key(KeyEvent.KEYCODE_HEADSETHOOK)
  key(KeyEvent.KEYCODE_HEADSETHOOK, KeyEvent.ACTION_UP)
  check(!controls.isPlaying() && actions.last() == "pause")
  val receiver = context.receiver!!
  controls.close()
  check(context.receiver == null && context.audioManager.listener == null && !controls.session.isActive)
  val count = actions.size
  receiver.onReceive(context, Intent(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
  communicationListener.onCommunicationDeviceChanged(null)
  check(actions.size == count)
  playOnlyHeadsetButton()
  println("Native media controls: early SCO/BLE disconnect, paused-before-cleanup, single-press resume, delayed cue, stale JS update, duplicate/up/repeat keys and listener cleanup passed")
}
