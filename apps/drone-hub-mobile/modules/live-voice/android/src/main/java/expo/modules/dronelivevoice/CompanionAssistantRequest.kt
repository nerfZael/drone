package expo.modules.dronelivevoice

/** State survives React/activity recreation. Access only from the Android main queue. */
internal class CompanionAssistantRequest {
  var id = ""
    private set
  private var pending: String? = null
  private var claimed = false
  private var ended = false

  fun issue(token: String) { pending = token }
  fun accept(token: String?): Boolean {
    if (token.isNullOrEmpty() || token != pending) return false
    pending = null
    id = token
    claimed = false
    ended = false
    return true
  }
  fun matches(token: String?) = pending == null && !token.isNullOrEmpty() && token == id
  fun isCurrent(token: String?) = matches(token) && !ended
  fun claim(token: String): Boolean {
    if (!isCurrent(token) || claimed) return false
    claimed = true
    return true
  }
  fun retry(token: String): Boolean {
    if (!isCurrent(token)) return false
    claimed = false
    return true
  }
  fun dismiss(token: String): Boolean {
    if (!isCurrent(token)) return false
    ended = true
    return true
  }
  fun clear() { id = ""; pending = null; claimed = false; ended = true }
}
