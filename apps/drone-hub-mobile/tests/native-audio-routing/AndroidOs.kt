package android.os
object Build {
  object VERSION { var SDK_INT = 36 }
  object VERSION_CODES { const val S = 31 }
}
class Looper { companion object { fun getMainLooper() = Looper() } }
class Handler(looper: Looper)
