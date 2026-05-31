package com.huntelkator.voicestreamnext

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit

data class ApiConfig(
    val serverUrl: String,
    val authMode: String,
    val bearerToken: String,
    val devEmail: String,
    val devName: String,
    val devAdmin: Boolean
)

data class DevicePairing(val deviceId: String, val token: String)
data class BrowserAuthRequest(
    val requestId: String,
    val secret: String,
    val deviceToken: String,
    val expiresAt: String,
)
data class BrowserAuthResult(
    val status: String,
    val deviceId: String?,
    val deviceName: String?,
)
data class AndroidSetupRedeemResult(
    val updateAvailable: Boolean,
    val latestVersionCode: Long?,
    val apkUrl: String?,
    val pairingPayload: String?,
)
data class AndroidReleaseInfo(
    val available: Boolean,
    val versionCode: Long?,
    val versionName: String?,
    val apkUrl: String?,
)
data class DashboardSummary(val displayName: String, val threadCount: Int, val deviceCount: Int, val logCount: Int, val logs: List<String>)
data class AssistantExchange(val userMessage: String, val assistantMessage: String)
data class AssistantThreadSummary(
    val id: String,
    val title: String,
    val status: String,
    val error: String?,
    val artifactsCount: Int,
    val updatedAt: String
)
data class AssistantArtifact(
    val id: String,
    val threadId: String,
    val path: String,
    val content: String,
    val size: Int,
    val revision: String,
    val createdAt: String,
    val updatedAt: String
)
data class AssistantFilesResult(
    val thread: AssistantThreadSummary,
    val artifacts: List<AssistantArtifact>
)
data class VoiceApprovalSettings(
    val triggerPhrase: String = "approval code",
    val unlockPhrase: String = VoicePhraseDefaults.unlockPhrase,
    val shutdownPhrase: String = VoicePhraseDefaults.shutdownPhrase,
    val lockCode: String = "4321",
    val minDigits: Int = 4,
    val maxDigits: Int = 8,
    val stableMs: Long = 900,
    val collectTimeoutMs: Long = 5_000,
    val duplicateCooldownMs: Long = 4_000,
    val finalizeCheckIntervalMs: Long = 250,
    val postPromptCommandSuppressionMs: Long = 1_800,
) {
    fun toApprovalCodeSettings(): ApprovalCodeSettings {
        return ApprovalCodeSettings(
            triggerPhrase = triggerPhrase,
            minDigits = minDigits,
            maxDigits = maxDigits,
            stableMs = stableMs,
            collectTimeoutMs = collectTimeoutMs,
            duplicateCooldownMs = duplicateCooldownMs,
            finalizeCheckIntervalMs = finalizeCheckIntervalMs,
        )
    }
}

