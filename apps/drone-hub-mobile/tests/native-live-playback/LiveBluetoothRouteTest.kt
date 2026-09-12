package expo.modules.dronelivevoice

import android.bluetooth.*
import android.content.*
import android.media.*
import android.os.Handler
import expo.modules.kotlin.Promise

private class HeadsetScenario {
  val context = Context()
  val manager = context.audioManager.apply { mode = AudioManager.MODE_NORMAL }
  val adapter = context.bluetoothManager.adapter
  val headset = adapter.headset
  val output = AudioDeviceInfo(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  var pauses = 0
  fun route(id: String = "test") = LiveBluetoothRoute(context, id, output) { pauses++ }
  fun connect() {
    headset.audioConnected = true
    manager.isBluetoothScoOn = true
    broadcast(BluetoothHeadset.STATE_AUDIO_CONNECTED)
  }
  fun disconnect() {
    headset.audioConnected = false
    manager.isBluetoothScoOn = false
    broadcast(BluetoothHeadset.STATE_AUDIO_DISCONNECTED)
  }
  fun broadcast(state: Int) {
    context.receiver!!.onReceive(context, Intent(BluetoothHeadset.ACTION_AUDIO_STATE_CHANGED,
      mapOf(BluetoothDevice.EXTRA_DEVICE to headset.connectedDevices.single(), BluetoothProfile.EXTRA_STATE to state)))
  }
}

fun main() {
  val s = HeadsetScenario()
  val route = s.route()
  val started = Promise()
  route.start(started)
  s.adapter.deliver()
  check(s.headset.calls == listOf("start") && s.manager.routeCalls.isEmpty() && !started.resolved)
  s.broadcast(BluetoothHeadset.STATE_AUDIO_DISCONNECTED) // Initial idle state is not a hangup.
  check(s.pauses == 0)
  s.connect()
  check(started.value == true && s.manager.mode == AudioManager.MODE_IN_COMMUNICATION)
  check(s.manager.routeCalls == listOf("select"))
  // Direct HFP disconnect pauses immediately, without an AudioManager or AudioTrack fallback.
  s.disconnect()
  check(s.pauses == 1)
  val released = Promise()
  route.close(released)
  check(released.resolved && s.context.receiver == null && s.adapter.closed == 1)
  check(s.manager.mode == AudioManager.MODE_NORMAL && s.manager.routeCalls.last() == "clear")
  // A subsequent start is accepted immediately; no virtual-call cooldown or extra button needed.
  val restarted = s.route("next")
  val startAgain = Promise()
  restarted.start(startAgain); s.adapter.deliver(); s.connect()
  check(startAgain.value == true && s.headset.calls == listOf("start", "stop", "start"))
  val stopping = Promise()
  restarted.close(stopping)
  check(!stopping.resolved) // A UI pause must await the still-connected headset before restarting.
  s.disconnect()
  check(stopping.resolved && Handler.pending.isEmpty())

  val pending = HeadsetScenario()
  val pendingRoute = pending.route()
  val pendingStart = Promise()
  pendingRoute.start(pendingStart)
  val cancelled = Promise()
  pendingRoute.close(cancelled)
  pending.adapter.deliver() // Late profile bind cannot start microphone or headset audio after close.
  check(cancelled.resolved && pendingStart.rejection != null && pending.headset.calls.isEmpty())

  val unsupported = HeadsetScenario()
  unsupported.headset.supported = false
  val unsupportedStart = Promise()
  unsupported.route().start(unsupportedStart); unsupported.adapter.deliver()
  check(unsupportedStart.value == false && unsupported.headset.calls.isEmpty() && unsupported.context.receiver == null)

  val busy = HeadsetScenario()
  busy.headset.audioConnected = true
  val busyStart = Promise()
  busy.route().start(busyStart); busy.adapter.deliver()
  check(busyStart.rejection != null && busy.headset.calls.isEmpty()) // Never stop another app's SCO.

  val timed = HeadsetScenario()
  val timedStart = Promise()
  timed.route().start(timedStart); timed.adapter.deliver()
  Handler.runDelayed()
  Handler.runDelayed() // Bound cleanup if a failed connection never sends DISCONNECTED.
  check(timedStart.rejection != null && timed.context.receiver == null && timed.headset.calls == listOf("start", "stop"))
  check(Handler.pending.isEmpty())

  val connecting = HeadsetScenario()
  val connectingRoute = connecting.route()
  val connectingStart = Promise()
  connectingRoute.start(connectingStart); connecting.adapter.deliver()
  connectingRoute.cancelStartup()
  val connectionClosed = Promise()
  connectingRoute.close(connectionClosed)
  connecting.connect() // A late SCO connection cannot enable the route or microphone after cancellation.
  check(connectingStart.rejection != null && connecting.manager.routeCalls.isEmpty() && !connectionClosed.resolved)
  connecting.disconnect()
  check(connectionClosed.resolved && connecting.context.receiver == null && Handler.pending.isEmpty())
  println("Headset voice route: external-SCO ordering, direct hangup, immediate restart, awaited teardown, late binding, unsupported/busy headset and timeout passed")
}
