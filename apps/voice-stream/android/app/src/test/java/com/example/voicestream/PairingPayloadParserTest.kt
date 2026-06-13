package com.example.voicestream

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class PairingPayloadParserTest {
    @Test
    fun parsesVoiceStreamPairingPayload() {
        val audioUrl = "wss://example.ngrok-free.app/audio?token=from-audio"
        val apkUrl = "https://example.ngrok-free.app/download/app-debug.apk"
        val payload = "voicestream://pair?audio=${encode(audioUrl)}&token=from-qr&minVersionCode=2&apk=${encode(apkUrl)}"

        val config = PairingPayloadParser.parse(payload).getOrThrow()

        assertEquals(audioUrl, config.audioUrl)
        assertEquals("from-qr", config.token)
        assertEquals(2L, config.minVersionCode)
        assertEquals(apkUrl, config.apkUrl)
    }

    @Test
    fun parsesDirectAudioUrlWithToken() {
        val config = PairingPayloadParser.parse("ws://192.168.1.20:3000/audio?token=abc123").getOrThrow()

        assertEquals("ws://192.168.1.20:3000/audio?token=abc123", config.audioUrl)
        assertEquals("abc123", config.token)
    }

    @Test
    fun parsesUpdatePayload() {
        val apkUrl = "https://example.ngrok-free.app/download/app-debug.apk"
        val payload = "voicestream://update?versionCode=28&apk=${encode(apkUrl)}"

        val config = PairingPayloadParser.parseUpdate(payload).getOrThrow()

        assertEquals(28L, config.versionCode)
        assertEquals(apkUrl, config.apkUrl)
        assertTrue(PairingPayloadParser.isUpdatePayload(payload))
    }

    @Test
    fun rejectsUpdatePayloadWithoutVersion() {
        val result = PairingPayloadParser.parseUpdate("voicestream://update?apk=https%3A%2F%2Fexample.ngrok-free.app%2Fapp.apk")

        assertTrue(result.isFailure)
    }

    @Test
    fun rejectsPayloadWithoutToken() {
        val result = PairingPayloadParser.parse("wss://example.ngrok-free.app/audio")

        assertTrue(result.isFailure)
    }

    @Test
    fun rejectsNonWebSocketPayload() {
        val result = PairingPayloadParser.parse("https://example.ngrok-free.app/")

        assertTrue(result.isFailure)
    }

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
