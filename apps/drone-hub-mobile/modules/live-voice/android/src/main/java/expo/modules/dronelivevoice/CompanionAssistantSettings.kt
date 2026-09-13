package expo.modules.dronelivevoice

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings

internal object CompanionAssistantSettings {
  fun open(activity: Activity) {
    // ASSISTANT is available but not requestable through createRequestRoleIntent.
    // Android immediately finishes that request activity. Selection belongs in Settings.
    try { activity.startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)) }
    catch (_: ActivityNotFoundException) {
      activity.startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
    }
  }
}
