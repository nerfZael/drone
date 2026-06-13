package com.huntelkator.voicestreamnext

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import org.json.JSONArray

data class PairingConfig(
    val serverUrl: String,
    val deviceId: String,
    val token: String,
    val deviceName: String? = null,
    val deviceType: String? = null,
    val minClientVersion: Long? = null,
    val expiresAt: String? = null,
    val pairingSessionId: String? = null,
    val apkUrl: String? = null,
)

data class UpdateConfig(
    val versionCode: Long,
    val apkUrl: String? = null,
)

data class DesktopAuthConfig(
    val requestServerUrl: String? = null,
    val requestId: String? = null,
    val secret: String? = null,
    val callbackUrl: String? = null,
    val callbackUrls: List<String> = emptyList(),
    val callbackSecret: String? = null,
    val deviceToken: String,
    val displayName: String? = null,
    val installationId: String? = null,
    val expiresAt: String? = null,
    val minClientVersion: Long? = null,
)

object PairingPayloadParser {
    fun parse(payload: String): Result<PairingConfig> = runCatching {
        val trimmed = payload.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("Pairing text is empty")

        when {
            trimmed.startsWith("voicestream://", ignoreCase = true) -> parseVoiceStreamPairing(trimmed)
            trimmed.startsWith("ws://", ignoreCase = true) || trimmed.startsWith("wss://", ignoreCase = true) ->
                parseWebSocketUrl(trimmed)
            else -> throw IllegalArgumentException("QR must be a VoiceStream pairing payload or ws:// server URL")
        }
    }

    fun isUpdatePayload(payload: String): Boolean = runCatching {
        val uri = URI(payload.trim())
        uri.scheme.equals("voicestream", ignoreCase = true) && uri.host.equals("update", ignoreCase = true)
    }.getOrDefault(false)

    fun isDesktopAuthPayload(payload: String): Boolean = runCatching {
        val uri = URI(payload.trim())
        uri.scheme.equals("voicestream", ignoreCase = true) && uri.host.equals("desktop-auth", ignoreCase = true)
    }.getOrDefault(false)

    fun parseUpdate(payload: String): Result<UpdateConfig> = runCatching {
        val trimmed = payload.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("Update QR is empty")

        val uri = URI(trimmed)
        if (!uri.scheme.equals("voicestream", ignoreCase = true) || !uri.host.equals("update", ignoreCase = true)) {
            throw IllegalArgumentException("QR does not contain VoiceStream update data")
        }

        val params = parseQuery(uri.rawQuery)
        val versionCode = params["versionCode"]?.toLongOrNull()
            ?: throw IllegalArgumentException("QR does not contain an app version")
        if (versionCode < 1) {
            throw IllegalArgumentException("QR contains an invalid app version")
        }

        UpdateConfig(versionCode, params["apk"]?.takeIf { it.isNotBlank() })
    }

    fun parseDesktopAuth(payload: String): Result<DesktopAuthConfig> = runCatching {
        val trimmed = payload.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("Desktop sign-in QR is empty")

        val uri = URI(trimmed)
        if (!uri.scheme.equals("voicestream", ignoreCase = true) || !uri.host.equals("desktop-auth", ignoreCase = true)) {
            throw IllegalArgumentException("QR does not contain desktop sign-in data")
        }

        val params = parseQuery(uri.rawQuery)
        val requestServerUrl = params["requestServerUrl"]?.trimEnd('/')?.takeIf { it.isNotBlank() }
        val requestId = params["requestId"]?.takeIf { it.isNotBlank() }
        val secret = params["secret"]?.takeIf { it.isNotBlank() }
        val callbackUrl = params["callbackUrl"]?.takeIf { it.isNotBlank() }
        val callbackUrls = parseCallbackUrls(params["callbackUrls"], callbackUrl)
        val callbackSecret = params["callbackSecret"]?.takeIf { it.isNotBlank() }
        if ((callbackUrls.isEmpty() || callbackSecret == null) && (requestServerUrl == null || requestId == null || secret == null)) {
            throw IllegalArgumentException("Desktop sign-in QR does not contain a callback or request server")
        }
        DesktopAuthConfig(
            requestServerUrl = requestServerUrl,
            requestId = requestId,
            secret = secret,
            callbackUrl = callbackUrl,
            callbackUrls = callbackUrls,
            callbackSecret = callbackSecret,
            deviceToken = params["deviceToken"]?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("Desktop sign-in QR does not contain a device token"),
            displayName = params["displayName"]?.takeIf { it.isNotBlank() },
            installationId = params["installationId"]?.takeIf { it.isNotBlank() },
            expiresAt = params["expiresAt"]?.takeIf { it.isNotBlank() },
            minClientVersion = params["minClientVersion"]?.toLongOrNull(),
        )
    }

