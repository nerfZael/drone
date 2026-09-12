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

private fun recordingCue() {
  for (headset in listOf(false, true)) {
    val captured = CopyOnWriteArrayList<String>()
    val errors = CopyOnWriteArrayList<String>()
    val audio = LivePcmAudio(captured::add, errors::add, awaitHeadset = headset)
    try {
      audio.start()
      val track = AudioTrack.latest
      audio.playRecordingCue()
      audio.playRecordingCue() // Late duplicate capture notification cannot replay it.
      if (headset) {
        Thread.sleep(30)
        check(track.snapshot().all { span -> span.bytes.all { it == 0.toByte() } })
        track.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
      }
      // No server audio has arrived. The cue must already be on the one PCM track.
      waitUntil { track.snapshot().any { span -> span.bytes.any { it != 0.toByte() } } }
      val tones = track.snapshot().filter { span -> span.bytes.any { it != 0.toByte() } }
      check(tones.size == 1 && tones.single().bytes.size == 14400)
      val bytes = tones.single().bytes
      check(bytes.take(4800).any { it != 0.toByte() } && bytes.drop(9600).any { it != 0.toByte() })
      check(bytes.sliceArray(4800 until 9600).all { it == 0.toByte() })
      audio.play(encode(chunk(47)))
      waitUntil { track.snapshot().any { it.bytes.contentEquals(chunk(47)) } }
      check(track.snapshot().last().bytes.contentEquals(chunk(47)))
      check(AudioTrack.latest === track)
      waitUntil { captured.isNotEmpty() }
      check(captured.all { java.util.Base64.getDecoder().decode(it).all { sample -> sample == 0.toByte() } })
      check(errors.isEmpty())
    } finally { audio.stop() }
  }
  val cancelled = LivePcmAudio({}, { error(it) }, awaitHeadset = true)
  try {
    cancelled.start()
    val track = AudioTrack.latest
    var ready: Boolean? = null
    cancelled.playRecordingCue { ready = it }
    cancelled.stop()
    check(ready == false && track.volume == 0f && track.paused)
    check(track.snapshot().all { span -> span.bytes.all { it == 0.toByte() } })
  } finally { cancelled.stop() }
  println("Recording cue renders once on the Live PCM track before server audio, follows headset routing, and cancels silently")
}

private fun openingCapture() {
  val captured = CopyOnWriteArrayList<ByteArray>()
  val errors = CopyOnWriteArrayList<String>()
  android.media.AudioRecord.sample = 0x1234
  val audio = LivePcmAudio({ captured.add(java.util.Base64.getDecoder().decode(it)) }, errors::add, awaitHeadset = true)
  try {
    audio.start()
    val track = AudioTrack.latest
    waitUntil { captured.isNotEmpty() }
    check(track.volume == 0f)
    check(captured.first().asList().chunked(2).all { it == listOf(0x34.toByte(), 0x12.toByte()) }) {
      "Opening microphone speech must survive before the output route and Live connection are ready"
    }
    audio.mute(true)
    waitUntil { captured.last().all { it == 0.toByte() } }
    check(errors.isEmpty())
  } finally { audio.stop(); android.media.AudioRecord.sample = 0 }

  // Some devices only report an output route after the first write. No server
  // speech has arrived, but the start cue still needs a usable headset route.
  AudioTrack.routeOnWrite = AudioDeviceInfo.TYPE_BLUETOOTH_SCO
  val priming = LivePcmAudio({}, errors::add, awaitHeadset = true)
  try {
    priming.start()
    waitUntil { AudioTrack.latest.snapshot().isNotEmpty() }
    var ready = false
    priming.whenPlaybackReady { ready = it }
    waitUntil { ready }
    check(AudioTrack.latest.snapshot().isNotEmpty())
    check(AudioTrack.latest.snapshot().all { span -> span.bytes.all { it == 0.toByte() } })
    check(errors.isEmpty())
  } finally { priming.stop(); AudioTrack.routeOnWrite = null }
  println("Opening speech survives pending output routing; explicit mute still silences capture; cue routing needs no server audio")
}

fun main() {
  recordingCue()
  openingCapture()
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
  // Stop output before a slow microphone shutdown has any opportunity to leak speech.
  val stopping = LivePcmAudio({}, { errors.add(it) })
  stopping.start()
  val stoppingTrack = AudioTrack.latest
  android.media.AudioRecord.beforeStop = { check(stoppingTrack.paused && stoppingTrack.volume == 0f) }
  stopping.stop()
  android.media.AudioRecord.beforeStop = null

  // Initial phone routing must produce neither speech nor a start cue while waiting for SCO.
  val connecting = LivePcmAudio({}, { errors.add(it) }, awaitHeadset = true)
  connecting.start()
  val connectingTrack = AudioTrack.latest
  var ready: Boolean? = null
  connecting.whenPlaybackReady { ready = it }
  connectingTrack.route(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
  connecting.play(encode(chunk(45)))
  Thread.sleep(50)
  check(ready == null && connectingTrack.volume == 0f)
  check(connectingTrack.snapshot().all { span -> span.bytes.all { it == 0.toByte() } })
  connectingTrack.route(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  check(ready == true && connectingTrack.volume == 1f)
  waitUntil { connectingTrack.snapshot().any { it.bytes.contentEquals(chunk(45)) } }
  connecting.stop()
  check(android.os.Handler.pending.isEmpty())

  val cancelled = LivePcmAudio({}, { errors.add(it) }, awaitHeadset = true)
  cancelled.start()
  var cancelledReady: Boolean? = null
  cancelled.whenPlaybackReady { cancelledReady = it }
  cancelled.stop()
  check(cancelledReady == false && android.os.Handler.pending.isEmpty())
  val timeoutErrors = mutableListOf<String>()
  val timeout = LivePcmAudio({}, { timeoutErrors.add(it) }, awaitHeadset = true)
  timeout.start()
  android.os.Handler.runDelayed()
  check(timeoutErrors.size == 1 && AudioTrack.latest.volume == 0f)
  timeout.stop()
  println("Headset startup holds cues and speech until routed; cancellation and timeout stay silent; playback stops before microphone")
  println("Headset route loss stops capture/playback; initial phone route, transient null and stale callbacks ignored")
  println("Native Live playback: jitter, bounded reserve, starvation, short tail, PCM order, partial writes, overflow and stop during buffering passed")
}
