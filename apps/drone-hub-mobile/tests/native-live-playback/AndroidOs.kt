package android.os
object Process {
  const val THREAD_PRIORITY_AUDIO = -16
  fun setThreadPriority(priority: Int) {}
}

class Looper { companion object { fun getMainLooper() = Looper() } }
class Handler(looper: Looper) {
  fun post(runnable: Runnable): Boolean { runnable.run(); return true }
  fun postDelayed(runnable: Runnable, delay: Long): Boolean { pending.add(runnable); return true }
  fun removeCallbacks(runnable: Runnable) { pending.remove(runnable) }
  companion object {
    val pending = mutableListOf<Runnable>()
    fun runDelayed() { val work = pending.toList(); pending.clear(); work.forEach { it.run() } }
  }
}
object Build { object VERSION { const val SDK_INT = 36 } }
