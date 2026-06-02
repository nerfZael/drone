package com.huntelkator.voicestreamnext

import android.net.Uri
import android.os.Handler
import android.os.Looper
import java.net.URI
import java.time.Instant
import kotlin.concurrent.thread

class BrowserAuthCoordinator(
    private val api: VoiceStreamApi,
    private val callbacks: Callbacks,
    private val mainHandler: Handler = Handler(Looper.getMainLooper()),
) {
    interface Callbacks {
        fun onAuthStarting()
        fun openBrowser(uri: Uri)
        fun onBrowserOpened()
        fun onAuthWaiting()
        fun onAuthConnected()
        fun onAuthExpired()
        fun onAuthError(message: String)
    }

    private data class PendingAuth(
        val request: BrowserAuthRequest,
        val deviceName: String,
    )

    @Volatile private var pendingAuth: PendingAuth? = null
    @Volatile private var pollInFlight = false
    @Volatile private var authRunId = 0

    private val pollRunnable = object : Runnable {
        override fun run() {
            poll()
        }
    }

    val isPending: Boolean
        get() = pendingAuth != null

    fun start(serverUrl: String, deviceName: String) {
        stop()
        val runId = ++authRunId
        val cleanName = deviceName.ifBlank { Constants.DEFAULT_DEVICE_NAME }
        callbacks.onAuthStarting()
        thread(name = "VoiceStreamBrowserAuthStart") {
            try {
                val request = api.createBrowserAuthRequest(cleanName)
                val authUrl = VoiceStreamWebUrls.authUrl(serverUrl, request, cleanName)
                if (runId != authRunId) return@thread
                pendingAuth = PendingAuth(request, cleanName)
                mainHandler.post {
                    if (runId == authRunId) {
                        callbacks.openBrowser(authUrl)
                        callbacks.onBrowserOpened()
                        schedulePoll()
                    }
                }
            } catch (error: Exception) {
                mainHandler.post {
                    if (runId == authRunId) {
                        callbacks.onAuthError(error.message ?: "Could not start sign in.")
                    }
                }
            }
        }
    }

    fun stop() {
        authRunId += 1
        mainHandler.removeCallbacks(pollRunnable)
        pendingAuth = null
        pollInFlight = false
    }

    private fun schedulePoll() {
        mainHandler.removeCallbacks(pollRunnable)
        mainHandler.postDelayed(pollRunnable, POLL_INTERVAL_MS)
    }

    private fun poll() {
        val pending = pendingAuth ?: return
        if (pollInFlight) return
        if (isExpired(pending.request.expiresAt)) {
            pendingAuth = null
            callbacks.onAuthExpired()
            return
        }

        pollInFlight = true
        val runId = authRunId
        thread(name = "VoiceStreamBrowserAuthPoll") {
            try {
                val result = api.browserAuthResult(pending.request.requestId, pending.request.secret)
                if (runId != authRunId) return@thread
                if (result.status == "claimed" && !result.deviceId.isNullOrBlank()) {
                    val name = result.deviceName ?: pending.deviceName
                    api.savePairing(DevicePairing(result.deviceId, pending.request.deviceToken), name)
                    pendingAuth = null
                    mainHandler.post {
                        if (runId == authRunId) {
                            pollInFlight = false
                            callbacks.onAuthConnected()
                        }
                    }
                    return@thread
                }
                mainHandler.post {
                    if (runId == authRunId) {
                        pollInFlight = false
                        callbacks.onAuthWaiting()
                        schedulePoll()
                    }
                }
            } catch (error: Exception) {
                pendingAuth = null
                mainHandler.post {
                    if (runId == authRunId) {
                        pollInFlight = false
                        callbacks.onAuthError(error.message ?: "Sign in failed.")
                    }
                }
            }
        }
    }

    private fun isExpired(expiresAt: String): Boolean {
        val expiresAtMs = runCatching { Instant.parse(expiresAt).toEpochMilli() }.getOrDefault(0L)
        return expiresAtMs > 0 && System.currentTimeMillis() > expiresAtMs
    }

    private companion object {
        const val POLL_INTERVAL_MS = 1_000L
    }
}

object VoiceStreamWebUrls {
    fun dashboardUrl(serverUrl: String): String {
        val trimmed = serverUrl.trim().trimEnd('/')
        return runCatching {
            val uri = URI(trimmed)
            val port = if (uri.port == 3299) 5185 else uri.port
            URI(uri.scheme ?: "http", uri.userInfo, uri.host, port, null, null, null).toString()
        }.getOrElse { trimmed }
    }

    fun nativeWebViewDashboardUrl(serverUrl: String): String {
        return Uri.parse(dashboardUrl(serverUrl))
            .buildUpon()
            .appendQueryParameter("nativeWebView", "1")
            .build()
            .toString()
    }

    fun authUrl(serverUrl: String, request: BrowserAuthRequest, deviceName: String): Uri {
        return Uri.parse(dashboardUrl(serverUrl))
            .buildUpon()
            .appendQueryParameter("desktopAuthRequest", request.requestId)
            .appendQueryParameter("desktopAuthSecret", request.secret)
            .appendQueryParameter("desktopName", deviceName)
            .build()
    }
}
