package expo.modules.dronebrowser

import java.io.ByteArrayOutputStream
import java.net.Socket
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.Request
import okhttp3.Response
import okhttp3.Protocol
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/** JVM socket smoke test, runnable without an emulator or Android framework stubs. */
fun main() {
  responseFramingSmoke()
  realTransportSmoke()
  val requests = CopyOnWriteArrayList<String>()
  val cancelledPending = CountDownLatch(1)
  val pendingReceived = CountDownLatch(1)
  val factory = WebSocket.Factory { request, listener ->
    check(request.header("Authorization") == "Bearer " + "a".repeat(43))
    val socket = object : WebSocket {
      private val input = ByteArrayOutputStream()
      private var complete = false
      override fun request() = request
      override fun queueSize() = 0L
      override fun send(text: String): Boolean = error("Transport must use binary messages")
      override fun send(bytes: ByteString): Boolean {
        input.write(bytes.toByteArray())
        val value = input.toString("UTF-8")
        val boundary = value.indexOf("\r\n\r\n")
        if (boundary < 0 || complete) return true
        val header = value.substring(0, boundary)
        val length = Regex("content-length: ([0-9]+)", RegexOption.IGNORE_CASE).find(header)?.groupValues?.get(1)?.toInt() ?: 0
        val chunked = header.contains("transfer-encoding: chunked", true)
        if (chunked && !value.endsWith("0\r\n\r\n")) return true
        if (!chunked && value.length < boundary + 4 + length) return true
        complete = true
        requests.add(value)
        if (header.startsWith("GET /pending ")) { pendingReceived.countDown(); return true }
        val body = value.substring(boundary + 4)
        val location = if (header.startsWith("GET /protocol-relative ")) "//localhost:3000/next?q=1" else "http://localhost:3000/next?q=1"
        val response = "HTTP/1.1 200 OK\r\nContent-Length: ${body.toByteArray().size}\r\nLocation: $location\r\nSet-Cookie: app=yes; Domain=localhost; HttpOnly; Path=/\r\nSet-Cookie: __drone_browser_session=evil; Path=/\r\nAccess-Control-Allow-Origin: http://127.0.0.1:43000\r\nPermissions-Policy: fullscreen=(), camera=*\r\nFeature-Policy: fullscreen 'none'; microphone *\r\nConnection: keep-alive\r\n\r\n$body"
        // Fragment the headers and body across transport frames.
        response.toByteArray().toList().chunked(8192).forEach { listener.onMessage(this, it.toByteArray().toByteString()) }
        input.reset(); complete = false
        if (header.contains("Connection: close", true)) listener.onClosing(this, 1000, "")
        return true
      }
      override fun close(code: Int, reason: String?): Boolean = true
      override fun cancel() { if (input.toString("UTF-8").startsWith("GET /pending ")) cancelledPending.countDown() }
    }
    listener.onOpen(socket, Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(101).message("Switching Protocols").build())
    socket
  }
  val gateway = BrowserGateway("test", "wss://hub.example/api/device-mesh/v2/browser/test", "a".repeat(43), "127.0.0.1:43000", "/dashboard?q=1", factory, targetPort = 3000)
  try {
    val origin = URI(gateway.origin)
    fun exchange(path: String, headers: String = "", body: String = "", method: String = "GET"): String {
      return Socket(origin.host, origin.port).use { socket ->
        socket.soTimeout = 5000
        socket.getOutputStream().write("$method $path HTTP/1.1\r\nHost: ${origin.rawAuthority}\r\nConnection: close\r\n$headers\r\n$body".toByteArray())
        socket.getInputStream().readBytes().toString(Charsets.UTF_8)
      }
    }
    check(exchange("/").contains("403 Forbidden"))
    check(requests.isEmpty())
    val bootstrap = exchange(URI(gateway.bootstrapUrl).path)
    check(bootstrap.contains("Location: /dashboard?q=1"))
    val cookie = bootstrap.lineSequence().first { it.startsWith("Set-Cookie:") }.substringAfter(": ").substringBefore(';')
    check(bootstrap.contains("HttpOnly; SameSite=Strict"))
    check(!exchange(URI(gateway.bootstrapUrl).path).contains("302 Found"))
    val beforeReuse = gateway.diagnostics()
    Socket(origin.host, origin.port).use { socket ->
      socket.soTimeout = 5000
      val input = socket.getInputStream()
      fun readHead(): String {
        val text = StringBuilder()
        while (!text.endsWith("\r\n\r\n")) { val value = input.read(); check(value >= 0); text.append(value.toChar()) }
        return text.toString()
      }
      repeat(12) {
        socket.getOutputStream().write("GET /asset-$it HTTP/1.1\r\nHost: ${origin.rawAuthority}\r\nCookie: $cookie\r\n\r\n".toByteArray())
        check(readHead().contains("Connection: keep-alive"))
      }
      // Reuse must not bypass per-request cookie authentication.
      socket.getOutputStream().write("GET /denied HTTP/1.1\r\nHost: ${origin.rawAuthority}\r\n\r\n".toByteArray())
      check(readHead().contains("403 Forbidden"))
    }
    val afterReuse = gateway.diagnostics()
    check((afterReuse["tunnelsOpened"] as Long) - (beforeReuse["tunnelsOpened"] as? Long ?: 0) == 1L)
    check(afterReuse["reusedRequests"] == 11L)
    check(afterReuse["completedRequests"] == 12L)
    check(!afterReuse.toString().contains(cookie))
    val body = "large-post-body-".repeat(65536)
    val response = exchange("/api/save", "Cookie: $cookie; app=existing\r\nOrigin: ${gateway.origin}\r\nContent-Length: ${body.length}\r\n", body, "POST")
    check(response.substringAfter("\r\n\r\n") == body)
    check(response.contains("Location: ${gateway.origin}/next?q=1"))
    check(response.contains("Access-Control-Allow-Origin: ${gateway.origin}"))
    check(response.contains("Set-Cookie: app=yes; HttpOnly; Path=/"))
    check(!response.contains("__drone_browser_session=evil"))
    check(response.contains("Connection: close"))
    check(requests.last().contains("Host: 127.0.0.1:43000"))
    check(requests.last().contains("Cookie: app=existing"))
    check(!requests.last().contains(cookie))
    check(!requests.last().contains("Bearer"))
    check(response.contains("Permissions-Policy: fullscreen=(), camera=(), microphone=(), geolocation=()"))
    check(response.contains("Feature-Policy: fullscreen 'none'; camera 'none'; microphone 'none'; geolocation 'none'"))
    check(exchange("/protocol-relative", "Cookie: $cookie\r\n").contains("Location: ${gateway.origin}/next?q=1"))
    Socket(origin.host, origin.port).use { socket ->
      socket.getOutputStream().write("GET /pending HTTP/1.1\r\nHost: ${origin.rawAuthority}\r\nCookie: $cookie\r\n\r\n".toByteArray())
      check(pendingReceived.await(2, TimeUnit.SECONDS))
    }
    check(cancelledPending.await(2, TimeUnit.SECONDS)) { "Aborted requests must release a silent upstream tunnel" }
    val before = requests.size
    check(exchange("/", "Cookie: $cookie\r\nOrigin: https://other.example\r\n").isEmpty())
    check(requests.size == before)
    val chunks = "4\r\nbody\r\n0\r\n\r\n"
    val chunked = exchange("/upload", "Cookie: $cookie\r\nTransfer-Encoding: chunked\r\n", chunks, "POST")
    check(chunked.substringAfter("\r\n\r\n") == chunks)
    val next = BrowserGateway("next", "wss://hub.example/api/device-mesh/v2/browser/next", "a".repeat(43), "127.0.0.1:3000", "/", factory)
    try {
      val other = URI(next.origin)
      val denied = Socket(other.host, other.port).use { socket ->
        socket.soTimeout = 5000
        socket.getOutputStream().write("GET / HTTP/1.1\r\nHost: ${other.rawAuthority}\r\nCookie: $cookie\r\n\r\n".toByteArray())
        socket.getInputStream().readBytes().toString(Charsets.UTF_8)
      }
      check(denied.contains("403 Forbidden"))
    } finally { next.close() }
    val creating = CountDownLatch(1)
    val returnTunnel = CountDownLatch(1)
    val cancelledDuringClose = CountDownLatch(1)
    val closingFactory = WebSocket.Factory { request, _ ->
      creating.countDown()
      check(returnTunnel.await(2, TimeUnit.SECONDS))
      object : WebSocket {
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String) = false
        override fun send(bytes: ByteString) = false
        override fun close(code: Int, reason: String?) = true
        override fun cancel() { cancelledDuringClose.countDown() }
      }
    }
    val closing = BrowserGateway("closing", "wss://hub.example/api/device-mesh/v2/browser/closing", "a".repeat(43), "127.0.0.1:3000", "/", closingFactory)
    try {
      val local = URI(closing.origin)
      val bootstrapResponse = Socket(local.host, local.port).use { socket ->
        socket.soTimeout = 5000
        socket.getOutputStream().write("GET ${URI(closing.bootstrapUrl).path} HTTP/1.1\r\nHost: ${local.rawAuthority}\r\n\r\n".toByteArray())
        socket.getInputStream().readBytes().toString(Charsets.UTF_8)
      }
      val localCookie = bootstrapResponse.lineSequence().first { it.startsWith("Set-Cookie:") }.substringAfter(": ").substringBefore(';')
      Socket(local.host, local.port).use { socket ->
        socket.getOutputStream().write("GET / HTTP/1.1\r\nHost: ${local.rawAuthority}\r\nCookie: $localCookie\r\n\r\n".toByteArray())
        check(creating.await(2, TimeUnit.SECONDS))
        closing.close()
        returnTunnel.countDown()
        check(cancelledDuringClose.await(2, TimeUnit.SECONDS)) { "Shutdown must cancel a tunnel created concurrently" }
      }
    } finally { returnTunnel.countDown(); closing.close() }
    println("Browser gateway smoke passed: bootstrap, request authentication, large POST, chunked upload, cookies, mapped-port redirects, CORS, session isolation, cancellation, capture policy.")
  } finally { gateway.close() }
}

