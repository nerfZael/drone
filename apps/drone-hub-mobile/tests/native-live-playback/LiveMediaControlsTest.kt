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

fun main() {
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
