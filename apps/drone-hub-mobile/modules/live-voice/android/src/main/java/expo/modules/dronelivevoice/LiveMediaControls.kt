package expo.modules.dronelivevoice

import android.content.Context
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import androidx.core.content.ContextCompat
import android.content.Intent
import android.media.AudioManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.MediaMetadata
import android.media.ToneGenerator
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.os.SystemClock
import android.view.KeyEvent
import expo.modules.kotlin.Promise

/** Owned by the foreground service, including while the GPT-Live session is closed. */
internal class LiveMediaControls(private val context: Context, val id: String, private val emit: (String) -> Unit, initialState: String = "connecting", private val onTick: (() -> Unit)? = null) {
  private val handler = Handler(Looper.getMainLooper())
  // Handler deadlines do not depend on display frames (unlike RN's Choreographer timers).
  private val tick = object : Runnable {
    override fun run() {
      if (closed) return
      onTick?.invoke()
      handler.postDelayed(this, 250)
    }
  }
  private var playing = true
  private var closed = false
  private var skipStoppedCue = false
  private var cue: ToneGenerator? = null
  private var receiverRegistered = false
  private var scoConnected = false
  private var communicationHeadsetConnected = false
  private var communicationListener: AudioManager.OnCommunicationDeviceChangedListener? = null
  private val routeReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (closed) return
      when (intent.action) {
        AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED -> {
          val connected = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) == AudioManager.SCO_AUDIO_STATE_CONNECTED
          val disconnected = scoConnected && !connected
          scoConnected = connected
          if (disconnected) pauseForHeadsetDisconnect()
        }
        AudioManager.ACTION_AUDIO_BECOMING_NOISY -> pauseForHeadsetDisconnect()
      }
    }
  }
  private val audioManager = context.getSystemService(AudioManager::class.java)
  private var voiceModeSince: Long? = if (audioManager.mode == AudioManager.MODE_IN_COMMUNICATION) SystemClock.elapsedRealtime() else null
  private var modeListener: AudioManager.OnModeChangedListener? = null
  private var focused = false
  private var focusRequest: AudioFocusRequest? = null
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change < 0) command("pause")
  }
  val session = MediaSession(context, "DroneCompanionLive")

  init {
    session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
    session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "Live Companion").build())
    session.setCallback(object : MediaSession.Callback() {
      override fun onPlay() { command("play") }
      override fun onPause() { command("pause") }
      override fun onStop() { command("stop") }
      override fun onMediaButtonEvent(intent: Intent): Boolean {
        @Suppress("DEPRECATION")
        val event = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return false
        val action = when (event.keyCode) {
          // Headsets may emit PLAY while active, or PAUSE after we have stopped,
          // while their cached state catches up. Each physical press is a toggle;
          // explicit onPlay/onPause transport commands remain idempotent.
          KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
          KeyEvent.KEYCODE_HEADSETHOOK -> if (playing) "pause" else "play"
          KeyEvent.KEYCODE_MEDIA_STOP -> "stop"
          else -> return false
        }
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) command(action)
        return true
      }
    }, handler)
    session.isActive = true
    try {
      // SCO state arrives before AudioTrack's fallback-to-speaker routing callback.
      val filter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED).apply {
        addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
      }
      ContextCompat.registerReceiver(context, routeReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
      receiverRegistered = true
      if (Build.VERSION.SDK_INT >= 31) {
        val mode = AudioManager.OnModeChangedListener { value ->
          if (!closed) voiceModeSince = if (value == AudioManager.MODE_IN_COMMUNICATION) SystemClock.elapsedRealtime() else null
        }
        modeListener = mode
        audioManager.addOnModeChangedListener({ runnable -> handler.post(runnable); Unit }, mode)
        val listener = AudioManager.OnCommunicationDeviceChangedListener { device ->
          if (!closed) {
            val headset = isHeadset(device)
            val disconnected = communicationHeadsetConnected && !headset
            communicationHeadsetConnected = headset
            if (disconnected) pauseForHeadsetDisconnect()
          }
        }
        communicationListener = listener
        communicationHeadsetConnected = isHeadset(audioManager.communicationDevice)
        audioManager.addOnCommunicationDeviceChangedListener({ runnable -> handler.post(runnable); Unit }, listener)
      }
      update(initialState)
      if (onTick != null) handler.postDelayed(tick, 250)
    } catch (error: Exception) { close(); throw error }
  }

  fun command(action: String) {
    if (closed || action == "play" && playing || action == "pause" && !playing) return
    if (action != "play") {
      // Publish paused before potentially blocking cleanup, so AVRCP sees the next press as play.
      playing = false
      scoConnected = false; communicationHeadsetConnected = false
      publishPlaybackState()
      cue?.release(); cue = null
      LiveVoiceSession.stopAudio?.invoke()
    }
    try { update(if (action == "play") "connecting" else "paused") }
    catch (_: Exception) { update("paused"); emit("stop"); return }
    emit(action)
  }

  fun update(state: String) {
    if (closed || state == "recording" && !playing) return
    playing = state != "paused"
    if (!playing) {
      scoConnected = false; communicationHeadsetConnected = false
      cue?.release(); cue = null
    }
    if (playing && !focused) {
      val result = if (Build.VERSION.SDK_INT >= 26) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener(focusListener, handler).build()
        focusRequest = request
        audioManager.requestAudioFocus(request)
      } else {
        @Suppress("DEPRECATION")
        audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
      }
      check(result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "Another app is using audio. Try Live again." }
      focused = true
    } else if (!playing) releaseFocus()
    publishPlaybackState()
    LiveVoiceSession.refreshNotification?.invoke()
  }

  private fun publishPlaybackState() {
    session.setPlaybackState(PlaybackState.Builder()
      .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP)
      .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (playing) 1f else 0f)
      .build())
  }

  fun isPlaying() = playing

  fun hasVoiceModeSettled(): Boolean = Build.VERSION.SDK_INT < 31 ||
    voiceModeSince?.let { SystemClock.elapsedRealtime() - it >= 750 } == true

  fun pauseForHeadsetDisconnect() {
    // During a queued resume the previous route can still be disconnecting.
    // It must not cancel the new intent before its microphone has started.
    if (closed || !playing || LiveVoiceSession.stopAudio == null) return
    // The headset may hang up SCO instead of sending a media pause command.
    // Stop capture/playback and keep the MediaSession armed for locked-screen play.
    skipStoppedCue = true
    command("pause")
  }

  fun playStoppedCue(promise: Promise) {
    if (closed) { promise.resolve(); return }
    if (skipStoppedCue) {
      skipStoppedCue = false
      promise.resolve()
      return // Do not emit the stop cue through the phone after losing the headset.
    }
    try {
      cue?.release()
      // During a Live session expo-audio puts the device in communication mode and, with a
      // Bluetooth headset, routes through SCO. The voice-call stream follows that route, so the
      // cue reaches the headset instead of racing the route switch on the music stream.
      val stream = if (audioManager?.mode == AudioManager.MODE_IN_COMMUNICATION) AudioManager.STREAM_VOICE_CALL else AudioManager.STREAM_MUSIC
      val tone = ToneGenerator(stream, 80)
      cue = tone
      val duration = 300
      check(tone.startTone(ToneGenerator.TONE_PROP_NACK, duration)) {
        "Could not play the Live microphone cue"
      }
      handler.postDelayed({
        if (cue === tone) { tone.release(); cue = null }
        promise.resolve()
      }, (duration + 50).toLong())
    } catch (error: Exception) { promise.reject("LIVE_CUE", error.message, error) }
  }

  fun close() {
    if (closed) return
    closed = true
    handler.removeCallbacks(tick)
    if (receiverRegistered) { context.unregisterReceiver(routeReceiver); receiverRegistered = false }
    if (Build.VERSION.SDK_INT >= 31) communicationListener?.let { audioManager.removeOnCommunicationDeviceChangedListener(it) }
    if (Build.VERSION.SDK_INT >= 31) modeListener?.let { audioManager.removeOnModeChangedListener(it) }
    modeListener = null
    communicationListener = null
    cue?.release(); cue = null
    releaseFocus()
    session.isActive = false; session.release()
  }

  private fun isHeadset(device: AudioDeviceInfo?) = when (device?.type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_HEARING_AID -> true
    else -> false
  }

  private fun releaseFocus() {
    if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(focusListener)
    }
    focusRequest = null; focused = false
  }
}
