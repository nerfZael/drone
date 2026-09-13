package expo.modules.dronelivevoice

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inspector.WindowInspector
import android.widget.TextView
import java.lang.ref.WeakReference
import java.util.UUID

/** Main-thread handoff. Only the system-bound voice service can mint a launch token. */
object CompanionAssistantLaunch {
  private const val ACTION = "expo.modules.dronelivevoice.COMPANION_ASSIST"
  private const val TOKEN = "companionLaunchToken"
  private val request = CompanionAssistantRequest()
  private var activity = WeakReference<Activity>(null)
  private var cover: TextView? = null
  private val hiddenContent = mutableListOf<Pair<WeakReference<View>, Int>>()
  private val hiddenDialogs = mutableListOf<Pair<WeakReference<View>, Int>>()
  var changed: (() -> Unit)? = null

  fun newIntent(context: Context): Intent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: error("Drone Hub launch activity is unavailable")
    val token = UUID.randomUUID().toString()
    request.issue(token)
    return intent.setAction(ACTION).putExtra(TOKEN, token)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }

  fun attach(host: Activity) {
    activity = WeakReference(host)
    if (host.intent.action == ACTION && request.isCurrent(host.intent.getStringExtra(TOKEN))) {
      // Recreate only the protected surface; the consumed press must not start audio again.
      showCover(host)
    } else accept(host, host.intent)
  }

  fun accept(host: Activity, intent: Intent) {
    activity = WeakReference(host)
    val token = intent.getStringExtra(TOKEN)
    if (intent.action == ACTION && request.accept(token)) {
      showCover(host)
      changed?.invoke()
    } else if (intent.action == Intent.ACTION_MAIN) {
      leave(host)
    }
  }

  private fun showCover(host: Activity) {
    // Never expose the regular app on the keyguard while React changes screens.
    lockedWindow(host, false)
    val content = host.findViewById<ViewGroup>(android.R.id.content)
    for (index in 0 until content.childCount) {
      val child = content.getChildAt(index)
      if (child !== cover) {
        if (hiddenContent.none { it.first.get() === child }) hiddenContent.add(WeakReference(child) to child.visibility)
        child.visibility = View.INVISIBLE
      }
    }
    // RN Modals use separate windows. Hide them as well until React unmounts them.
    // These dialog roots are discarded by the assistant-only render, not restored over keyguard.
    if (Build.VERSION.SDK_INT >= 29) WindowInspector.getGlobalWindowViews().forEach { root ->
      if (root !== host.window.decorView) {
        if (hiddenDialogs.none { it.first.get() === root }) hiddenDialogs.add(WeakReference(root) to root.visibility)
        root.visibility = View.INVISIBLE
      }
    }
    cover?.let { (it.parent as? ViewGroup)?.removeView(it) }
    cover = TextView(host).apply {
      text = "Opening Companion…\nTap to cancel"
      val coveredRequest = request.id
      setOnClickListener { dismiss(coveredRequest) }
      setTextColor(Color.WHITE)
      setBackgroundColor(Color.rgb(30, 30, 46))
      gravity = Gravity.CENTER
      isClickable = true
    }
    host.addContentView(cover, ViewGroup.LayoutParams(-1, -1))
    // A visible activity is needed to let React render on a cold, locked launch.
    lockedWindow(host, true)
  }

  fun snapshot() = mapOf("requestId" to request.id)

  fun ready(id: String): Boolean {
    val host = activity.get() ?: return false
    if (!request.isCurrent(id)) return false
    // Called from the dedicated screen's native onLayout, after Fabric has mounted it.
    lockedWindow(host, true)
    restoreContent()
    cover?.let { (it.parent as? ViewGroup)?.removeView(it) }
    cover = null
    return true
  }

  fun canStart(id: String): Boolean = request.isCurrent(id) &&
    activity.get()?.hasWindowFocus() == true && cover == null

  fun claimStart(id: String): Boolean = canStart(id) && request.claim(id)

  fun retry(id: String): Boolean = canStart(id) && request.retry(id)

  fun openApp(id: String) {
    if (!request.matches(id)) return
    val host = activity.get() ?: return
    val keyguard = host.getSystemService(KeyguardManager::class.java)
    if (keyguard.isKeyguardLocked) {
      keyguard.requestDismissKeyguard(host, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() {
          if (activity.get() === host && request.matches(id)) leave(host)
        }
      })
    } else leave(host)
  }

  fun dismiss(id: String) {
    val host = activity.get() ?: return
    if (!request.dismiss(id)) return
    lockedWindow(host, false)
    restoreContent()
    cover?.let { (it.parent as? ViewGroup)?.removeView(it) }
    cover = null
    // Keep the restricted screen mounted in the background; a launcher intent restores the app.
    host.moveTaskToBack(true)
  }

  private fun leave(host: Activity) {
    lockedWindow(host, false)
    restoreContent()
    hiddenDialogs.forEach { (view, visibility) -> view.get()?.visibility = visibility }
    hiddenDialogs.clear()
    request.clear()
    cover?.let { (it.parent as? ViewGroup)?.removeView(it) }
    cover = null
    changed?.invoke()
  }

  private fun restoreContent() {
    hiddenContent.forEach { (view, visibility) -> view.get()?.visibility = visibility }
    hiddenContent.clear()
  }

  private fun lockedWindow(host: Activity, enabled: Boolean) {
    if (Build.VERSION.SDK_INT >= 27) {
      host.setShowWhenLocked(enabled)
      host.setTurnScreenOn(enabled)
    }
    if (enabled) host.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    else host.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
  }
}
