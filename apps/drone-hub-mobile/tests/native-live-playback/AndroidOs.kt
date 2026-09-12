package android.os
object Process {
  const val THREAD_PRIORITY_AUDIO = -16
  fun setThreadPriority(priority: Int) {}
}

class Looper { companion object { fun getMainLooper() = Looper() } }
object SystemClock {
  var now = 0L
  fun elapsedRealtime() = now
}
class Handler(looper: Looper) {
  fun post(runnable: Runnable): Boolean { runnable.run(); return true }
  fun postDelayed(runnable: Runnable, delay: Long): Boolean { pending.add(runnable); due[runnable] = SystemClock.now + delay; return true }
  fun removeCallbacks(runnable: Runnable) { pending.removeAll { it === runnable }; due.remove(runnable) }
  companion object {
    val pending = mutableListOf<Runnable>()
    private val due = mutableMapOf<Runnable, Long>()
    fun runDelayed() { val work = pending.toList(); pending.clear(); due.clear(); work.forEach { it.run() } }
    fun advanceTimeBy(ms: Long) {
      val target = SystemClock.now + ms
      while (true) {
        val next = due.minByOrNull { it.value } ?: break
        if (next.value > target) break
        SystemClock.now = next.value
        pending.remove(next.key); due.remove(next.key)
        next.key.run()
      }
      SystemClock.now = target
    }
  }
}
object Build { object VERSION { const val SDK_INT = 36 } }
