package com.example.voicestream

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

data class PairingConfig(
    val audioUrl: String,
    val token: String,
    val minVersionCode: Long? = null,
    val apkUrl: String? = null
)

data class UpdateConfig(
    val versionCode: Long,
    val apkUrl: String? = null
)

object PairingPayloadParser {
    fun parse(payload: String): Result<PairingConfig> = runCatching {
        val trimmed = payload.trim()
        if (trimmed.isBlank()) {
            throw IllegalArgumentException("Pairing text is empty")
        }

        if (trimmed.startsWith("voicestream://", ignoreCase = true)) {
            parseVoiceStreamPayload(trimmed)
        } else if (trimmed.startsWith("ws://", ignoreCase = true) || trimmed.startsWith("wss://", ignoreCase = true)) {
            parseAudioUrl(trimmed)
        } else {
            throw IllegalArgumentException("Pairing text must be a Drone QR payload or ws:// URL")
        }
    }

    fun isUpdatePayload(payload: String): Boolean = runCatching {
        val uri = URI(payload.trim())
        uri.scheme.equals("voicestream", ignoreCase = true) && uri.host.equals("update", ignoreCase = true)
    }.getOrDefault(false)

    fun parseUpdate(payload: String): Result<UpdateConfig> = runCatching {
        val trimmed = payload.trim()
        if (trimmed.isBlank()) {
            throw IllegalArgumentException("Update QR is empty")
        }

        val uri = URI(trimmed)
        if (!uri.scheme.equals("voicestream", ignoreCase = true) || !uri.host.equals("update", ignoreCase = true)) {
            throw IllegalArgumentException("QR does not contain Drone update data")
        }

        val params = parseQuery(uri.rawQuery)
        val versionCode = params["versionCode"]?.toLongOrNull()
            ?: throw IllegalArgumentException("QR does not contain an app version")
        if (versionCode < 1) {
            throw IllegalArgumentException("QR contains an invalid app version")
        }

        val apkUrl = params["apk"]?.takeIf { it.isNotBlank() }
        UpdateConfig(versionCode, apkUrl)
    }

    private fun parseVoiceStreamPayload(payload: String): PairingConfig {
        val uri = URI(payload)
        if (!uri.scheme.equals("voicestream", ignoreCase = true) || uri.host != "pair") {
            throw IllegalArgumentException("QR does not contain Drone pairing data")
        }

        val params = parseQuery(uri.rawQuery)
        val audioUrl = params["audio"] ?: throw IllegalArgumentException("QR does not contain a server URL")
        val parsedAudio = parseAudioUrl(audioUrl)
        val token = params["token"] ?: parsedAudio.token
        if (token.isBlank()) {
            throw IllegalArgumentException("QR does not contain a pairing token")
        }
        val minVersionCode = params["minVersionCode"]?.toLongOrNull()
        val apkUrl = params["apk"]?.takeIf { it.isNotBlank() }
        return PairingConfig(parsedAudio.audioUrl, token, minVersionCode, apkUrl)
    }

    private fun parseAudioUrl(audioUrl: String): PairingConfig {
        val uri = URI(audioUrl)
        if (!uri.scheme.equals("ws", ignoreCase = true) && !uri.scheme.equals("wss", ignoreCase = true)) {
            throw IllegalArgumentException("Server URL must use ws:// or wss://")
        }
        if (uri.host.isNullOrBlank()) {
            throw IllegalArgumentException("Server URL is missing a host")
        }

        val token = parseQuery(uri.rawQuery)["token"].orEmpty()
        if (token.isBlank()) {
            throw IllegalArgumentException("QR does not contain a pairing token")
        }
        return PairingConfig(audioUrl, token)
    }

    private fun parseQuery(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrBlank()) return emptyMap()
        return rawQuery.split("&")
            .filter { it.isNotBlank() }
            .mapNotNull { pair ->
                val separator = pair.indexOf("=")
                if (separator < 0) {
                    decode(pair) to ""
                } else {
                    decode(pair.substring(0, separator)) to decode(pair.substring(separator + 1))
                }
            }
            .toMap()
    }

    private fun decode(value: String): String =
        URLDecoder.decode(value, StandardCharsets.UTF_8.name())
}
