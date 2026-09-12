package androidx.core.content
import android.content.*
object ContextCompat {
  const val RECEIVER_EXPORTED = 2
  fun checkSelfPermission(context: Context, permission: String) = if (context.bluetoothPermission) 0 else -1
  fun registerReceiver(context: Context, receiver: BroadcastReceiver, filter: IntentFilter, flags: Int): Intent? {
    context.receiver = receiver
    return null
  }
}