    fun webSocketToHttpUrl(rawUrl: String): String {
        val uri = URI(rawUrl.trim())
        val scheme = when (uri.scheme?.lowercase()) {
            "wss" -> "https"
            "ws" -> "http"
            else -> throw IllegalArgumentException("Server URL must use ws:// or wss://")
        }
        if (uri.host.isNullOrBlank()) {
            throw IllegalArgumentException("Server URL is missing a host")
        }
        val portPart = if (uri.port > 0) ":${uri.port}" else ""
        return "$scheme://${uri.host}$portPart"
    }

    private fun parseVoiceStreamPairing(payload: String): PairingConfig {
        val uri = URI(payload)
        if (!uri.scheme.equals("voicestream", ignoreCase = true) || !uri.host.equals("pair", ignoreCase = true)) {
            throw IllegalArgumentException("QR does not contain VoiceStream pairing data")
        }

        val params = parseQuery(uri.rawQuery)
        val serverUrl = params["serverUrl"]?.trimEnd('/')
            ?: throw IllegalArgumentException("QR does not contain a server URL")
        val deviceId = params["deviceId"]?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("QR does not contain a device id")
        val token = params["token"]?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("QR does not contain a device token")

        return PairingConfig(
            serverUrl = serverUrl,
            deviceId = deviceId,
            token = token,
            deviceName = params["displayName"]?.takeIf { it.isNotBlank() },
            deviceType = params["deviceType"]?.takeIf { it.isNotBlank() },
            minClientVersion = params["minClientVersion"]?.toLongOrNull(),
            expiresAt = params["expiresAt"]?.takeIf { it.isNotBlank() },
            pairingSessionId = params["pairingSessionId"]?.takeIf { it.isNotBlank() },
            apkUrl = params["apk"]?.takeIf { it.isNotBlank() },
        )
    }

    private fun parseWebSocketUrl(rawUrl: String): PairingConfig {
        val uri = URI(rawUrl)
        if (!uri.scheme.equals("ws", ignoreCase = true) && !uri.scheme.equals("wss", ignoreCase = true)) {
            throw IllegalArgumentException("Server URL must use ws:// or wss://")
        }
        if (uri.host.isNullOrBlank()) {
            throw IllegalArgumentException("Server URL is missing a host")
        }

        val params = parseQuery(uri.rawQuery)
        val token = params["token"]?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("QR does not contain a pairing token")
        val deviceId = params["deviceId"]?.takeIf { it.isNotBlank() }.orEmpty()

        return PairingConfig(
            serverUrl = webSocketToHttpUrl(rawUrl),
            deviceId = deviceId,
            token = token,
            deviceName = params["displayName"]?.takeIf { it.isNotBlank() },
            deviceType = params["deviceType"]?.takeIf { it.isNotBlank() },
            minClientVersion = params["minClientVersion"]?.toLongOrNull()
                ?: params["minVersionCode"]?.toLongOrNull(),
            apkUrl = params["apk"]?.takeIf { it.isNotBlank() },
        )
    }

    private fun parseQuery(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrBlank()) return emptyMap()
        return rawQuery.split("&")
            .filter { it.isNotBlank() }
            .mapNotNull { pair ->
                val separator = pair.indexOf("=")
                if (separator < 0) decode(pair) to "" else decode(pair.substring(0, separator)) to decode(pair.substring(separator + 1))
            }
            .toMap()
    }

    private fun decode(value: String): String =
        URLDecoder.decode(value, StandardCharsets.UTF_8.name())

    private fun parseCallbackUrls(raw: String?, fallback: String?): List<String> {
        val urls = mutableListOf<String>()
        if (!raw.isNullOrBlank()) {
            runCatching {
                val parsed = JSONArray(raw)
                for (index in 0 until parsed.length()) {
                    parsed.optString(index).takeIf { it.isNotBlank() }?.let { urls.add(it) }
                }
            }.onFailure {
                raw.split(",").map { it.trim() }.filter { it.isNotBlank() }.forEach { urls.add(it) }
            }
        }
        if (!fallback.isNullOrBlank()) urls.add(fallback)
        return urls.distinct()
    }
}
