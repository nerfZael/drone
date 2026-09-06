package expo.modules.dronebrowser

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DroneBrowserModule : Module() {
  private var gateway: BrowserGateway? = null
  private var foreground = true

  override fun definition() = ModuleDefinition {
    Name("DroneBrowser")
    AsyncFunction("start") { sessionId: String, url: String, token: String, authority: String, path: String, targetPort: Int ->
      synchronized(this@DroneBrowserModule) {
        require(foreground) { "Keep DroneHub in the foreground to open Browser" }
        gateway?.close()
        val next = BrowserGateway(sessionId, url, token, authority, path, targetPort = targetPort)
        gateway = next
        mapOf("sessionId" to sessionId, "origin" to next.origin, "url" to next.bootstrapUrl)
      }
    }
    AsyncFunction("stop") { sessionId: String ->
      synchronized(this@DroneBrowserModule) {
        if (gateway?.sessionId == sessionId) { gateway?.close(); gateway = null }
      }
    }
    OnActivityEntersForeground { synchronized(this@DroneBrowserModule) { foreground = true } }
    OnActivityEntersBackground { synchronized(this@DroneBrowserModule) { foreground = false; gateway?.close(); gateway = null } }
    OnDestroy { synchronized(this@DroneBrowserModule) { gateway?.close(); gateway = null } }
  }
}
