package expo.modules.dronelivevoice

import android.app.NotificationChannel
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

class LiveVoiceService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var tasks: HeadlessJsTaskContext? = null
  private var taskId: Int? = null
  private var sessionId: String? = null

  override fun onBind(intent: Intent): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP) {
      if (sessionId == null || intent.getStringExtra("sessionId") == sessionId) {
        val controls = LiveVoiceSession.mediaControls
        if (controls == null) stopSelf()
        else {
          controls.command("stop") // Stop capture now; let JS close Live and play the stopped cue.
          val ending = sessionId
          Handler(Looper.getMainLooper()).postDelayed({ if (LiveVoiceSession.id == ending) stopSelf() }, 2_000)
        }
      }
      return START_NOT_STICKY
    }
    if (intent?.action == TOGGLE) {
      if (intent.getStringExtra("sessionId") == sessionId) {
        LiveVoiceSession.mediaControls?.let { it.command(if (it.isPlaying()) "pause" else "play") }
      }
      return START_NOT_STICKY
    }
    val sessionId = LiveVoiceSession.id
    val context = LiveVoiceSession.context?.get()
    if (sessionId == null || context == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (taskId != null) return START_NOT_STICKY
    this.sessionId = sessionId
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Live Companion", NotificationManager.IMPORTANCE_LOW))
      }
      val notification = notification(sessionId)
      val types = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      } else ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      ServiceCompat.startForeground(this, 7402, notification, types)
      LiveVoiceSession.refreshNotification = { manager.notify(7402, notification(sessionId)) }
      wakeLock = getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DroneHub:LiveCompanion").apply {
          setReferenceCounted(false)
          acquire()
        }
      // React Native otherwise pauses JS timers on screen lock, including Hub heartbeats.
      tasks = HeadlessJsTaskContext.getInstance(context)
      taskId = tasks!!.startTask(HeadlessJsTaskConfig("DroneLiveVoice", Arguments.createMap().apply {
        putString("sessionId", sessionId)
      }, 0, true))
      LiveVoiceSession.started?.resolve()
      LiveVoiceSession.started = null
    } catch (error: Exception) {
      LiveVoiceSession.started?.reject("LIVE_SERVICE_START", error.message, error)
      LiveVoiceSession.started = null
      stopSelf()
    }
    // Never restart a microphone session after the process has been killed.
    return START_NOT_STICKY
  }

  private fun notification(id: String): Notification {
    fun action(name: String) = PendingIntent.getService(this, id.hashCode(),
      Intent(this, LiveVoiceService::class.java).setAction(name).putExtra("sessionId", id),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val controls = LiveVoiceSession.mediaControls
    val playing = controls?.isPlaying() != false
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    builder.setContentTitle(if (playing) "Live Companion" else "Live Companion paused")
      .setContentText(if (playing) "Headset button pauses voice" else "Microphone off · Press play for a new Live session")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentIntent(open)
      .setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
      .setVisibility(Notification.VISIBILITY_PUBLIC).setCategory(Notification.CATEGORY_TRANSPORT)
    if (controls != null) {
      builder.addAction(Notification.Action.Builder(
        if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (playing) "Pause" else "Start", action(TOGGLE)).build())
      builder.setStyle(Notification.MediaStyle().setMediaSession(controls.session.sessionToken).setShowActionsInCompactView(0))
    }
    builder.addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "End voice", action(STOP)).build())
    return builder.build()
  }

  override fun onDestroy() {
    LiveVoiceSession.finish(sessionId)
    val oldTasks = tasks
    val oldTaskId = taskId
    // JS resolves the task on "stopped"; finish it here too if the runtime cannot respond.
    Handler(Looper.getMainLooper()).postDelayed({
      if (oldTaskId != null && oldTasks?.isTaskRunning(oldTaskId) == true) oldTasks.finishTask(oldTaskId)
    }, 2_000)
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "drone-live-companion"
    private const val STOP = "com.dronehub.mobile.STOP_LIVE_VOICE"
    private const val TOGGLE = "com.dronehub.mobile.TOGGLE_LIVE_VOICE"
  }
}
