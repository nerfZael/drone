package android.util

object Log { fun i(tag: String, message: String) = 0 }
object Base64 {
  const val NO_WRAP = 2
  const val DEFAULT = 0
  fun encodeToString(bytes: ByteArray, flags: Int) = java.util.Base64.getEncoder().encodeToString(bytes)
  fun decode(text: String, flags: Int) = java.util.Base64.getDecoder().decode(text)
}
