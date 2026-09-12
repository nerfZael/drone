package android.media.session
import android.content.*
import android.media.MediaMetadata
import android.os.Handler
class MediaSession(context: Context, name: String) {
  var isActive = false
  var callback: Callback? = null
  var state: PlaybackState? = null
  fun setFlags(flags: Int) {}
  fun setMetadata(metadata: MediaMetadata) {}
  fun setCallback(value: Callback, handler: Handler) { callback = value }
  fun setPlaybackState(value: PlaybackState) { state = value }
  fun release() {}
  open class Callback {
    open fun onPlay() {}; open fun onPause() {}; open fun onStop() {}
    open fun onMediaButtonEvent(intent: Intent) = false
  }
  companion object { const val FLAG_HANDLES_MEDIA_BUTTONS = 1; const val FLAG_HANDLES_TRANSPORT_CONTROLS = 2 }
}
class PlaybackState(val state: Int) {
  class Builder {
    var state = 0
    fun setActions(actions: Long) = this
    fun setState(value: Int, position: Long, speed: Float) = apply { state = value }
    fun build() = PlaybackState(state)
  }
  companion object {
    const val ACTION_PLAY = 4L; const val ACTION_PAUSE = 2L; const val ACTION_PLAY_PAUSE = 512L; const val ACTION_STOP = 1L
    const val STATE_PLAYING = 3; const val STATE_PAUSED = 2; const val PLAYBACK_POSITION_UNKNOWN = -1L
  }
}
