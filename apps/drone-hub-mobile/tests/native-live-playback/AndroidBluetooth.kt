package android.bluetooth
import android.content.Context
interface BluetoothProfile {
  interface ServiceListener {
    fun onServiceConnected(profile: Int, proxy: BluetoothProfile)
    fun onServiceDisconnected(profile: Int)
  }
  companion object { const val HEADSET = 1; const val EXTRA_STATE = "bluetoothState" }
}
data class BluetoothDevice(val address: String) {
  companion object { const val EXTRA_DEVICE = "bluetoothDevice" }
}
class BluetoothManager { val adapter = BluetoothAdapter() }
class BluetoothAdapter {
  val headset = BluetoothHeadset()
  var listener: BluetoothProfile.ServiceListener? = null
  var closed = 0
  fun getProfileProxy(context: Context, value: BluetoothProfile.ServiceListener, profile: Int): Boolean {
    listener = value
    return true
  }
  fun deliver() { listener!!.onServiceConnected(BluetoothProfile.HEADSET, headset) }
  fun closeProfileProxy(profile: Int, proxy: BluetoothProfile) { closed++ }
}
class BluetoothHeadset : BluetoothProfile {
  val connectedDevices = listOf(BluetoothDevice("headset"))
  var audioConnected = false
  var supported = true
  var startAccepted = true
  val calls = mutableListOf<String>()
  fun isVoiceRecognitionSupported(device: BluetoothDevice) = supported
  fun isAudioConnected(device: BluetoothDevice) = audioConnected
  fun startVoiceRecognition(device: BluetoothDevice): Boolean { calls.add("start"); return startAccepted }
  fun stopVoiceRecognition(device: BluetoothDevice): Boolean { calls.add("stop"); return true }
  companion object {
    const val ACTION_AUDIO_STATE_CHANGED = "bluetoothAudio"
    const val STATE_AUDIO_CONNECTED = 12; const val STATE_AUDIO_DISCONNECTED = 10
  }
}
