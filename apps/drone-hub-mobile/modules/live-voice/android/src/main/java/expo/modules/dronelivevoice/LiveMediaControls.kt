package expo.modules.dronelivevoice

import android.content.Context
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
import android.view.KeyEvent
import expo.modules.kotlin.Promise

/** Owned by the foreground service, including while the GPT-Live session is closed. */
internal class LiveMediaControls(context: Context, val id: String, private val emit: (String) -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private var playing = true
  private var closed = false
  private var cue: ToneGenerator? = null
  private val audioManager = context.getSystemService(AudioManager::class.java)
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
          KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> if (playing) "pause" else "play"
          KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
          KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
          KeyEvent.KEYCODE_MEDIA_STOP -> "stop"
          else -> return false
        }
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) command(action)
        return true
      }
    }, handler)
    session.isActive = true
    try { update("connecting") } catch (error: Exception) { close(); throw error }
  }

  fun command(action: String) {
    if (closed || action == "play" && playing || action == "pause" && !playing) return
    if (action != "play") LiveVoiceSession.stopAudio?.invoke()
    try { update(if (action == "play") "connecting" else "paused") }
    catch (_: Exception) { update("paused"); emit("stop"); return }
    emit(action)
  }

  fun update(state: String) {
    if (closed) return
    playing = state != "paused"
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
    session.setPlaybackState(PlaybackState.Builder()
      .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP)
      .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (playing) 1f else 0f)
      .build())
    LiveVoiceSession.refreshNotification?.invoke()
  }

  fun isPlaying() = playing

  fun playCue(kind: String, promise: Promise) {
    if (closed) { promise.resolve(); return }
    try {
      cue?.release()
      // During a Live session expo-audio puts the device in communication mode and, with a
      // Bluetooth headset, routes through SCO. The voice-call stream follows that route, so the
      // cue reaches the headset instead of racing the route switch on the music stream.
      val stream = if (audioManager?.mode == AudioManager.MODE_IN_COMMUNICATION) AudioManager.STREAM_VOICE_CALL else AudioManager.STREAM_MUSIC
      val tone = ToneGenerator(stream, 65)
      cue = tone
      tone.startTone(if (kind == "recording") ToneGenerator.TONE_PROP_ACK else ToneGenerator.TONE_PROP_NACK, 180)
      handler.postDelayed({
        if (cue === tone) { tone.release(); cue = null }
        promise.resolve()
      }, 200)
    } catch (error: Exception) { promise.reject("LIVE_CUE", error.message, error) }
  }

  fun close() {
    if (closed) return
    closed = true
    cue?.release(); cue = null
    releaseFocus()
    session.isActive = false; session.release()
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
