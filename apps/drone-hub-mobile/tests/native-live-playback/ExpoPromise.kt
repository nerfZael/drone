package expo.modules.kotlin
class Promise {
  var resolved = false
  fun resolve() { resolved = true }
  fun reject(code: String, message: String?, error: Exception) { throw error }
}
