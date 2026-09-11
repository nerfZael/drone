package expo.modules.audio

import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

fun main() {
  val speaker = AudioDeviceInfo(1, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
  val bluetooth = AudioDeviceInfo(2, AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
  val usb = AudioDeviceInfo(3, AudioDeviceInfo.TYPE_USB_HEADSET)
  val ble = AudioDeviceInfo(4, AudioDeviceInfo.TYPE_BLE_HEADSET)
  val manager = AudioManager()
  manager.availableCommunicationDevices = listOf(speaker, bluetooth)
  val router = AudioDeviceRouter(manager)
  router.configure(true, false)
  check(manager.communicationDevice == bluetooth)
  check(manager.mode == AudioManager.MODE_IN_COMMUNICATION)
  // Partial audio-mode updates must not terminate the microphone route.
  router.configure(null, null)
  check(manager.communicationDevice == bluetooth)
  manager.availableCommunicationDevices = listOf(speaker)
  manager.callback!!.onAudioDevicesRemoved(arrayOf(bluetooth))
  check(manager.communicationDevice == speaker)
  manager.availableCommunicationDevices = listOf(speaker, usb, ble)
  manager.rejected.add(usb.id)
  manager.callback!!.onAudioDevicesAdded(arrayOf(usb, ble))
  check(manager.communicationDevice == ble)
  manager.rejected.clear()
  router.configure(true, false)
  check(manager.communicationDevice == ble) // Keep the current external route.
  router.configure(false, null)
  check(manager.communicationDevice == null && manager.mode == 0)
  check(!manager.isSpeakerphoneOn)
  router.configure(true, false)
  router.close()
  check(manager.callback == null && manager.communicationDevice == null && manager.mode == 0)

  Build.VERSION.SDK_INT = 30
  val legacy = AudioManager()
  legacy.availableCommunicationDevices = listOf(speaker, bluetooth)
  val legacyRouter = AudioDeviceRouter(legacy)
  legacyRouter.configure(true, false)
  legacyRouter.configure(true, false)
  check(legacy.scoStarts == 1 && legacy.isBluetoothScoOn && !legacy.isSpeakerphoneOn)
  legacy.availableCommunicationDevices = listOf(speaker, bluetooth, usb)
  legacy.callback!!.onAudioDevicesAdded(arrayOf(usb))
  check(legacy.scoStops == 1 && !legacy.isBluetoothScoOn && !legacy.isSpeakerphoneOn)
  legacy.availableCommunicationDevices = listOf(speaker)
  legacy.callback!!.onAudioDevicesRemoved(arrayOf(usb, bluetooth))
  check(legacy.isSpeakerphoneOn)
  legacyRouter.close()
  check(legacy.mode == 0 && !legacy.isSpeakerphoneOn)
  println("Audio routing regression checks passed")
}