private fun responseFramingSmoke() {
  fun parse(raw: String, method: String = "GET", requestedUpgrade: Boolean = false): Pair<String, Boolean> {
    val output = ByteArrayOutputStream()
    var reuse = false
    val response = BrowserResponse(method, requestedUpgrade, false, output,
      { h, _, _ -> h }, {}, { r, _ -> reuse = r })
    // Every header, chunk-size, CRLF, trailer and body boundary can split across frames.
    for (byte in raw.toByteArray()) response.accept(byteArrayOf(byte))
    check(response.end())
    return output.toString("UTF-8") to reuse
  }
  val chunks = "4;extension=yes\r\nbody\r\n0\r\nx-trailer: done\r\n\r\n"
  val chunked = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n$chunks"
  check(parse(chunked) == (chunked to true))
  val fixed = "HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nbody"
  check(parse(fixed) == (fixed to true))
  check(parse("HTTP/1.1 103 Early Hints\r\nLink: </a>\r\n\r\n$fixed") == (fixed to true))
  check(parse("HTTP/1.1 200 OK\r\nContent-Length: 42\r\n\r\n", "HEAD").second)
  check(parse("HTTP/1.1 304 Not Modified\r\n\r\n").second)
  check(parse("HTTP/1.1 204 No Content\r\n\r\n").second)
  check(!parse("HTTP/1.1 200 OK\r\n\r\nbody").second)
  check(!parse("HTTP/1.0 200 OK\r\nContent-Length: 0\r\n\r\n").second)
  check(!parse("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").second)
  check(!parse("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nframes", requestedUpgrade = true).second)
  for (bad in listOf(
    "HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nbo",
    "HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\na",
    "HTTP/1.1 200 OK\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\na",
    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\nextra",
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
  )) check(runCatching { parse(bad) }.isFailure) { "Must reject malformed or truncated response" }
}

