package com.example.voicestream

import android.content.Context
import android.net.Uri
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object ApprovalCodeUploader {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun upload(context: Context, serverUrl: String, savedToken: String, code: String) {
        val appContext = context.applicationContext
        Thread {
            val endpoint = buildApprovalUrl(serverUrl, savedToken)
            if (endpoint.isNullOrBlank()) {
                DroneLog.w("Approval", "Skipping approval code upload; no authenticated server URL")
                return@Thread
            }

            val body = JSONObject()
                .put("code", code)
                .put("source", "android")
                .put("detectedAt", java.time.Instant.now().toString())
                .toString()

            val request = Request.Builder()
                .url(endpoint)
                .post(body.toRequestBody(jsonMediaType))
                .build()

            runCatching {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("HTTP ${response.code}")
                    }
                    val contentType = response.body?.contentType()?.toString().orEmpty()
                    val responseBytes = response.body?.bytes() ?: ByteArray(0)
                    if (responseBytes.isNotEmpty() && contentType.startsWith("audio/wav")) {
                        ApprovalTtsPlayer.playWav(responseBytes)
                    }
                }
                DroneLog.i("Approval", "Uploaded approval code length=${code.length}")
            }.onFailure { error ->
                DroneLog.w("Approval", "Failed to upload approval code", error)
                DroneLogUploader.upload(appContext, serverUrl, savedToken, "approval-upload-failed", force = true)
            }
        }.apply {
            name = "DroneApprovalUpload"
            isDaemon = true
            start()
        }
    }

    private fun buildApprovalUrl(serverUrl: String, savedToken: String): String? {
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
            .encodedPath("/approvals")
            .encodedQuery(null)
            .fragment(null)
            .appendQueryParameter("token", token)
            .build()
            .toString()
    }
}
