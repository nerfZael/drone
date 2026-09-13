package expo.modules.dronelivevoice

import android.app.role.RoleManager
import android.content.ComponentName
import android.os.Build
import android.service.voice.VoiceInteractionService
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CompanionAssistantModule : Module() {
  private var launchListener: (() -> Unit)? = null
  override fun definition() = ModuleDefinition {
    Name("DroneAssistant")
    Events("launchChanged")
    OnCreate {
      launchListener = { sendEvent("launchChanged", CompanionAssistantLaunch.snapshot()) }
      CompanionAssistantLaunch.changed = launchListener
    }
    OnDestroy {
      if (CompanionAssistantLaunch.changed === launchListener) CompanionAssistantLaunch.changed = null
      launchListener = null
    }
    AsyncFunction("getLaunch") { CompanionAssistantLaunch.snapshot() }.runOnQueue(Queues.MAIN)
    AsyncFunction("ready") { id: String -> CompanionAssistantLaunch.ready(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("canStart") { id: String -> CompanionAssistantLaunch.canStart(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("claimStart") { id: String -> CompanionAssistantLaunch.claimStart(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("retry") { id: String -> CompanionAssistantLaunch.retry(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("hasPermissions") {
      val context = appContext.reactContext ?: error("React context is unavailable")
      androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED &&
        (LiveBluetoothRoute.candidate(context) == null || LiveBluetoothRoute.permitted(context))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("openApp") { id: String -> CompanionAssistantLaunch.openApp(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("dismiss") { id: String -> CompanionAssistantLaunch.dismiss(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("getStatus") {
      val context = appContext.reactContext ?: error("React context is unavailable")
      val supported = Build.VERSION.SDK_INT >= 31 && context.getSystemService(RoleManager::class.java)
        .isRoleAvailable(RoleManager.ROLE_ASSISTANT)
      mapOf("supported" to supported, "selected" to (supported &&
        VoiceInteractionService.isActiveService(context, ComponentName(context, CompanionAssistantService::class.java))))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("requestRole") {
      val activity = appContext.currentActivity ?: error("Open Drone Hub to choose your assistant")
      check(Build.VERSION.SDK_INT >= 31) { "Companion as phone assistant requires Android 12 or later" }
      CompanionAssistantSettings.open(activity)
    }.runOnQueue(Queues.MAIN)
  }
}
