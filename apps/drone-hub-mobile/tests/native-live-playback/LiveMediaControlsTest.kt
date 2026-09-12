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

fun main() {
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
  controls.playCue("stopped", stopCue)
  check(stopCue.resolved && ToneGenerator.played == 0)
  controls.update("recording") // A JS capturing callback queued before the hang-up cannot resurrect playback state.
  check(!controls.isPlaying())
  key(KeyEvent.KEYCODE_MEDIA_PLAY)
  key(KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.ACTION_UP)
  key(KeyEvent.KEYCODE_MEDIA_PLAY, repeats = 1)
  check(actions == listOf("pause", "play") && controls.isPlaying())

  audio = LivePcmAudio({}, { error(it) }, awaitHeadset = true)
  audio.start()
  track = AudioTrack.latest
  val startCue = Promise()
  audio.whenPlaybackReady { ready ->
    if (ready && controls.isPlaying()) controls.playCue("recording", startCue) else startCue.resolve()
  }
  track.route(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
  check(!startCue.resolved && ToneGenerator.played == 0)
  track.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  check(ToneGenerator.played == 1)
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
  println("Native media controls: early SCO/BLE disconnect, paused-before-cleanup, single-press resume, delayed cue, stale JS update, duplicate/up/repeat keys and listener cleanup passed")
}
