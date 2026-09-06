package expo.modules.dronebrowser

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/** One HTTP request per local connection (or one upgraded WebSocket). Bodies stay streamed.
 * A distinct loopback IP isolates cookies between sessions. A bootstrap cookie authenticates
 * ALL local resource requests; neither this cookie nor the Hub bearer reaches the web app.
 */
internal class BrowserGateway(
  val sessionId: String, private val tunnelUrl: String, private val token: String,
  private val authority: String, private val initialPath: String,
  private val webSockets: WebSocket.Factory? = null,
  private val targetPort: Int = authority.substringAfter(':').toInt(),
) {
  private val cookieName = "__drone_browser_session"
  private val secret = randomHex(32)
  private val bootstrap = "/__drone_browser_bootstrap/${randomHex(32)}"
  private val server = ServerSocket()
  private val sockets = ConcurrentHashMap.newKeySet<Socket>()
  private val tunnels = ConcurrentHashMap.newKeySet<WebSocket>()
  private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS)
    .followRedirects(false).followSslRedirects(false).build()
  @Volatile private var closed = false
  @Volatile private var bootstrapped = false
  val origin: String
  val bootstrapUrl: String

  init {
    val remote = URI(tunnelUrl)
    require(remote.scheme == "wss" && remote.host != null && remote.userInfo == null && remote.query == null && remote.fragment == null)
    require(remote.path == "/api/device-mesh/v2/browser/$sessionId")
    require(token.matches(Regex("[A-Za-z0-9_-]{40,64}")))
    require(authority.matches(Regex("127\\.0\\.0\\.1:[0-9]{1,5}")))
    require(authority.substringAfter(':').toInt() in 1..65535)
    require(targetPort in 1..65535)
    require(initialPath.startsWith('/') && !initialPath.startsWith("//") && initialPath.none { it == '\\' || it.code < 32 || it.code == 127 })
    val address = "127.0.0.${2 + SecureRandom().nextInt(253)}"
    server.bind(InetSocketAddress(InetAddress.getByName(address), 0), 32)
    origin = "http://$address:${server.localPort}"
    bootstrapUrl = origin + bootstrap
    Thread({
      while (!closed) {
        try {
          val socket = server.accept()
          val admitted = synchronized(this) {
            if (closed || sockets.size >= 32) false else { sockets.add(socket); true }
          }
          if (!admitted) { socket.close(); continue }
          Thread({
            try { serve(socket) } catch (_: Exception) { /* Socket closure is surfaced by WebView. */ }
            finally { sockets.remove(socket); try { socket.close() } catch (_: Exception) {} }
          }, "drone-browser-request").apply { isDaemon = true; start() }
        } catch (_: Exception) { if (!closed) close() }
      }
    }, "drone-browser-listener").apply { isDaemon = true; start() }
  }

  fun close() {
    synchronized(this) { if (closed) return; closed = true }
    try { server.close() } catch (_: Exception) {}
    tunnels.forEach { it.cancel() }
    sockets.forEach { try { it.close() } catch (_: Exception) {} }
    client.dispatcher.cancelAll()
    client.connectionPool.evictAll()
    client.dispatcher.executorService.shutdown()
  }

  private fun serve(socket: Socket) {
    socket.soTimeout = 30_000
    val input = socket.getInputStream()
    val lines = readHeader(input).split("\r\n")
    val request = lines.first().split(' ')
    require(request.size == 3 && request[2] == "HTTP/1.1")
    require(request[0] in listOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"))
    require(request[1].startsWith('/') && !request[1].startsWith("//"))
    val headers = parseHeaders(lines.drop(1))
    require(headers["host"] == origin.removePrefix("http://"))
    val requestOrigin = headers["origin"]
    require(requestOrigin == null || requestOrigin == origin)
    require(headers["sec-fetch-site"] != "cross-site")
    val output = socket.getOutputStream()
    if (request[0] == "GET" && request[1] == bootstrap && !bootstrapped) {
      synchronized(this) { require(!bootstrapped); bootstrapped = true }
      output.write(("HTTP/1.1 302 Found\r\nLocation: $initialPath\r\nSet-Cookie: $cookieName=$secret; HttpOnly; SameSite=Strict; Path=/\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
      output.flush()
      return
    }
    val cookies = headers["cookie"].orEmpty().split(';').map { it.trim() }
    if (!cookies.contains("$cookieName=$secret")) {
      output.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); return
    }
    val upgraded = headers["upgrade"]?.equals("websocket", true) == true
    require(headers["upgrade"] == null || upgraded)
    val length = headers["content-length"]?.toLong()?.also { require(it in 0..(512L * 1024 * 1024)) }
    val chunked = headers["transfer-encoding"] != null
    require(!chunked || (headers["transfer-encoding"]?.lowercase() == "chunked" && length == null))
    require(headers["expect"] == null)
    val rewritten = StringBuilder("${lines.first()}\r\n")
    for ((name, value) in headers) {
      when (name) {
        "host" -> rewritten.append("Host: $authority\r\n")
        "origin" -> rewritten.append("Origin: http://$authority\r\n")
        "referer" -> rewritten.append("Referer: ${value.replace(origin, "http://$authority")}\r\n")
        "cookie" -> {
          val appCookies = cookies.filter { it.substringBefore('=') != cookieName }.joinToString("; ")
          if (appCookies.isNotEmpty()) rewritten.append("Cookie: $appCookies\r\n")
        }
        "connection" -> if (upgraded) rewritten.append("Connection: Upgrade\r\n")
        "proxy-authorization", "proxy-connection" -> {}
        else -> rewritten.append("$name: $value\r\n")
      }
    }
    if (!upgraded) rewritten.append("Connection: close\r\n")
    rewritten.append("\r\n")
    val opened = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val failed = AtomicBoolean(false)
    val responseHeader = ByteArrayOutputStream()
    var headerComplete = false
    var headerEnding = 0
    val tunnel = (webSockets ?: client).newWebSocket(Request.Builder().url(tunnelUrl).header("Authorization", "Bearer $token").build(), object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) { opened.countDown() }
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        try {
          val data = bytes.toByteArray()
          var offset = 0
          while (!headerComplete && offset < data.size) {
            val value = data[offset++].toInt() and 255
            responseHeader.write(value)
            require(responseHeader.size() <= 65536)
            headerEnding = when { headerEnding == 0 && value == 13 -> 1; headerEnding == 1 && value == 10 -> 2; headerEnding == 2 && value == 13 -> 3; headerEnding == 3 && value == 10 -> 4; value == 13 -> 1; else -> 0 }
            if (headerEnding == 4) {
              val text = responseHeader.toString("ISO-8859-1")
              val status = text.substringBefore("\r\n").split(' ').getOrNull(1)?.toIntOrNull() ?: 0
              if (status in 100..199 && status != 101) { responseHeader.reset(); headerEnding = 0; continue }
              output.write(rewriteResponse(text, status == 101).toByteArray(Charsets.ISO_8859_1))
              headerComplete = true
            }
          }
          if (offset < data.size) output.write(data, offset, data.size - offset)
          output.flush()
        } catch (_: Exception) { failed.set(true); webSocket.cancel(); finished.countDown(); try { socket.close() } catch (_: Exception) {} }
      }
      override fun onMessage(webSocket: WebSocket, text: String) { failed.set(true); webSocket.cancel(); finished.countDown() }
      override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, null); finished.countDown(); try { socket.close() } catch (_: Exception) {} }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { finished.countDown(); try { socket.close() } catch (_: Exception) {} }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { failed.set(true); opened.countDown(); finished.countDown(); try { socket.close() } catch (_: Exception) {} }
    })
    synchronized(this) { if (closed) tunnel.cancel() else tunnels.add(tunnel) }
    try {
      require(!closed && opened.await(12, TimeUnit.SECONDS) && !failed.get() && !closed)
      fun send(bytes: ByteArray, count: Int = bytes.size) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        while (tunnel.queueSize() > 128 * 1024 && !closed && !failed.get()) {
          require(System.nanoTime() < deadline); Thread.sleep(5)
        }
        require(!closed && !failed.get() && tunnel.send(bytes.toByteString(0, count)))
      }
      send(rewritten.toString().toByteArray(Charsets.ISO_8859_1))
      val buffer = ByteArray(16 * 1024)
      fun copy(count: Long) {
        var remaining = count
        while (remaining > 0) {
          val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
          require(read > 0); send(buffer, read); remaining -= read
        }
      }
      if (chunked) {
        var total = 0L
        while (true) {
          val line = readLine(input)
          val size = line.substringBefore(';').toLong(16)
          require(size >= 0 && size <= 512L * 1024 * 1024 - total)
          total += size; send((line + "\r\n").toByteArray())
          if (size == 0L) {
            // Forward bounded trailers, ending with the empty line.
            var trailerBytes = 0
            do { val trailer = readLine(input); trailerBytes += trailer.length + 2; require(trailerBytes <= 16384); send((trailer + "\r\n").toByteArray()); if (trailer.isEmpty()) break } while (true)
            break
          }
          copy(size)
          require(input.read() == 13 && input.read() == 10); send(byteArrayOf(13, 10))
        }
      } else if (length != null) copy(length)
      if (upgraded) {
        socket.soTimeout = 0
        while (!closed && !failed.get() && finished.count > 0) {
          val read = input.read(buffer); if (read < 0) break; send(buffer, read)
        }
      } else {
        // Monitor the WebView connection while the transport reader writes the response.
        // An aborted fetch/navigation must release its tunnel even if upstream stays silent.
        // We deliberately do not forward another pipelined request on this connection.
        socket.soTimeout = 0
        if (!socket.isClosed) input.read()
      }
    } finally { tunnels.remove(tunnel); tunnel.cancel() }
  }

  private fun rewriteResponse(header: String, upgraded: Boolean): String {
    val lines = header.split("\r\n")
    val result = StringBuilder(lines.first() + "\r\n")
    var permissionsPolicy = ""
    var featurePolicy = ""
    for (line in lines.drop(1).filter { it.isNotEmpty() }) {
      val name = line.substringBefore(':').lowercase()
      val value = line.substringAfter(':').trim()
      when (name) {
        "permissions-policy" -> permissionsPolicy += ",$value"
        "feature-policy" -> featurePolicy += ";$value"
        "access-control-allow-origin" -> result.append("Access-Control-Allow-Origin: ${if (value == "http://$authority") origin else value}\r\n")
        "connection" -> if (upgraded) result.append("Connection: Upgrade\r\n")
        "location" -> {
          val location = try {
            val raw = URI(value)
            val uri = if (raw.rawAuthority != null && raw.scheme == null) URI("http:$value") else raw
            val port = if (uri.port == -1 && uri.scheme == "http") 80 else uri.port
            if (uri.scheme == "http" && uri.userInfo == null && uri.host in listOf("127.0.0.1", "localhost", "[::1]") && port in listOf(authority.substringAfter(':').toInt(), targetPort))
              origin + (uri.rawPath.orEmpty().ifEmpty { "/" }) + (uri.rawQuery?.let { "?$it" } ?: "") + (uri.rawFragment?.let { "#$it" } ?: "")
            else value
          } catch (_: Exception) { value }
          result.append("Location: $location\r\n")
        }
        "set-cookie" -> if (value.substringBefore('=').trim() != cookieName) {
          result.append("Set-Cookie: ${value.replace(Regex(";\\s*Domain=[^;]*", RegexOption.IGNORE_CASE), "")}\r\n")
        }
        else -> result.append(line + "\r\n")
      }
    }
    // Android WebView otherwise inherits this app's already-granted recording permissions.
    // Preserve other upstream restrictions while denying capture in preview documents.
    result.append("Permissions-Policy: ${denyCapture(permissionsPolicy, false)}\r\n")
    result.append("Feature-Policy: ${denyCapture(featurePolicy, true)}\r\n")
    if (!upgraded) result.append("Connection: close\r\n")
    return result.append("\r\n").toString()
  }

  private fun denyCapture(policy: String, legacy: Boolean): String {
    val blocked = listOf("camera", "microphone", "geolocation")
    val separator = if (legacy) ';' else ','
    val retained = policy.split(separator).map { it.trim() }.filter {
      it.isNotEmpty() && it.substringBefore(if (legacy) ' ' else '=').trim() !in blocked
    }
    return (retained + blocked.map { if (legacy) "$it 'none'" else "$it=()" }).joinToString("$separator ")
  }

  private fun parseHeaders(lines: List<String>): Map<String, String> {
    val result = mutableMapOf<String, String>()
    for (line in lines.filter { it.isNotEmpty() }) {
      val colon = line.indexOf(':'); require(colon > 0)
      val key = line.substring(0, colon).lowercase()
      require(key.matches(Regex("[a-z0-9!#$%&'*+.^_`|~-]+")) && !result.containsKey(key))
      result[key] = line.substring(colon + 1).trim()
    }
    return result
  }
  private fun readHeader(input: InputStream): String {
    val result = StringBuilder()
    while (true) {
      val line = readLine(input); result.append(line + "\r\n")
      require(result.length <= 65536)
      if (line.isEmpty()) return result.toString()
    }
  }
  private fun readLine(input: InputStream): String {
    val result = ByteArrayOutputStream()
    while (true) {
      val value = input.read(); require(value >= 0 && result.size() < 16384)
      if (value == 13) { require(input.read() == 10); return result.toString("ISO-8859-1") }
      require(value != 10); result.write(value)
    }
  }
  private fun randomHex(size: Int): String = ByteArray(size).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
}