class VoiceStreamApi(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    fun loadConfig(): ApiConfig {
        val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        return ApiConfig(
            serverUrl = prefs.getString(Constants.PREF_SERVER_URL, Constants.DEFAULT_SERVER_URL).orEmpty().trimEnd('/'),
            authMode = prefs.getString(Constants.PREF_AUTH_MODE, Constants.AUTH_DEV).orEmpty(),
            bearerToken = prefs.getString(Constants.PREF_BEARER_TOKEN, "").orEmpty(),
            devEmail = prefs.getString(Constants.PREF_DEV_EMAIL, Constants.DEFAULT_DEV_EMAIL).orEmpty(),
            devName = prefs.getString(Constants.PREF_DEV_NAME, Constants.DEFAULT_DEV_NAME).orEmpty(),
            devAdmin = prefs.getBoolean(Constants.PREF_DEV_ADMIN, true)
        )
    }

    fun saveConfig(config: ApiConfig) {
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(Constants.PREF_SERVER_URL, config.serverUrl.trimEnd('/'))
            .putString(Constants.PREF_AUTH_MODE, config.authMode)
            .putString(Constants.PREF_BEARER_TOKEN, config.bearerToken)
            .putString(Constants.PREF_DEV_EMAIL, config.devEmail)
            .putString(Constants.PREF_DEV_NAME, config.devName)
            .putBoolean(Constants.PREF_DEV_ADMIN, config.devAdmin)
            .apply()
    }

    fun androidEchoCancellationEnabled(): Boolean {
        return context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(Constants.PREF_ANDROID_ECHO_CANCELLATION, false)
    }

    fun saveAndroidEchoCancellationEnabled(enabled: Boolean) {
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putBoolean(Constants.PREF_ANDROID_ECHO_CANCELLATION, enabled)
            .apply()
    }

    fun pairedDeviceId(): String {
        return context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(Constants.PREF_DEVICE_ID, "").orEmpty()
    }

    fun pairedDeviceToken(): String {
        return context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(Constants.PREF_DEVICE_TOKEN, "").orEmpty()
    }

    fun installationId(): String {
        val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getString(Constants.PREF_INSTALLATION_ID, "").orEmpty()
        if (existing.isNotBlank()) return existing
        val next = "android_${UUID.randomUUID().toString().replace("-", "")}"
        prefs.edit()
            .putString(Constants.PREF_INSTALLATION_ID, next)
            .apply()
        return next
    }

    fun savePairing(pairing: DevicePairing, deviceName: String) {
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(Constants.PREF_DEVICE_ID, pairing.deviceId)
            .putString(Constants.PREF_DEVICE_TOKEN, pairing.token)
            .putString(Constants.PREF_DEVICE_NAME, deviceName)
            .apply()
    }

    fun savePairing(config: PairingConfig) {
        val next = loadConfig().copy(serverUrl = config.serverUrl)
        saveConfig(next)
        savePairing(DevicePairing(config.deviceId, config.token), config.deviceName ?: Constants.DEFAULT_DEVICE_NAME)
    }

    fun clearPairing() {
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .remove(Constants.PREF_DEVICE_ID)
            .remove(Constants.PREF_DEVICE_TOKEN)
            .apply()
    }

    fun createBrowserAuthRequest(deviceName: String): BrowserAuthRequest {
        val json = request(
            "POST",
            "/api/desktop-auth/requests",
            JSONObject()
                .put("displayName", deviceName)
                .put("deviceType", "android")
                .put("installationId", installationId())
                .put("protocolVersion", 1)
        )
        return BrowserAuthRequest(
            requestId = json.getString("requestId"),
            secret = json.getString("secret"),
            deviceToken = json.getString("deviceToken"),
            expiresAt = json.getString("expiresAt"),
        )
    }

    fun browserAuthResult(requestId: String, secret: String): BrowserAuthResult {
        val json = request(
            "POST",
            "/api/desktop-auth/result",
            JSONObject()
                .put("requestId", requestId)
                .put("secret", secret)
        )
        val device = json.optJSONObject("device")
        return BrowserAuthResult(
            status = json.optString("status", "pending"),
            deviceId = device?.optString("id")?.takeIf { it.isNotBlank() },
            deviceName = device?.optString("displayName")?.takeIf { it.isNotBlank() },
        )
    }

    fun pairedDeviceDisplayName(): String {
        val deviceId = pairedDeviceId()
        val token = pairedDeviceToken()
        if (deviceId.isBlank() || token.isBlank()) return ""
        val config = loadConfig()
        val url = "${config.serverUrl.trimEnd('/')}/api/devices/$deviceId/bootstrap"
        val builder = Request.Builder()
            .url(url)
            .header("x-voice-device-token", token)
            .header("x-voice-installation-id", installationId())
            .header("x-voice-client-version", BuildConfig.VERSION_CODE.toString())
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body.string()
            if (!response.isSuccessful) {
                throw IOException(ApiJsonResponse.errorMessage(text, "HTTP ${response.code}"))
            }
            val device = ApiJsonResponse.parseObject(text, "GET", "/api/devices/$deviceId/bootstrap")
                .getJSONObject("device")
            val returnedDeviceId = device.optString("id")
            val displayName = device.optString("displayName")
            if (returnedDeviceId.isNotBlank() && returnedDeviceId != deviceId) {
                savePairing(DevicePairing(returnedDeviceId, token), displayName.ifBlank { Constants.DEFAULT_DEVICE_NAME })
            }
            return displayName
        }
    }

    fun dashboard(): DashboardSummary {
        val json = request("GET", "/api/dashboard")
        val user = json.getJSONObject("user")
        val stats = json.getJSONObject("stats")
        val logs = json.optJSONArray("logs").orEmptyList { item ->
            val log = item as JSONObject
            "${log.optString("level")}: ${log.optString("message")}"
        }
        return DashboardSummary(
            displayName = user.optString("displayName", "VoiceStream user"),
            threadCount = stats.optInt("threadCount"),
            deviceCount = stats.optInt("deviceCount"),
            logCount = stats.optInt("logCount"),
            logs = logs
        )
    }

    fun pairDevice(deviceName: String): DevicePairing {
        val json = request(
            "POST",
            "/api/devices",
            JSONObject()
                .put("deviceType", "android")
                .put("displayName", deviceName)
                .put("installationId", installationId())
        )
        return DevicePairing(
            deviceId = json.getJSONObject("device").getString("id"),
            token = json.getString("token")
        )
    }

    fun androidRelease(): AndroidReleaseInfo {
        val android = request("GET", "/api/mobile/android").getJSONObject("android")
        return AndroidReleaseInfo(
            available = android.optBoolean("available", false),
            versionCode = android.takeIf { it.has("versionCode") && !it.isNull("versionCode") }?.optLong("versionCode"),
            versionName = android.optString("versionName").takeIf { it.isNotBlank() },
            apkUrl = android.optString("downloadUrl").takeIf { it.isNotBlank() },
        )
    }

    fun redeemAndroidSetup(setupUrl: String): AndroidSetupRedeemResult {
        val uri = URI(setupUrl.trim())
        val serverUrl = "${uri.scheme}://${uri.host}${if (uri.port > 0) ":${uri.port}" else ""}".trimEnd('/')
        val path = uri.rawPath + "/redeem" + (uri.rawQuery?.let { "?$it" } ?: "")
        val url = "$serverUrl$path"
        val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        val displayName = prefs.getString(Constants.PREF_DEVICE_NAME, Constants.DEFAULT_DEVICE_NAME)
            .orEmpty()
            .ifBlank { Constants.DEFAULT_DEVICE_NAME }
        val body = JSONObject()
            .put("clientVersion", BuildConfig.VERSION_CODE)
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("displayName", displayName)
            .put("installationId", installationId())

        val builder = Request.Builder()
            .url(url)
            .header("content-type", "application/json")
            .post(body.toString().toRequestBody(JSON))
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body.string()
            if (!response.isSuccessful) {
                throw IOException(ApiJsonResponse.errorMessage(text, "HTTP ${response.code}"))
            }
            val json = ApiJsonResponse.parseObject(text, "POST", path)
            val android = json.optJSONObject("android")
            val apkUrl = android?.optString("downloadUrl")?.takeIf { it.isNotBlank() }
            return AndroidSetupRedeemResult(
                updateAvailable = json.optBoolean("updateAvailable", false),
                latestVersionCode = android?.takeIf { it.has("versionCode") && !it.isNull("versionCode") }?.optLong("versionCode"),
                apkUrl = apkUrl,
                pairingPayload = json.optString("payloadUri").takeIf { it.isNotBlank() },
            )
        }
    }

    fun createVoiceSession(deviceId: String, mode: String = Constants.STREAM_TARGET_ASSISTANT): String {
        val json = request(
            "POST",
            "/api/voice/sessions",
            JSONObject()
                .put("deviceId", deviceId)
                .put("token", pairedDeviceToken())
                .put("installationId", installationId())
                .put("mode", mode)
                .put("protocolVersion", 1)
                .put("clientVersion", BuildConfig.VERSION_CODE)
        )
        val device = json.optJSONObject("device")
        val returnedDeviceId = device?.optString("id").orEmpty()
        if (returnedDeviceId.isNotBlank() && returnedDeviceId != deviceId) {
            savePairing(
                DevicePairing(returnedDeviceId, pairedDeviceToken()),
                device?.optString("displayName")?.takeIf { it.isNotBlank() } ?: Constants.DEFAULT_DEVICE_NAME
            )
        }
        return json
            .getJSONObject("session")
            .getString("id")
    }

    fun voiceApprovalSettings(): VoiceApprovalSettings {
        val settings = request("GET", "/api/settings/voice-approval").getJSONObject("settings")
        return VoiceApprovalSettings(
            triggerPhrase = settings.optString("triggerPhrase", "approval code").trim().ifBlank { "approval code" },
            unlockPhrase = PhraseMatcher.normalizePhrase(
                settings.optString("unlockPhrase", VoicePhraseDefaults.unlockPhrase),
            ).ifBlank { VoicePhraseDefaults.unlockPhrase },
            shutdownPhrase = PhraseMatcher.normalizePhrase(
                settings.optString("shutdownPhrase", VoicePhraseDefaults.shutdownPhrase),
            ).ifBlank { VoicePhraseDefaults.shutdownPhrase },
            lockCode = settings.optString("lockCode", "4321").filter { it.isDigit() }.ifBlank { "4321" },
            minDigits = settings.optInt("minDigits", 4).coerceIn(1, 12),
            maxDigits = settings.optInt("maxDigits", 8).coerceIn(1, 12),
            stableMs = settings.optLong("stableMs", 900).coerceIn(250, 3_000),
            collectTimeoutMs = settings.optLong("collectTimeoutMs", 5_000).coerceIn(1_000, 15_000),
            duplicateCooldownMs = settings.optLong("duplicateCooldownMs", 4_000).coerceIn(0, 15_000),
            finalizeCheckIntervalMs = settings.optLong("finalizeCheckIntervalMs", 250).coerceIn(100, 1_000),
            postPromptCommandSuppressionMs = settings.optLong("postPromptCommandSuppressionMs", 1_800).coerceIn(0, 5_000),
        )
    }

    fun sendAssistantMessage(content: String): AssistantExchange {
        val thread = request("POST", "/api/assistant/threads", JSONObject().put("title", "Android voice thread"))
            .getJSONObject("thread")
        val messages = request(
            "POST",
            "/api/assistant/threads/${thread.getString("id")}/messages",
            JSONObject().put("content", content)
        ).getJSONArray("messages")
        return AssistantExchange(
            userMessage = messages.getJSONObject(0).optString("content"),
            assistantMessage = messages.getJSONObject(1).optString("content")
        )
    }

    fun assistantThreadSummary(): AssistantThreadSummary {
        val deviceId = pairedDeviceId()
        if (deviceId.isBlank()) throw IOException("Pair this device before loading assistant files.")
        val json = deviceRequest("GET", "/api/devices/$deviceId/assistant/thread")
        val thread = json.optJSONObject("thread") ?: return emptyAssistantThread(json.optInt("artifactsCount", 0))
        return parseAssistantThread(thread, json.optInt("artifactsCount", thread.optInt("artifactsCount", 0)))
    }

    fun assistantFiles(): AssistantFilesResult {
        val deviceId = pairedDeviceId()
        if (deviceId.isBlank()) throw IOException("Pair this device before loading assistant files.")
        val json = deviceRequest("GET", "/api/devices/$deviceId/assistant/thread/artifacts")
        val artifacts = json.optJSONArray("artifacts").orEmptyArtifacts()
        val thread = json.optJSONObject("thread")?.let { parseAssistantThread(it, artifacts.size) }
            ?: emptyAssistantThread(artifacts.size)
        return AssistantFilesResult(
            thread = thread,
            artifacts = artifacts
        )
    }

    fun uploadLog(message: String, details: JSONObject? = null) {
        val deviceId = pairedDeviceId()
        val token = pairedDeviceToken()
        val body = JSONObject()
            .put("deviceId", if (deviceId.isBlank()) JSONObject.NULL else deviceId)
            .put("token", if (token.isBlank()) JSONObject.NULL else token)
            .put("source", "android")
            .put("level", "info")
            .put("message", message)
            .put("protocolVersion", 1)
            .put("clientVersion", BuildConfig.VERSION_CODE)
            .put("installationId", installationId())
        if (details != null) body.put("details", details)
        request("POST", "/api/logs", body)
    }

    fun uploadDiagnostics(reason: String, logText: String) {
        val deviceId = pairedDeviceId().takeIf { it.isNotBlank() }
        val token = pairedDeviceToken().takeIf { it.isNotBlank() }
        val body = JSONObject()
            .put("source", "android")
            .put("level", "info")
            .put("message", "Android diagnostics ($reason)")
            .put("details", JSONObject().put("reason", reason).put("log", logText))
            .put("protocolVersion", 1)
            .put("clientVersion", BuildConfig.VERSION_CODE)
            .put("installationId", installationId())
        if (deviceId != null) body.put("deviceId", deviceId)
        if (token != null) body.put("token", token)
        request("POST", "/api/logs", body)
    }

    fun uploadClientStatus(mode: String, status: String, microphone: String = "", lastError: String? = null) {
        val deviceId = pairedDeviceId()
        val token = pairedDeviceToken()
        if (deviceId.isBlank() || token.isBlank()) return
        val json = request(
            "POST",
            "/api/devices/$deviceId/status",
            JSONObject()
                .put("token", token)
                .put("mode", mode)
                .put("status", status)
                .put("microphone", microphone)
                .put("installationId", installationId())
                .put("protocolVersion", 1)
                .put("clientVersion", BuildConfig.VERSION_CODE)
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("lastError", lastError ?: JSONObject.NULL)
                .put("reportedAt", java.time.Instant.now().toString())
        )
        val device = json.optJSONObject("device")
        val returnedDeviceId = device?.optString("id").orEmpty()
        if (returnedDeviceId.isNotBlank() && returnedDeviceId != deviceId) {
            savePairing(
                DevicePairing(returnedDeviceId, token),
                device?.optString("displayName")?.takeIf { it.isNotBlank() } ?: Constants.DEFAULT_DEVICE_NAME
            )
        }
    }

    fun uploadApprovalCode(code: String, voiceSessionId: String? = null) {
        val body = JSONObject()
            .put("source", "android")
            .put("code", code)
            .put("deviceId", pairedDeviceId().takeIf { it.isNotBlank() } ?: JSONObject.NULL)
            .put("token", pairedDeviceToken().takeIf { it.isNotBlank() } ?: JSONObject.NULL)
        if (!voiceSessionId.isNullOrBlank()) body.put("voiceSessionId", voiceSessionId)
        request("POST", "/api/voice/approval-codes", body)
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val config = loadConfig()
        val url = "${config.serverUrl.trimEnd('/')}$path"
        val builder = Request.Builder().url(url)
        applyAuth(builder, config)
        if (body == null) {
            builder.method(method, null)
        } else {
            builder.method(method, body.toString().toRequestBody(JSON))
        }
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body.string()
            if (!response.isSuccessful) {
                throw IOException(ApiJsonResponse.errorMessage(text, "HTTP ${response.code}"))
            }
            return ApiJsonResponse.parseObject(text, method, path)
        }
    }

    private fun deviceRequest(method: String, path: String): JSONObject {
        val config = loadConfig()
        val token = pairedDeviceToken()
        if (token.isBlank()) throw IOException("Pair this device before loading assistant files.")
        val url = "${config.serverUrl.trimEnd('/')}$path"
        val builder = Request.Builder()
            .url(url)
            .header("content-type", "application/json")
            .header("x-voice-device-token", token)
            .header("x-voice-client-version", BuildConfig.VERSION_CODE.toString())
        builder.method(method, null)
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body.string()
            if (!response.isSuccessful) {
                throw IOException(ApiJsonResponse.errorMessage(text, "HTTP ${response.code}"))
            }
            return ApiJsonResponse.parseObject(text, method, path)
        }
    }

    private fun parseAssistantThread(json: JSONObject, fallbackArtifactsCount: Int): AssistantThreadSummary {
        return AssistantThreadSummary(
            id = json.optString("id"),
            title = json.optString("title", "Voice thread"),
            status = json.optString("status", "idle"),
            error = json.optString("error").takeIf { it.isNotBlank() },
            artifactsCount = json.optInt("artifactsCount", fallbackArtifactsCount),
            updatedAt = json.optString("updatedAt")
        )
    }

    private fun emptyAssistantThread(artifactsCount: Int): AssistantThreadSummary {
        return AssistantThreadSummary(
            id = "",
            title = "Voice thread",
            status = "idle",
            error = null,
            artifactsCount = artifactsCount,
            updatedAt = ""
        )
    }

    private fun applyAuth(builder: Request.Builder, config: ApiConfig) {
        builder.header("content-type", "application/json")
        if (config.authMode == Constants.AUTH_BEARER && config.bearerToken.isNotBlank()) {
            builder.header("authorization", "Bearer ${config.bearerToken}")
        } else {
            builder.header("x-voice-dev-user-email", config.devEmail)
            builder.header("x-voice-dev-user-name", config.devName)
            builder.header("x-voice-dev-admin", if (config.devAdmin) "1" else "0")
        }
    }

    private fun JSONArray?.orEmptyList(mapper: (Any) -> String): List<String> {
        if (this == null) return emptyList()
        val next = mutableListOf<String>()
        for (index in 0 until length()) {
            next += mapper(get(index))
        }
        return next
    }

    private fun JSONArray?.orEmptyArtifacts(): List<AssistantArtifact> {
        if (this == null) return emptyList()
        val next = mutableListOf<AssistantArtifact>()
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: continue
            next += AssistantArtifact(
                id = item.optString("id"),
                threadId = item.optString("threadId"),
                path = item.optString("path"),
                content = item.optString("content"),
                size = item.optInt("size"),
                revision = item.optString("revision"),
                createdAt = item.optString("createdAt"),
                updatedAt = item.optString("updatedAt")
            )
        }
        return next
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

