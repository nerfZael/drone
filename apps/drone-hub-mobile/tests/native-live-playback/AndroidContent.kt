package android.content
import android.media.AudioManager

class Context {
  val audioManager = AudioManager()
  val bluetoothManager = android.bluetooth.BluetoothManager()
  var bluetoothPermission = true
  var receiver: BroadcastReceiver? = null
  fun <T> getSystemService(type: Class<T>): T = type.cast(if (type == AudioManager::class.java) audioManager else bluetoothManager)
  fun unregisterReceiver(value: BroadcastReceiver) { check(receiver === value); receiver = null }
}
abstract class BroadcastReceiver { abstract fun onReceive(context: Context, intent: Intent) }
class Intent(val action: String = "", val extras: Map<String, Any> = emptyMap()) {
  fun getIntExtra(key: String, fallback: Int) = extras[key] as? Int ?: fallback
  @Suppress("UNCHECKED_CAST") fun <T> getParcelableExtra(key: String): T? = extras[key] as? T
  companion object { const val EXTRA_KEY_EVENT = "key" }
}
class IntentFilter(action: String) { fun addAction(action: String) {} }
