package android.view
class KeyEvent(val action: Int, val keyCode: Int, val repeatCount: Int = 0) {
  companion object {
    const val ACTION_DOWN = 0; const val ACTION_UP = 1
    const val KEYCODE_MEDIA_PLAY_PAUSE = 85; const val KEYCODE_HEADSETHOOK = 79
    const val KEYCODE_MEDIA_PLAY = 126; const val KEYCODE_MEDIA_PAUSE = 127; const val KEYCODE_MEDIA_STOP = 86
  }
}
