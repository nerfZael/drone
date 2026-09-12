package android.os
object Process {
  const val THREAD_PRIORITY_AUDIO = -16
  fun setThreadPriority(priority: Int) {}
}

class Looper { companion object { fun getMainLooper() = Looper() } }
class Handler(looper: Looper)
