package android.media

class AudioAttributes {
  class Builder {
    fun setUsage(value: Int) = this
    fun setContentType(value: Int) = this
    fun build() = AudioAttributes()
  }
  companion object { const val USAGE_MEDIA = 2; const val USAGE_VOICE_COMMUNICATION = 1; const val CONTENT_TYPE_SPEECH = 1 }
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
  fun read(samples: ShortArray, offset: Int, size: Int): Int {
    Thread.sleep(5)
    if (recordingState == 0) return 0
    samples.fill(sample, offset, offset + size)
    return size
  }
  fun stop() { beforeStop?.invoke(); recordingState = 0 }
  fun release() {}
  companion object {
    var beforeStop: (() -> Unit)? = null
    @Volatile var sample: Short = 0
    const val STATE_INITIALIZED = 1; const val RECORDSTATE_RECORDING = 1
    fun getMinBufferSize(rate: Int, channels: Int, encoding: Int) = 4800
  }
}

// Virtual audio device: the test advances the render clock separately from the
// production playback thread. Record spans and PCM to detect gaps, loss, and order.
interface AudioRouting {
  val routedDevice: AudioDeviceInfo?
  fun interface OnRoutingChangedListener { fun onRoutingChanged(router: AudioRouting) }
}
class AudioDeviceInfo(val type: Int, val address: String = "headset") {
  companion object {
    const val TYPE_BLUETOOTH_SCO = 7; const val TYPE_BLE_HEADSET = 26
    const val TYPE_WIRED_HEADSET = 3; const val TYPE_WIRED_HEADPHONES = 4
    const val TYPE_USB_DEVICE = 11; const val TYPE_USB_HEADSET = 22; const val TYPE_HEARING_AID = 23
    const val TYPE_BUILTIN_SPEAKER = 2; const val TYPE_BUILTIN_EARPIECE = 1
  }
}
class AudioTrack : AudioRouting {
  override var routedDevice: AudioDeviceInfo? = null
  var routeListener: AudioRouting.OnRoutingChangedListener? = null
  fun addOnRoutingChangedListener(listener: AudioRouting.OnRoutingChangedListener, handler: android.os.Handler) { routeListener = listener }
  fun removeOnRoutingChangedListener(listener: AudioRouting.OnRoutingChangedListener) { routeListener = null }
  fun route(type: Int?) { routedDevice = type?.let { AudioDeviceInfo(it) }; routeListener?.onRoutingChanged(this) }

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
    routeOnWrite?.let { if (routedDevice == null) route(it) }
    return count
  }
  @Synchronized fun snapshot() = spans.toList()
  var volume = 1f
  fun setVolume(value: Float): Int { volume = value; return 0 }
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
    var routeOnWrite: Int? = null
    fun getMinBufferSize(rate: Int, channels: Int, encoding: Int) = 4800
  }
}

class AudioManager {
  var isBluetoothScoOn = false
  var outputs = emptyArray<AudioDeviceInfo>()
  val routeCalls = mutableListOf<String>()
  fun getDevices(flags: Int) = outputs
  fun setCommunicationDevice(device: AudioDeviceInfo): Boolean {
    check(isBluetoothScoOn) { "Cannot request a virtual call before external SCO is connected" }
    routeCalls.add("select")
    communicationDevice = device
    return true
  }
  fun clearCommunicationDevice() { routeCalls.add("clear"); communicationDevice = null }
  var mode = MODE_IN_COMMUNICATION
  var communicationDevice: AudioDeviceInfo? = null
  var listener: OnCommunicationDeviceChangedListener? = null
  fun addOnCommunicationDeviceChangedListener(executor: java.util.concurrent.Executor, value: OnCommunicationDeviceChangedListener) { listener = value }
  fun removeOnCommunicationDeviceChangedListener(value: OnCommunicationDeviceChangedListener) { listener = null }
  fun requestAudioFocus(request: AudioFocusRequest) = AUDIOFOCUS_REQUEST_GRANTED
  fun requestAudioFocus(listener: OnAudioFocusChangeListener, stream: Int, gain: Int) = AUDIOFOCUS_REQUEST_GRANTED
  fun abandonAudioFocusRequest(request: AudioFocusRequest) {}
  fun abandonAudioFocus(listener: OnAudioFocusChangeListener) {}
  fun interface OnCommunicationDeviceChangedListener { fun onCommunicationDeviceChanged(device: AudioDeviceInfo?) }
  fun interface OnAudioFocusChangeListener { fun onAudioFocusChange(change: Int) }
  companion object {
    const val MODE_NORMAL = 0; const val GET_DEVICES_OUTPUTS = 2
    const val ACTION_SCO_AUDIO_STATE_UPDATED = "sco"
    const val EXTRA_SCO_AUDIO_STATE = "state"
    const val SCO_AUDIO_STATE_CONNECTED = 1; const val SCO_AUDIO_STATE_DISCONNECTED = 0
    const val ACTION_AUDIO_BECOMING_NOISY = "noisy"
    const val AUDIOFOCUS_GAIN = 1; const val AUDIOFOCUS_REQUEST_GRANTED = 1
    const val MODE_IN_COMMUNICATION = 3; const val STREAM_VOICE_CALL = 0; const val STREAM_MUSIC = 3
  }
}
class AudioFocusRequest {
  class Builder(gain: Int) {
    fun setAudioAttributes(attributes: AudioAttributes) = this
    fun setOnAudioFocusChangeListener(listener: AudioManager.OnAudioFocusChangeListener, handler: android.os.Handler) = this
    fun build() = AudioFocusRequest()
  }
}
class MediaMetadata {
  class Builder { fun putString(key: String, value: String) = this; fun build() = MediaMetadata() }
  companion object { const val METADATA_KEY_TITLE = "title" }
}
class ToneGenerator(stream: Int, volume: Int) {
  var released = false
  fun release() { released = true }
  fun startTone(kind: Int, length: Int): Boolean { played++; return true }
  companion object { const val TONE_PROP_ACK = 1; const val TONE_PROP_NACK = 2; var played = 0 }
}
