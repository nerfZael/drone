package expo.modules.dronelivevoice

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise

/** A headset voice-recognition connection, without HFP's virtual-call/end-call media-key suppression. */
@Suppress("DEPRECATION")
internal class LiveBluetoothRoute(private val context: Context, val id: String,
  private val output: AudioDeviceInfo, private val onDisconnected: () -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private val manager = context.getSystemService(AudioManager::class.java)
  private val adapter = context.getSystemService(BluetoothManager::class.java).adapter
  private var headset: BluetoothHeadset? = null
  private var device: BluetoothDevice? = null
  private var starting: Promise? = null
  private val closingPromises = mutableListOf<Promise>()
  private var closing = false
  private var closed = false
  private var registered = false
  private var requested = false
  private var connected = false
  private var audioDisconnected = false
  private var previousMode: Int? = null
  private val timeout = Runnable { fail("The headset did not connect. Try Live again.") }
  private val closeTimeout = Runnable { finishClose() }
  private val configure = object : Runnable {
    override fun run() {
      if (closing || closed || !connected || starting == null) return
      // Wait for AudioService to observe the external SCO connection before selecting it.
      // Selecting SCO earlier would ask it to create the virtual call we are avoiding.
      try {
        if (!manager.isBluetoothScoOn) { handler.postDelayed(this, 25); return }
        previousMode = manager.mode
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= 31) check(manager.setCommunicationDevice(output)) { "Could not route Live to the headset" }
        else manager.isBluetoothScoOn = true
        handler.removeCallbacks(timeout)
        val promise = starting; starting = null
        promise?.resolve(true)
      } catch (error: Exception) { fail(error.message ?: "Could not route Live to the headset") }
    }
  }
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (closed || intent.action != BluetoothHeadset.ACTION_AUDIO_STATE_CHANGED) return
      val changed = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)
      if (device == null || changed != device) return
      when (intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1)) {
        BluetoothHeadset.STATE_AUDIO_CONNECTED -> {
          if (closing) return
          connected = true; audioDisconnected = false
          if (starting != null) configure.run()
        }
        BluetoothHeadset.STATE_AUDIO_DISCONNECTED -> {
          val wasConnected = connected
          connected = false; audioDisconnected = true
          handler.removeCallbacks(configure)
          if (closing) finishClose()
          else if (wasConnected) {
            // This broadcast precedes AudioManager/AudioTrack's speaker fallback notifications.
            onDisconnected()
            if (starting != null) fail("The headset disconnected while starting Live")
          }
        }
      }
    }
  }
  private val listener = object : BluetoothProfile.ServiceListener {
    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
      if (closed || closing) { adapter?.closeProfileProxy(profile, proxy); return }
      val service = proxy as BluetoothHeadset
      headset = service
      try {
        val devices = service.connectedDevices
        val selected = devices.firstOrNull { Build.VERSION.SDK_INT >= 28 && it.address == output.address }
          ?: devices.singleOrNull() ?: error("Could not identify the active Live headset")
        device = selected
        if (Build.VERSION.SDK_INT >= 31 && !service.isVoiceRecognitionSupported(selected)) {
          val promise = starting; starting = null
          finishClose()
          promise?.resolve(false) // Unsupported headsets keep the standard communication route.
          return
        }
        check(!service.isAudioConnected(selected)) { "The headset is already being used by another voice session" }
        check(service.startVoiceRecognition(selected)) { "Could not start headset voice audio. Try Live again." }
        requested = true; audioDisconnected = false
      } catch (error: Exception) { fail(error.message ?: "Could not start headset voice audio") }
    }
    override fun onServiceDisconnected(profile: Int) {
      headset = null
      if (closing) finishClose()
      else if (!closed) { onDisconnected(); fail("The headset service disconnected") }
    }
  }

  fun start(promise: Promise) {
    starting = promise
    try {
      check(manager.mode == AudioManager.MODE_NORMAL) { "Another call is using the headset" }
      ContextCompat.registerReceiver(context, receiver, IntentFilter(BluetoothHeadset.ACTION_AUDIO_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
      registered = true
      handler.postDelayed(timeout, 5000)
      check(adapter?.getProfileProxy(context, listener, BluetoothProfile.HEADSET) == true) { "Bluetooth is unavailable" }
    } catch (error: Exception) { fail(error.message ?: "Could not prepare headset audio") }
  }

  fun cancelStartup() {
    if (starting != null) close()
  }

  fun close(promise: Promise? = null) {
    if (closed) { promise?.resolve(); return }
    if (promise != null) closingPromises.add(promise)
    if (closing) return
    closing = true
    val pending = starting; starting = null
    pending?.reject("LIVE_HEADSET_CANCELLED", "Live headset startup was cancelled", null)
    handler.removeCallbacks(timeout); handler.removeCallbacks(configure)
    // Drop our AudioService request before ending external SCO, otherwise it can reconnect it.
    previousMode?.let { mode ->
      try {
        if (Build.VERSION.SDK_INT >= 31) manager.clearCommunicationDevice()
        else manager.isBluetoothScoOn = false
        manager.mode = mode
      } catch (_: Exception) {}
    }
    previousMode = null
    val service = headset
    val selected = device
    if (requested && service != null && selected != null) {
      requested = false
      try {
        service.stopVoiceRecognition(selected)
        if (!audioDisconnected) {
          // Serialize a quick restart after actual disconnection, without losing the Play request.
          handler.postDelayed(closeTimeout, 2000)
          return
        }
      } catch (_: Exception) {}
    }
    finishClose()
  }

  private fun fail(message: String) {
    if (closed) return
    val pending = starting; starting = null
    pending?.reject("LIVE_HEADSET_ROUTE", message, null)
    close()
  }

  private fun finishClose() {
    if (closed) return
    closed = true
    handler.removeCallbacks(timeout); handler.removeCallbacks(configure); handler.removeCallbacks(closeTimeout)
    if (registered) { context.unregisterReceiver(receiver); registered = false }
    headset?.let { adapter?.closeProfileProxy(BluetoothProfile.HEADSET, it) }; headset = null
    closingPromises.forEach { it.resolve() }; closingPromises.clear()
  }

  companion object {
    fun candidate(context: Context): AudioDeviceInfo? {
      val manager = context.getSystemService(AudioManager::class.java)
      val devices = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      // Wired/USB/BLE routes already support immediate media controls without classic HFP.
      if (devices.any { it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
          it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_DEVICE || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET }) return null
      return devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
    }
    fun permitted(context: Context) = Build.VERSION.SDK_INT < 31 ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
  }
}
