package expo.modules.dronebrowser

/** Session aggregates only: never collect addresses, paths, cookies, headers or bodies. */
internal class BrowserMetrics {
  private val started = System.nanoTime()
  private val values = listOf("requests", "completedRequests", "reusedRequests", "incompleteRequests",
    "tunnelsCreated", "tunnelsOpened", "compressedTunnels", "tunnelConnectMs", "firstByteCount",
    "firstByteMs", "requestMs", "receivedBytes", "sentBytes", "httpErrors", "transportFailures")
    .associateWith { 0L }.toMutableMap()
  @Synchronized fun add(key: String, value: Long = 1) { values[key] = (values[key] ?: 0) + value }
  @Synchronized fun snapshot(): Map<String, Any> = mapOf("elapsedMs" to elapsed(started)) + values.toMap()
  fun elapsed(since: Long): Long = (System.nanoTime() - since) / 1_000_000
}
