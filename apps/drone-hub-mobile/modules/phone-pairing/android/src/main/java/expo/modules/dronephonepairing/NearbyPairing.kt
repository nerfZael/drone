package expo.modules.dronephonepairing

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** All mutable state and callbacks are serialized on the main thread. Ads are untrusted hints. */
@Suppress("DEPRECATION")
class NearbyPairing(context: Context, private val emit: (String, Map<String, Any>) -> Unit) {
  private val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val handler = Handler(Looper.getMainLooper())
  private var generation = 0
  private var discovery: NsdManager.DiscoveryListener? = null
  private var registration: NsdManager.RegistrationListener? = null

  fun stop() { handler.post { stopNow() } }
  private fun stopNow() {
    generation++
    discovery?.let { try { manager.stopServiceDiscovery(it) } catch (_: Exception) {} }
    registration?.let { try { manager.unregisterService(it) } catch (_: Exception) {} }
    discovery = null
    registration = null
  }

  fun start(descriptor: String) { handler.post {
    stopNow()
    val current = generation
    val session = JSONObject(descriptor).getString("session")
    fun event(name: String, body: String) { emit(name, mapOf("body" to body, "session" to session)) }
    val pending = java.util.ArrayDeque<NsdServiceInfo>()
    val present = mutableSetOf<String>()
    val retries = mutableMapOf<String, Int>()
    var resolving = false
    fun report(message: String) { if (generation == current) event("nearbyError", message) }
    fun resolveNext() {
      if (generation != current || resolving || pending.isEmpty()) return
      val info = pending.removeFirst()
      resolving = true
      try {
        manager.resolveService(info, object : NsdManager.ResolveListener {
          override fun onResolveFailed(service: NsdServiceInfo, code: Int) { handler.post {
            if (generation != current) return@post
            val attempts = retries[info.serviceName] ?: 0
            if (code == NsdManager.FAILURE_ALREADY_ACTIVE && present.contains(info.serviceName) && attempts < 8) {
              // Android cannot cancel an old resolve; a rapid Stop/Start can overlap it.
              retries[info.serviceName] = attempts + 1
              handler.postDelayed({
                if (generation == current) {
                  resolving = false
                  if (present.contains(info.serviceName)) pending.addFirst(info)
                  resolveNext()
                }
              }, 1000)
            } else { resolving = false; resolveNext() }
          } }
          override fun onServiceResolved(service: NsdServiceInfo) { handler.post {
            if (generation != current) return@post
            resolving = false
            if (present.contains(service.serviceName)) {
              val attrs = service.attributes.mapValues { String(it.value, Charsets.UTF_8) }
              if (attrs["v"] == "1" && attrs["kind"] == "hub") {
                val endpoint = attrs["endpoint"] ?: ""
                val id = attrs["id"] ?: ""
                if (endpoint.length in 1..240 && id.length in 1..128) event("nearbyHub",
                  JSONObject(mapOf("key" to service.serviceName, "id" to id,
                    "name" to (attrs["name"] ?: service.serviceName).take(80), "endpoint" to endpoint)).toString())
              }
            }
            resolveNext()
          } }
        })
      } catch (error: Exception) { resolving = false; report("Could not resolve nearby Hub: ${error.message}") }
    }
    try {
      val device = JSONObject(descriptor).getJSONObject("device")
      val service = NsdServiceInfo().apply {
        serviceName = "DronePhone-${device.getString("id").take(24)}"
        serviceType = "_dronehub._tcp."
        port = 8792
        setAttribute("v", "1")
        setAttribute("kind", "phone")
      }
      val ad = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) {
          handler.post { if (generation != current) try { manager.unregisterService(this) } catch (_: Exception) {} }
        }
        override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) { handler.post { report("Phone Wi-Fi advertising unavailable ($code). Tailscale discovery is still available.") } }
        override fun onServiceUnregistered(info: NsdServiceInfo) {}
        override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
      }
      registration = ad
      manager.registerService(service, NsdManager.PROTOCOL_DNS_SD, ad)
      val browser = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(type: String) {}
        override fun onDiscoveryStopped(type: String) {}
        override fun onStartDiscoveryFailed(type: String, code: Int) { handler.post { report("Wi-Fi discovery unavailable ($code). Check local-network access, or use a QR code or Hub address.") } }
        override fun onStopDiscoveryFailed(type: String, code: Int) {}
        override fun onServiceFound(info: NsdServiceInfo) { handler.post {
          if (generation != current || present.size >= 100 || !present.add(info.serviceName)) return@post
          pending.add(info)
          resolveNext()
        } }
        override fun onServiceLost(info: NsdServiceInfo) { handler.post {
          if (generation != current) return@post
          present.remove(info.serviceName)
          retries.remove(info.serviceName)
          pending.removeAll { it.serviceName == info.serviceName }
          event("nearbyLost", info.serviceName)
        } }
      }
      discovery = browser
      manager.discoverServices("_dronehub._tcp.", NsdManager.PROTOCOL_DNS_SD, browser)
    } catch (error: Exception) { report("Wi-Fi discovery unavailable: ${error.message}. Use a QR code or Hub address.") }
  } }
}
