package expo.modules.dronephonepairing

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.ServerSocket
import java.net.Socket
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.io.ByteArrayOutputStream
import android.os.SystemClock

/** Foreground-only bootstrap. No files, commands, credentials, or ordinary mesh traffic. */
class PhonePairingModule : Module() {
  @Volatile private var listener: ServerSocket? = null
  @Volatile private var client: Socket? = null
  @Volatile private var foreground = true
  private var nearby: NearbyPairing? = null
  private var listenerSession = ""
  @Volatile private var listenerDescriptor = ""
  @Volatile private var proofDeadline = 0L

  override fun definition() = ModuleDefinition {
    Name("DronePhonePairing")
    Events("offer", "stopped", "nearbyHub", "nearbyLost", "nearbyError")
    AsyncFunction("start") { descriptor: String -> startListener(descriptor) }
    AsyncFunction("refresh") { descriptor: String -> refreshDescriptor(descriptor) }
    AsyncFunction("stop") { stopListener() }
    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground { foreground = false; stopListener() }
    OnDestroy { stopListener() }
  }

  @Synchronized private fun stopListener() {
    nearby?.stop()
    val old = listener
    val oldSession = listenerSession
    listenerSession = ""
    listenerDescriptor = ""
    proofDeadline = 0L
    listener = null
    try { old?.close() } catch (_: Exception) {}
    try { client?.close() } catch (_: Exception) {}
    client = null
    if (old != null) sendEvent("stopped", mapOf("session" to oldSession))
  }

  @Synchronized private fun refreshDescriptor(descriptor: String) {
    require(foreground && listener != null) { "Discovery is no longer active" }
    require(descriptor.toByteArray(Charsets.UTF_8).size <= 8192) { "Pairing descriptor is too large" }
    require(org.json.JSONObject(descriptor).getString("session") == listenerSession) { "Stale discovery session" }
    listenerDescriptor = descriptor
    // Fail closed if JS stops renewing proofs, without timing out a healthy foreground screen.
    proofDeadline = SystemClock.elapsedRealtime() + 120000
  }

  @Synchronized private fun startListener(descriptor: String) {
    require(foreground) { "Keep DroneHub in the foreground to make this phone discoverable" }
    require(descriptor.toByteArray(Charsets.UTF_8).size <= 8192) { "Pairing descriptor is too large" }
    val session = org.json.JSONObject(descriptor).getString("session")
    stopListener()
    val server = ServerSocket()
    try {
      server.reuseAddress = true
      // Mobile VPN implementations can forward to loopback; wildcard supports that path too.
      // Only public signed bootstrap metadata is exposed on other interfaces.
      server.bind(InetSocketAddress(8792), 4)
      server.soTimeout = 1000
    } catch (error: Exception) { server.close(); throw error }
    listener = server
    listenerSession = session
    refreshDescriptor(descriptor)
    if (nearby == null) nearby = NearbyPairing(requireNotNull(appContext.reactContext)) { event, body -> sendEvent(event, body) }
    nearby?.start(descriptor)
    Thread({
      var requests = 0
      var windowStart = SystemClock.elapsedRealtime()
      try {
        while (listener === server && SystemClock.elapsedRealtime() < proofDeadline) {
          try {
            val socket = server.accept()
            synchronized(this) {
              if (listener !== server) { socket.close(); return@Thread }
              client = socket
            }
            if (SystemClock.elapsedRealtime() - windowStart >= 120000) {
              requests = 0
              windowStart = SystemClock.elapsedRealtime()
            }
            if (requests >= 64) {
              socket.close()
              Thread.sleep(100)
              continue
            }
            socket.use { requests++; serve(it, listenerDescriptor, proofDeadline) }
          } catch (_: SocketTimeoutException) {
          } catch (_: Exception) {
            // Malformed or disconnected clients cannot escape this bounded session.
          }
        }
      } finally {
        synchronized(this) { if (listener === server) stopListener() }
      }
    }, "drone-phone-pairing").apply { isDaemon = true; start() }
  }

  private fun serve(socket: Socket, descriptor: String, sessionDeadline: Long) {
    socket.soTimeout = 1000
    val deadline = minOf(sessionDeadline, SystemClock.elapsedRealtime() + 3000)
    val input = socket.getInputStream()
    val header = ByteArrayOutputStream()
    var ending = 0
    while (ending != 4) {
      require(SystemClock.elapsedRealtime() < deadline && header.size() < 8192)
      val value = input.read()
      require(value >= 0)
      header.write(value)
      ending = when { ending == 0 && value == 13 -> 1; ending == 1 && value == 10 -> 2; ending == 2 && value == 13 -> 3; ending == 3 && value == 10 -> 4; value == 13 -> 1; else -> 0 }
    }
    val lines = header.toString("US-ASCII").split("\r\n")
    val request = lines[0].split(" ")
    require(request.size == 3 && request[2] == "HTTP/1.1")
    val headers = mutableMapOf<String, String>()
    for (line in lines.drop(1).filter { it.isNotEmpty() }) {
      val colon = line.indexOf(':'); require(colon > 0)
      val key = line.substring(0, colon).lowercase()
      require(!headers.containsKey(key))
      headers[key] = line.substring(colon + 1).trim()
    }
    require(!headers.containsKey("transfer-encoding"))
    var status = "404 Not Found"
    var body = "{}"
    if (request[0] == "GET" && request[1] == "/.well-known/dronehub-phone") {
      status = "200 OK"; body = descriptor
    } else if (request[0] == "POST" && request[1] == "/offer") {
      val length = headers["content-length"]?.toIntOrNull() ?: 0
      require(length in 1..8192)
      val bytes = ByteArray(length)
      var offset = 0
      while (offset < length) {
        require(SystemClock.elapsedRealtime() < deadline)
        val count = input.read(bytes, offset, length - offset); require(count > 0); offset += count
      }
      // JS checks signature, session, expiry and identity before displaying confirmation.
      sendEvent("offer", mapOf("body" to String(bytes, Charsets.UTF_8)))
      status = "202 Accepted"
    }
    val bytes = body.toByteArray(Charsets.UTF_8)
    val output = socket.getOutputStream()
    output.write("HTTP/1.1 $status\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
    output.write(bytes)
    output.flush()
  }
}