private fun realTransportSmoke() {
  val server = ProcessBuilder("node", System.getProperty("browser.testServer")).redirectError(ProcessBuilder.Redirect.INHERIT).start()
  val client = okhttp3.OkHttpClient.Builder().readTimeout(0, TimeUnit.SECONDS).build()
  var gateway: BrowserGateway? = null
  try {
    val port = server.inputStream.bufferedReader().readLine().toInt()
    // Only this isolated fixture downgrades WSS to loopback WS; production still requires TLS.
    val factory = WebSocket.Factory { request, listener ->
      client.newWebSocket(request.newBuilder().url(request.url.newBuilder().scheme("http").build()).build(), listener)
    }
    val next = BrowserGateway("wire", "wss://127.0.0.1:$port/api/device-mesh/v2/browser/wire", "a".repeat(43), "127.0.0.1:3000", "/", factory)
    gateway = next
    val local = URI(next.origin)
    val bootstrap = Socket(local.host, local.port).use { socket ->
      socket.soTimeout = 5000
      socket.getOutputStream().write("GET ${URI(next.bootstrapUrl).path} HTTP/1.1\r\nHost: ${local.rawAuthority}\r\n\r\n".toByteArray())
      socket.getInputStream().readBytes().toString(Charsets.UTF_8)
    }
    val cookie = bootstrap.lineSequence().first { it.startsWith("Set-Cookie:") }.substringAfter(": ").substringBefore(';')
    Socket(local.host, local.port).use { socket ->
      socket.soTimeout = 10000
      val input = socket.getInputStream().buffered()
      repeat(4) { index ->
        val body = if (index == 3) "upload".repeat(100000) else ""
        val method = if (body.isEmpty()) "GET" else "POST"
        socket.getOutputStream().write("$method /asset HTTP/1.1\r\nHost: ${local.rawAuthority}\r\nCookie: $cookie\r\nContent-Length: ${body.length}\r\n\r\n$body".toByteArray())
        val header = StringBuilder()
        while (!header.endsWith("\r\n\r\n")) { val byte = input.read(); check(byte >= 0); header.append(byte.toChar()) }
        check(header.contains("Connection: keep-alive"))
        val length = Regex("content-length: ([0-9]+)", RegexOption.IGNORE_CASE).find(header)!!.groupValues[1].toInt()
        val response = input.readNBytes(length).toString(Charsets.UTF_8)
        check(response == if (body.isEmpty()) "browser-asset-".repeat(50000) else body.length.toString())
      }
    }
    val metrics = next.diagnostics()
    check(metrics["tunnelsOpened"] == 1L)
    check(metrics["compressedTunnels"] == 1L)
    check(metrics["reusedRequests"] == 3L)
    check(metrics["completedRequests"] == 4L)
    println("Real OkHttp transport passed: compression negotiated, 4 requests on 1 tunnel, streamed 600 KB upload and 1.95 MB responses.")
  } finally {
    gateway?.close(); client.dispatcher.cancelAll(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown()
    server.destroyForcibly(); server.waitFor(5, TimeUnit.SECONDS)
  }
}
