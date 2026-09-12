package expo.modules.kotlin
class Promise {
  var resolved = false
  var value: Any? = null
  var rejection: String? = null
  fun resolve(value: Any? = null) { check(!resolved && rejection == null); resolved = true; this.value = value }
  fun reject(code: String, message: String?, error: Exception?) { check(!resolved && rejection == null); rejection = message ?: code }
}
