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
        listener.onClosing(this, 1000, "")
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
        socket.getOutputStream().write("$method $path HTTP/1.1\r\nHost: ${origin.rawAuthority}\r\n$headers\r\n$body".toByteArray())
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
