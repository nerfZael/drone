package com.huntelkator.voicestreamnext

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class ApiJsonResponseTest {
    @Test
    fun rejectsJsonStringResponsesWithReadableMessage() {
        val error = runCatching {
            ApiJsonResponse.parseObject(""""not an object"""", "GET", "/api/test")
        }.exceptionOrNull()

        assertTrue(error is IOException)
        assertEquals(
            "Expected JSON object from GET /api/test, got string: not an object",
            error?.message,
        )
    }

    @Test
    fun returnsPlainTextErrorMessages() {
        assertEquals(
            "Android APK has not been built yet",
            ApiJsonResponse.errorMessage("Android APK has not been built yet", "HTTP 404"),
        )
    }

    @Test
    fun identifiesHtmlResponses() {
        val error = runCatching {
            ApiJsonResponse.parseObject("<!doctype html><html></html>", "GET", "/api/dashboard")
        }.exceptionOrNull()

        assertTrue(error is IOException)
        assertEquals(
            "Expected JSON object from GET /api/dashboard, got html: <!doctype html><html></html>",
            error?.message,
        )
    }
}
