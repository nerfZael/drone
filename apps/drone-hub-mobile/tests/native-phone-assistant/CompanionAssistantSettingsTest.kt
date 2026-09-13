package expo.modules.dronelivevoice

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent

fun testAssistantSettings() {
  val actions = mutableListOf<String>()
  CompanionAssistantSettings.open(object : Activity() {
    override fun startActivity(intent: Intent) { actions.add(intent.action) }
  })
  check(actions == listOf("android.settings.VOICE_INPUT_SETTINGS"))

  actions.clear()
  CompanionAssistantSettings.open(object : Activity() {
    override fun startActivity(intent: Intent) {
      actions.add(intent.action)
      if (actions.size == 1) throw ActivityNotFoundException()
    }
  })
  check(actions == listOf("android.settings.VOICE_INPUT_SETTINGS", "android.settings.MANAGE_DEFAULT_APPS_SETTINGS"))

  var propagated = false
  try {
    CompanionAssistantSettings.open(object : Activity() {
      override fun startActivity(intent: Intent) { throw SecurityException("Settings is restricted") }
    })
  } catch (_: SecurityException) { propagated = true }
  check(propagated) // The JS button must receive an actionable error, not silently succeed.
  println("Companion assistant settings regressions passed")
}
