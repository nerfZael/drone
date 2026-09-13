package expo.modules.dronelivevoice

import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

class CompanionAssistantService : VoiceInteractionService() {
  override fun onReady() {
    super.onReady()
    setDisabledShowContext(VoiceInteractionSession.SHOW_WITH_ASSIST or VoiceInteractionSession.SHOW_WITH_SCREENSHOT)
  }

  override fun onLaunchVoiceAssistFromKeyguard() {
    startActivity(CompanionAssistantLaunch.newIntent(this))
  }
}

class CompanionAssistantSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = CompanionAssistantSession(this)
}

private class CompanionAssistantSession(context: android.content.Context) : VoiceInteractionSession(context) {
  override fun onPrepareShow(args: Bundle?, showFlags: Int) {
    super.onPrepareShow(args, showFlags)
    setUiEnabled(false)
  }

  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    // Reuse the app's single React root and microphone coordinator, including on cold start.
    context.startActivity(CompanionAssistantLaunch.newIntent(context))
    hide()
  }
}
