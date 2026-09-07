package expo.modules.dronebrowser

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.concurrent.CountDownLatch

/** Incremental HTTP/1 response framing. Never buffers a body or assumes one frame is one response. */
internal class BrowserResponse(
  private val method: String,
  private val requestedUpgrade: Boolean,
  private val requestClose: Boolean,
  private val output: OutputStream,
  private val rewrite: (String, Boolean, Boolean) -> String,
  private val onFirstByte: () -> Unit,
  private val onComplete: (Boolean, Int) -> Unit,
) {
  val finished = CountDownLatch(1)
  @Volatile var complete = false
    private set
  @Volatile var upgraded = false
    private set
  private var reusable = false
  private var status = 0
  private var firstByte = false
  private var state = "header"
  private var remaining = 0L
  private var trailerBytes = 0
  private val line = ByteArrayOutputStream()
  private val header = ByteArrayOutputStream()
  private var ending = 0

  fun accept(data: ByteArray) {
    if (!firstByte) { firstByte = true; onFirstByte() }
    var offset = 0
    while (offset < data.size) {
      check(!complete) { "Unexpected bytes after HTTP response" }
      when (state) {
        "header" -> {
          val value = data[offset++].toInt() and 255
          header.write(value)
          require(header.size() <= 65536)
          ending = when { ending == 0 && value == 13 -> 1; ending == 1 && value == 10 -> 2; ending == 2 && value == 13 -> 3; ending == 3 && value == 10 -> 4; value == 13 -> 1; else -> 0 }
          if (ending == 4) receiveHeader()
        }
        "fixed", "chunk-body" -> {
          val count = minOf(remaining, (data.size - offset).toLong()).toInt()
          output.write(data, offset, count)
          offset += count; remaining -= count
          if (remaining == 0L) {
            if (state == "fixed") finish() else state = "chunk-cr"
          }
        }
        "chunk-cr", "chunk-lf" -> {
          val value = data[offset++].toInt() and 255
          require(value == if (state == "chunk-cr") 13 else 10)
          output.write(value)
          state = if (state == "chunk-cr") "chunk-lf" else "chunk-size"
        }
        "chunk-size", "trailers" -> {
          val value = data[offset++].toInt() and 255
          line.write(value)
          require(line.size() <= 16384)
          if (value == 10) {
            val bytes = line.toByteArray()
            require(bytes.size >= 2 && bytes[bytes.size - 2].toInt() == 13)
            val text = String(bytes, Charsets.ISO_8859_1).dropLast(2)
            output.write(bytes); line.reset()
            if (state == "trailers") {
              trailerBytes += bytes.size; require(trailerBytes <= 16384)
              if (text.isEmpty()) finish()
              else require(text.contains(':') && !text.startsWith(' ') && !text.startsWith('\t'))
            } else {
              val size = text.substringBefore(';')
              require(size.matches(Regex("[0-9a-fA-F]+")))
              remaining = size.toLong(16)
              require(remaining >= 0)
              state = if (remaining == 0L) "trailers" else "chunk-body"
            }
          }
        }
        "eof", "upgrade" -> { output.write(data, offset, data.size - offset); offset = data.size }
        else -> error("Invalid response state")
      }
    }
    output.flush()
  }

  private fun receiveHeader() {
    val text = header.toString("ISO-8859-1")
    val lines = text.split("\r\n")
    val statusLine = lines.first().split(' ')
    require(statusLine.size >= 2 && statusLine[0] in listOf("HTTP/1.0", "HTTP/1.1"))
    status = statusLine[1].toInt()
    require(status in 100..599)
    if (status in 100..199 && status != 101) { header.reset(); ending = 0; return }
    val fields = mutableMapOf<String, String>()
    for (entry in lines.drop(1).filter { it.isNotEmpty() }) {
      require(entry.indexOf(':') > 0 && !entry.startsWith(' ') && !entry.startsWith('\t'))
      val key = entry.substringBefore(':').lowercase()
      val value = entry.substringAfter(':').trim()
      if (key in listOf("content-length", "transfer-encoding")) require(!fields.containsKey(key))
      fields[key] = if (fields.containsKey(key)) fields[key] + "," + value else value
    }
    val length = fields["content-length"]?.also { require(it.matches(Regex("[0-9]+"))) }?.toLong()
    val transfer = fields["transfer-encoding"]?.lowercase()
    require(transfer == null || (transfer == "chunked" && length == null))
    val connection = fields["connection"].orEmpty().lowercase().split(',').map { it.trim() }
    upgraded = status == 101
    require(!upgraded || (requestedUpgrade && fields["upgrade"]?.lowercase() == "websocket" && "upgrade" in connection))
    val empty = method == "HEAD" || status == 204 || status == 304
    reusable = !upgraded && !requestClose && "close" !in connection &&
      (statusLine[0] == "HTTP/1.1" || "keep-alive" in connection) &&
      (empty || length != null || transfer == "chunked")
    output.write(rewrite(text, upgraded, reusable).toByteArray(Charsets.ISO_8859_1))
    state = when {
      upgraded -> "upgrade"
      empty -> "fixed"
      transfer == "chunked" -> "chunk-size"
      length != null -> "fixed"
      else -> "eof"
    }
    remaining = if (empty) 0 else length ?: 0
    if (state == "fixed" && remaining == 0L) finish()
  }

  private fun finish() {
    if (complete) return
    output.flush()
    complete = true
    onComplete(reusable, status)
    finished.countDown()
  }

  /** False means the upstream closed in the middle of a framed response. */
  fun end(): Boolean {
    if (state == "eof" || state == "upgrade") finish()
    finished.countDown()
    return complete
  }
}
