package android.media

class AudioDeviceInfo(val id: Int, val type: Int) {
  companion object {
    const val TYPE_BUILTIN_EARPIECE = 1
    const val TYPE_BUILTIN_SPEAKER = 2
    const val TYPE_WIRED_HEADSET = 3
    const val TYPE_WIRED_HEADPHONES = 4
    const val TYPE_BLUETOOTH_SCO = 7
    const val TYPE_USB_DEVICE = 11
    const val TYPE_USB_HEADSET = 22
    const val TYPE_HEARING_AID = 23
    const val TYPE_BLE_HEADSET = 26
    const val TYPE_BLE_SPEAKER = 27
  }
}
open class AudioDeviceCallback {
  open fun onAudioDevicesAdded(devices: Array<AudioDeviceInfo>) {}
  open fun onAudioDevicesRemoved(devices: Array<AudioDeviceInfo>) {}
}
class AudioManager {
  var mode = 0
  var isSpeakerphoneOn = false
  var isBluetoothScoOn = false
  var scoStarts = 0
  var scoStops = 0
  var availableCommunicationDevices = listOf<AudioDeviceInfo>()
  var communicationDevice: AudioDeviceInfo? = null
  var callback: AudioDeviceCallback? = null
  val rejected = mutableSetOf<Int>()
  fun registerAudioDeviceCallback(value: AudioDeviceCallback, handler: android.os.Handler) { callback = value }
  fun unregisterAudioDeviceCallback(value: AudioDeviceCallback) { check(callback === value); callback = null }
  fun setCommunicationDevice(device: AudioDeviceInfo): Boolean {
    if (device.id in rejected) return false
    communicationDevice = device
    return true
  }
  fun clearCommunicationDevice() { communicationDevice = null }
  fun getDevices(flags: Int) = availableCommunicationDevices.toTypedArray()
  fun startBluetoothSco() { scoStarts++ }
  fun stopBluetoothSco() { scoStops++ }
  companion object {
    const val MODE_IN_COMMUNICATION = 3
    const val GET_DEVICES_OUTPUTS = 2
  }
}
