package expo.modules.dronelivevoice

import android.content.Intent
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
  var emitStopped: ((String) -> Unit)? = null

  fun finish(sessionId: String? = id) {
    if (id != sessionId) return
    val oldId = id ?: return
    id = null
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
  override fun definition() = ModuleDefinition {
    Name("DroneLiveVoice")
    Events("stopped")
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
        if (LiveVoiceSession.id == ownedSessionId) {
          LiveVoiceSession.context?.get()?.let { context ->
            context.stopService(Intent(context, LiveVoiceService::class.java))
          }
        }
      }
    }
  }
}
