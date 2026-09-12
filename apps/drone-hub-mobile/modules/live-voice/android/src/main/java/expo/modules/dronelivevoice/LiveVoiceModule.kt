package expo.modules.dronelivevoice

import android.content.Intent
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

// All access is on the main queue. Session IDs prevent late cleanup from stopping a new call.
internal object LiveVoiceSession {
  var id: String? = null
  var context: WeakReference<ReactContext>? = null
  var started: Promise? = null
  val stopped = mutableListOf<Promise>()
  var stopAudio: (() -> Unit)? = null
  var emitStopped: ((String) -> Unit)? = null
  var mediaControls: LiveMediaControls? = null
  var refreshNotification: (() -> Unit)? = null

  fun finish(sessionId: String? = id) {
    if (id != sessionId) return
    val oldId = id ?: return
    id = null
    stopAudio?.invoke()
    stopAudio = null
    mediaControls?.close(); mediaControls = null; refreshNotification = null
    started?.reject("LIVE_STOPPED", "Live voice was stopped before startup completed", null)
    started = null
    emitStopped?.invoke(oldId)
    emitStopped = null
    context = null
    stopped.forEach { it.resolve() }
    stopped.clear()
  }
}

class LiveVoiceModule : Module() {
  private var ownedSessionId: String? = null
  private var foreground = true
  private var pcm: LivePcmAudio? = null
  private var pcmId: String? = null
  override fun definition() = ModuleDefinition {
    Name("DroneLiveVoice")
    Events("stopped", "pcmAudio", "pcmError", "mediaControl")
    AsyncFunction("armControls") { id: String ->
      check(LiveVoiceSession.id != null) { "Start the Live foreground service first" }
      val context = appContext.reactContext ?: error("React context is unavailable")
      check(LiveVoiceSession.mediaControls == null) { "Live headset controls are already active" }
      LiveVoiceSession.mediaControls = LiveMediaControls(context, id) { action ->
        sendEvent("mediaControl", mapOf("id" to id, "action" to action))
      }
      LiveVoiceSession.refreshNotification?.invoke()
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("updateControls") { id: String, state: String ->
      LiveVoiceSession.mediaControls?.takeIf { it.id == id }?.update(state)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("disarmControls") { id: String ->
      if (LiveVoiceSession.mediaControls?.id == id) {
        LiveVoiceSession.mediaControls?.close(); LiveVoiceSession.mediaControls = null
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("playCue") { id: String, kind: String, promise: Promise ->
      val controls = LiveVoiceSession.mediaControls?.takeIf { it.id == id }
      if (controls == null) promise.resolve()
      else if (kind == "recording") {
        val audio = pcm
        if (audio == null) promise.resolve()
        else audio.whenPlaybackReady { ready ->
          if (ready && pcm === audio && LiveVoiceSession.mediaControls === controls && controls.isPlaying()) controls.playCue(kind, promise)
          else promise.resolve()
        }
      } else controls.playCue(kind, promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("startPcm") { id: String ->
      check(LiveVoiceSession.id != null) { "Start the Live foreground service first" }
      check(pcm == null) { "Live audio is already running" }
      val context = appContext.reactContext ?: error("React context is unavailable")
      val manager = context.getSystemService(AudioManager::class.java)
      val awaitHeadset = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
          it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
          it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_HEARING_AID
      }
      val audio = LivePcmAudio(
        { audio -> sendEvent("pcmAudio", mapOf("id" to id, "audio" to audio)) },
        { error -> sendEvent("pcmError", mapOf("id" to id, "error" to error)) },
        { LiveVoiceSession.mediaControls?.pauseForHeadsetDisconnect() }, awaitHeadset)
      pcm = audio
      pcmId = id
      LiveVoiceSession.stopAudio = { pcm?.stop(); pcm = null; pcmId = null }
      try { audio.start() } catch (error: Exception) {
        pcm = null; pcmId = null; LiveVoiceSession.stopAudio = null
        throw error
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopPcm") { id: String ->
      if (pcmId == id) {
        pcm?.stop(); pcm = null; pcmId = null; LiveVoiceSession.stopAudio = null
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("mutePcm") { id: String, muted: Boolean ->
      if (pcmId == id) pcm?.mute(muted)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("playPcm") { id: String, audio: String ->
      if (pcmId == id) pcm?.play(audio)
    }.runOnQueue(Queues.MAIN)
    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground { foreground = false }
    AsyncFunction("start") { sessionId: String, promise: Promise ->
      val context = appContext.reactContext as? ReactContext ?: error("React context is unavailable")
      // React Native Modal owns a separate window; lost window focus is not backgrounding.
      require(foreground && appContext.currentActivity != null) {
        "Open Drone Hub before starting Live voice"
      }
      check(LiveVoiceSession.id == null) { "Live voice is already running" }
      LiveVoiceSession.id = sessionId
      ownedSessionId = sessionId
      LiveVoiceSession.context = WeakReference(context)
      LiveVoiceSession.started = promise
      val module = WeakReference(this@LiveVoiceModule)
      LiveVoiceSession.emitStopped = { id -> module.get()?.sendEvent("stopped", mapOf("sessionId" to id)) }
      try {
        ContextCompat.startForegroundService(context, Intent(context, LiveVoiceService::class.java))
        Handler(Looper.getMainLooper()).postDelayed({
          if (LiveVoiceSession.id == sessionId && LiveVoiceSession.started != null) {
            LiveVoiceSession.started?.reject("LIVE_SERVICE_TIMEOUT", "Live voice background service did not start", null)
            LiveVoiceSession.started = null
            if (!context.stopService(Intent(context, LiveVoiceService::class.java))) LiveVoiceSession.finish(sessionId)
          }
        }, 10_000)
      } catch (error: Exception) {
        promise.reject("LIVE_SERVICE_START", error.message, error)
        LiveVoiceSession.started = null
        LiveVoiceSession.finish()
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { sessionId: String, promise: Promise ->
      if (LiveVoiceSession.id != sessionId) {
        promise.resolve()
      } else {
        LiveVoiceSession.stopped.add(promise)
        val context = appContext.reactContext
        if (context == null || !context.stopService(Intent(context, LiveVoiceService::class.java))) {
          LiveVoiceSession.finish()
        }
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("isActive") { sessionId: String -> LiveVoiceSession.id == sessionId }
      .runOnQueue(Queues.MAIN)
    OnDestroy {
      Handler(Looper.getMainLooper()).post {
        pcm?.stop(); pcm = null; pcmId = null
        if (LiveVoiceSession.id == ownedSessionId) {
          LiveVoiceSession.context?.get()?.let { context ->
            context.stopService(Intent(context, LiveVoiceService::class.java))
          }
        }
      }
    }
  }
}