object ApiJsonResponse {
    fun parseObject(text: String, method: String, path: String): JSONObject {
        val trimmed = text.trim()
        if (trimmed.isBlank()) return JSONObject()
        if (!trimmed.startsWith("{")) {
            throw IOException("Expected JSON object from $method $path, got ${bodyType(trimmed)}: ${previewBody(trimmed)}")
        }
        return runCatching { JSONObject(trimmed) }
            .getOrElse { error ->
                throw IOException("Expected JSON object from $method $path, got malformed JSON: ${preview(trimmed)}", error)
            }
    }

    fun errorMessage(text: String, fallback: String): String {
        val trimmed = text.trim()
        if (trimmed.isBlank()) return fallback
        if (trimmed.startsWith("{")) {
            val json = runCatching { JSONObject(trimmed) }.getOrNull()
            if (json != null) {
                return json.optString("error")
                    .ifBlank { json.optString("message") }
                    .ifBlank { fallback }
            }
        }
        val textMessage = previewBody(trimmed)
        return if (textMessage.isBlank()) fallback else textMessage
    }

    private fun bodyType(text: String): String = when (text.firstOrNull()) {
        '"' -> "string"
        '[' -> "array"
        '<' -> "html"
        't', 'f' -> "boolean"
        'n' -> "null"
        in '0'..'9', '-' -> "number"
        else -> "text"
    }

    private fun previewBody(text: String): String {
        val trimmed = text.trim()
        if (trimmed.length >= 2 && trimmed.first() == '"' && trimmed.last() == '"') {
            return trimmed.substring(1, trimmed.length - 1)
                .replace("\\\"", "\"")
                .replace("\\n", " ")
                .replace("\\r", " ")
                .replace("\\t", " ")
                .let(::preview)
        }
        return preview(trimmed)
    }

    private fun preview(text: String): String {
        val normalized = text.replace(Regex("\\s+"), " ").trim()
        return normalized.take(MAX_PREVIEW_CHARS)
    }

    private const val MAX_PREVIEW_CHARS = 180
}
