package com.huntelkator.voicestreamnext

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class PairingPayloadParserTest {
    @Test
    fun parsesVoiceStreamPairingPayload() {
        val payload =
            "voicestream://pair?serverUrl=https%3A%2F%2Fexample.test&deviceId=device-1&token=abc123&displayName=Android&deviceType=android&minClientVersion=2&expiresAt=2099-01-01T00%3A00%3A00.000Z&pairingSessionId=session-1&apk=https%3A%2F%2Fexample.test%2Fapi%2Fmobile%2Fandroid%2Fapk"

        val config = PairingPayloadParser.parse(payload).getOrThrow()

        assertEquals("https://example.test", config.serverUrl)
        assertEquals("device-1", config.deviceId)
        assertEquals("abc123", config.token)
        assertEquals("Android", config.deviceName)
        assertEquals(2L, config.minClientVersion)
        assertEquals("https://example.test/api/mobile/android/apk", config.apkUrl)
    }

    @Test
    fun parsesDirectWebSocketUrlWithToken() {
        val config = PairingPayloadParser.parse("ws://192.168.1.20:3299/audio?token=abc123").getOrThrow()

        assertEquals("http://192.168.1.20:3299", config.serverUrl)
        assertEquals("abc123", config.token)
        assertEquals("", config.deviceId)
    }

    @Test
    fun parsesDirectWebSocketUrlWithDeviceId() {
        val config = PairingPayloadParser.parse("wss://example.test/audio?token=abc123&deviceId=device-9").getOrThrow()

        assertEquals("https://example.test", config.serverUrl)
        assertEquals("device-9", config.deviceId)
        assertEquals("abc123", config.token)
    }

    @Test
    fun convertsWebSocketUrlToHttpBase() {
        assertEquals("https://example.test:3299", PairingPayloadParser.webSocketToHttpUrl("wss://example.test:3299/audio?token=abc"))
        assertEquals("http://10.0.0.5:3299", PairingPayloadParser.webSocketToHttpUrl("ws://10.0.0.5:3299"))
    }

    @Test
    fun parsesUpdatePayload() {
        val apkUrl = "https://example.test/download/app-debug.apk"
        val payload = "voicestream://update?versionCode=28&apk=${encode(apkUrl)}"

        val config = PairingPayloadParser.parseUpdate(payload).getOrThrow()

        assertEquals(28L, config.versionCode)
        assertEquals(apkUrl, config.apkUrl)
        assertTrue(PairingPayloadParser.isUpdatePayload(payload))
    }

    @Test
    fun parsesDesktopAuthPayload() {
        val requestServerUrl = "https://desktop-request.example.test"
        val payload =
            "voicestream://desktop-auth?requestServerUrl=${encode(requestServerUrl)}&requestId=dauth_123&secret=secret-1&deviceToken=token-1&displayName=Desktop&installationId=desktop-install&expiresAt=2099-01-01T00%3A00%3A00.000Z&minClientVersion=3"

        val config = PairingPayloadParser.parseDesktopAuth(payload).getOrThrow()

        assertTrue(PairingPayloadParser.isDesktopAuthPayload(payload))
        assertEquals(requestServerUrl, config.requestServerUrl)
        assertEquals("dauth_123", config.requestId)
        assertEquals("secret-1", config.secret)
        assertEquals("token-1", config.deviceToken)
        assertEquals("Desktop", config.displayName)
        assertEquals("desktop-install", config.installationId)
        assertEquals(3L, config.minClientVersion)
    }

    @Test
    fun parsesDesktopAuthCallbackPayload() {
        val callbackUrl = "http://192.168.1.40:49152/desktop-auth/claim"
        val callbackUrl2 = "http://10.0.0.12:49152/desktop-auth/claim"
        val payload =
            "voicestream://desktop-auth?callbackUrl=${encode(callbackUrl)}&callbackUrls=${encode("[\"$callbackUrl2\",\"$callbackUrl\"]")}&callbackSecret=callback-secret&deviceToken=token-2&displayName=Desktop&installationId=desktop-install"

        val config = PairingPayloadParser.parseDesktopAuth(payload).getOrThrow()

        assertEquals(callbackUrl, config.callbackUrl)
        assertEquals(listOf(callbackUrl2, callbackUrl), config.callbackUrls)
        assertEquals("callback-secret", config.callbackSecret)
        assertEquals("token-2", config.deviceToken)
        assertEquals("Desktop", config.displayName)
    }

    @Test
    fun rejectsUpdatePayloadWithoutVersion() {
        val result = PairingPayloadParser.parseUpdate("voicestream://update?apk=https%3A%2F%2Fexample.test%2Fapp.apk")

        assertTrue(result.isFailure)
    }

    @Test
    fun rejectsPayloadWithoutToken() {
        val result = PairingPayloadParser.parse("wss://example.test/audio")

        assertTrue(result.isFailure)
    }

    @Test
    fun rejectsNonWebSocketPayload() {
        val result = PairingPayloadParser.parse("https://example.test/")

        assertTrue(result.isFailure)
    }

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
