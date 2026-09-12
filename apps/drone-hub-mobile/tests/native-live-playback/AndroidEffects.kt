package android.media.audiofx
class AcousticEchoCanceler {
  var enabled = false
  fun release() {}
  companion object { fun isAvailable() = false; fun create(id: Int) = AcousticEchoCanceler() }
}
class NoiseSuppressor {
  var enabled = false
  fun release() {}
  companion object { fun isAvailable() = false; fun create(id: Int) = NoiseSuppressor() }
}
