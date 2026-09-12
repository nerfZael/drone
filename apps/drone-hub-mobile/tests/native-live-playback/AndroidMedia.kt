package android.media

class AudioAttributes {
  class Builder {
    fun setUsage(value: Int) = this
    fun setContentType(value: Int) = this
    fun build() = AudioAttributes()
  }
  companion object { const val USAGE_VOICE_COMMUNICATION = 1; const val CONTENT_TYPE_SPEECH = 1 }
}
class AudioFormat {
  class Builder {
    fun setSampleRate(value: Int) = this
    fun setChannelMask(value: Int) = this
    fun setEncoding(value: Int) = this
    fun build() = AudioFormat()
  }
  companion object { const val CHANNEL_IN_MONO = 1; const val CHANNEL_OUT_MONO = 1; const val ENCODING_PCM_16BIT = 2 }
}
object MediaRecorder { object AudioSource { const val VOICE_COMMUNICATION = 1 } }
class AudioRecord(source: Int, rate: Int, channels: Int, encoding: Int, size: Int) {
  val state = STATE_INITIALIZED
  val audioSessionId = 1
  @Volatile var recordingState = 0
  fun startRecording() { recordingState = RECORDSTATE_RECORDING }
  fun read(samples: ShortArray, offset: Int, size: Int): Int { Thread.sleep(5); return if (recordingState == 0) 0 else size }
  fun stop() { recordingState = 0 }
  fun release() {}
  companion object {
    const val STATE_INITIALIZED = 1; const val RECORDSTATE_RECORDING = 1
    fun getMinBufferSize(rate: Int, channels: Int, encoding: Int) = 4800
  }
}

// Virtual audio device: the test advances the render clock separately from the
// production playback thread. Record spans and PCM to detect gaps, loss, and order.
class AudioTrack {
  data class Span(val start: Long, val end: Long, val bytes: ByteArray)
  val spans = mutableListOf<Span>()
  val state = STATE_INITIALIZED
  @Volatile var nowFrames = 0L
  @Volatile var paused = false
  @Volatile var released = false
  @Volatile var maxWriteBytes = Int.MAX_VALUE
  @Volatile var blockWrites = false
  @Volatile var writing = false
  val playbackHeadPosition: Int
    @Synchronized get() = spans.sumOf { (nowFrames - it.start).coerceIn(0, it.end - it.start) }.toInt()
  @Synchronized fun write(bytes: ByteArray, offset: Int, size: Int): Int {
    writing = true
    while (blockWrites && !paused) Thread.sleep(1)
    if (paused) return 0
    val count = minOf(size, maxWriteBytes)
    val start = maxOf(nowFrames, spans.lastOrNull()?.end ?: nowFrames)
    spans.add(Span(start, start + count / 2, bytes.copyOfRange(offset, offset + count)))
    return count
  }
  @Synchronized fun snapshot() = spans.toList()
  fun play() {}
  fun pause() { paused = true }
  fun flush() {}
  fun release() { released = true }
  class Builder {
    fun setAudioAttributes(value: AudioAttributes) = this
    fun setAudioFormat(value: AudioFormat) = this
    fun setBufferSizeInBytes(value: Int) = this
    fun setTransferMode(value: Int) = this
    fun build() = AudioTrack().also { latest = it }
  }
  companion object {
    const val STATE_INITIALIZED = 1; const val MODE_STREAM = 1
    lateinit var latest: AudioTrack
    fun getMinBufferSize(rate: Int, channels: Int, encoding: Int) = 4800
  }
}
