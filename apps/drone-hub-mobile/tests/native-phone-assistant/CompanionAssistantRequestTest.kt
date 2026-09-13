package expo.modules.dronelivevoice

fun main() {
  val request = CompanionAssistantRequest()
  check(!request.accept(null))
  check(!request.accept("spoofed"))
  request.issue("first")
  check(!request.accept("spoofed"))
  check(request.accept("first"))
  check(!request.accept("first")) // An exported activity intent cannot replay a token.
  check(request.claim("first"))
  check(!request.claim("first")) // Activity/React recreation retains consumption.
  check(request.retry("first"))
  check(request.claim("first"))
  request.issue("second")
  check(!request.matches("first")) // New intent delivery may lag the old unlock callback.
  check(!request.dismiss("first"))
  check(request.accept("second"))
  check(!request.dismiss("first")) // A late End completion cannot dismiss the new press.
  check(!request.matches("first")) // Nor can the old unlock callback leave the new surface.
  check(!request.retry("first"))
  check(request.isCurrent("second"))
  check(request.claim("second"))
  check(request.dismiss("second"))
  check(!request.isCurrent("second"))
  check(!request.claim("second"))
  check(!request.retry("second"))
  check(request.matches("second")) // The ended surface can still offer authenticated app navigation.
  request.issue("third")
  request.clear()
  check(!request.accept("third"))
  check(!request.matches("second"))
  println("Companion assistant request regressions passed")
}
