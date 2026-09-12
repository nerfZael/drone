package expo.modules.dronelivevoice

import android.media.AudioTrack
import android.media.AudioDeviceInfo
import java.util.concurrent.CopyOnWriteArrayList

private fun waitUntil(condition: () -> Boolean) {
  val deadline = System.nanoTime() + 2_000_000_000L
  while (!condition()) {
    check(System.nanoTime() < deadline) { "Playback worker timed out" }
    Thread.sleep(1)
  }
}
private fun chunk(marker: Int, frames: Int = 2400) = ByteArray(frames * 2) { marker.toByte() }
private fun encode(bytes: ByteArray) = java.util.Base64.getEncoder().encodeToString(bytes)

fun main() {
  val errors = CopyOnWriteArrayList<String>()
  val audio = LivePcmAudio({}, { errors.add(it) })
  audio.start()
  val track = AudioTrack.latest
  try {
    var arrival = 0L
    for (i in 0 until 40) {
      val delay = when (i) { 5 -> 80; 15 -> 160; 25 -> 240; else -> 0 }
      arrival = maxOf(arrival, (i * 100 + delay).toLong())
      track.nowFrames = arrival * 24
      audio.play(encode(chunk(i + 1)))
      waitUntil { track.snapshot().size == i + 2 } // One reserve plus each PCM chunk.
    }
    val spans = track.snapshot()
    check(spans[0].bytes.size == 12000 && spans[0].bytes.all { it == 0.toByte() })
    for (i in 0 until 40) {
      check(spans[i + 1].start == 6000L + i * 2400) { "Gap before chunk $i" }
      check(spans[i + 1].bytes.contentEquals(chunk(i + 1))) { "Corrupted or reordered PCM" }
    }
    // Long starvation must restore reserve; short tails must not wait for more input.
    track.nowFrames = 6 * 24000L
    audio.play(encode(chunk(42, 240)))
    waitUntil { track.snapshot().size == 43 }
    val resumed = track.snapshot()
    check(resumed[41].bytes.size == 12000)
    check(resumed[42].start == track.nowFrames + 6000)
    check(resumed[42].bytes.contentEquals(chunk(42, 240)))
    // Native partial writes retain all bytes and do not insert padding mid-chunk.
    track.maxWriteBytes = 600
    audio.play(encode(chunk(43)))
    waitUntil { track.snapshot().size == 51 }
    val partial = track.snapshot().drop(43)
    check(partial.flatMap { it.bytes.toList() }.toByteArray().contentEquals(chunk(43)))
    check(partial.first().start == resumed.last().end)
    check(errors.isEmpty()) { errors.toString() }
  } finally { audio.stop() }
  check(track.paused && track.released)
  val count = track.snapshot().size
  audio.play(encode(chunk(44)))
  check(track.snapshot().size == count)
  val pending = LivePcmAudio({}, { errors.add(it) })
  pending.start()
  val blocked = AudioTrack.latest
  blocked.blockWrites = true
  pending.play(encode(chunk(1)))
  waitUntil { blocked.writing }
  // The pending reserve must not allow microphone-independent output to grow unbounded.
  for (i in 1 until 50) pending.play(encode(chunk(1)))
  var overflow = false
  try { pending.play(encode(chunk(1))) } catch (_: IllegalStateException) { overflow = true }
  check(overflow)
  pending.stop() // Must unblock a reserve write and never start the held speech.
  check(blocked.paused && blocked.released && blocked.snapshot().isEmpty())
  check(errors.isEmpty()) { errors.toString() }
  var pauses = 0
  lateinit var headset: LivePcmAudio
  headset = LivePcmAudio({}, { errors.add(it) }, { pauses++; headset.stop() })
  headset.start()
  val routed = AudioTrack.latest
  val routeListener = routed.routeListener!!
  routed.route(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) // Initial SCO setup may start on the phone.
  check(pauses == 0)
  routed.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  routed.route(null) // An intermediate unknown device is not a disconnect.
  check(pauses == 0)
  routed.route(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) // Headset hangs up SCO without a media key.
  check(pauses == 1 && routed.paused && routed.released)
  check(routed.routeListener == null)
  routeListener.onRoutingChanged(routed) // Queued callbacks cannot pause a new Live session.
  check(pauses == 1)
  println("Headset route loss stops capture/playback; initial phone route, transient null and stale callbacks ignored")
  println("Native Live playback: jitter, bounded reserve, starvation, short tail, PCM order, partial writes, overflow and stop during buffering passed")
}
