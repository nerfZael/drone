package com.huntelkator.voicestreamnext

import android.content.Context

object DiagnosticsUploader {
    private const val MIN_UPLOAD_INTERVAL_MS = 15_000L
    private const val MAX_LOG_CHARS = 12_000

    @Volatile private var lastUploadAtMs = 0L

    fun upload(context: Context, api: VoiceStreamApi, reason: String, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastUploadAtMs < MIN_UPLOAD_INTERVAL_MS) {
            return
        }
        lastUploadAtMs = now

        Thread {
            val bodyText = ClientLog.read(context.applicationContext).trim()
            if (bodyText.isBlank()) {
                return@Thread
            }
            runCatching {
                api.uploadDiagnostics(reason, bodyText.takeLast(MAX_LOG_CHARS))
                ClientLog.i("Diagnostics", "Uploaded diagnostics reason=$reason")
            }.onFailure { error ->
                ClientLog.w("Diagnostics", "Failed to upload diagnostics reason=$reason", error)
            }
        }.apply {
            name = "VoiceStreamNextDiagnosticsUpload"
            isDaemon = true
            start()
        }
    }
}
