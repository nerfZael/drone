package com.example.voicestream

import android.content.Context
import android.net.Uri
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

object DroneLogUploader {
    private const val MIN_UPLOAD_INTERVAL_MS = 15_000L
    private val textMediaType = "text/plain; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    @Volatile private var lastUploadAtMs = 0L

    fun upload(context: Context, serverUrl: String, savedToken: String, reason: String, force: Boolean = false) {
        val appContext = context.applicationContext
        val now = System.currentTimeMillis()
        if (!force && now - lastUploadAtMs < MIN_UPLOAD_INTERVAL_MS) {
            return
        }
        lastUploadAtMs = now

        Thread {
            val endpoint = buildUploadUrl(serverUrl, savedToken)
            if (endpoint.isNullOrBlank()) {
                DroneLog.w("LogUpload", "Skipping upload; no authenticated server URL")
                return@Thread
            }

            val bodyText = DroneLog.read(appContext)
            if (bodyText.isBlank()) {
                return@Thread
            }

            val request = Request.Builder()
                .url(endpoint)
                .header("X-Drone-Log-Reason", reason)
                .post(bodyText.toRequestBody(textMediaType))
                .build()

            runCatching {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("HTTP ${response.code}")
                    }
                }
                DroneLog.i("LogUpload", "Uploaded diagnostics reason=$reason")
            }.onFailure { error ->
                DroneLog.w("LogUpload", "Failed to upload diagnostics reason=$reason", error)
            }
        }.apply {
            name = "DroneLogUpload"
            isDaemon = true
            start()
        }
    }

    private fun buildUploadUrl(serverUrl: String, savedToken: String): String? {
        val uri = runCatching { Uri.parse(serverUrl) }.getOrNull() ?: return null
        val scheme = when (uri.scheme) {
            "wss" -> "https"
            "ws" -> "http"
            "https" -> "https"
            "http" -> "http"
            else -> return null
        }
        val token = savedToken.ifBlank { uri.getQueryParameter("token").orEmpty() }
        if (token.isBlank()) {
            return null
        }

        return uri.buildUpon()
            .scheme(scheme)
            .encodedPath("/logs/android")
            .encodedQuery(null)
            .fragment(null)
            .appendQueryParameter("token", token)
            .build()
            .toString()
    }
}
