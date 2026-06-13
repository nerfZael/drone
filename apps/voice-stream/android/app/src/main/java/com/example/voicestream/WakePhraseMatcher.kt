package com.example.voicestream

import java.util.Locale

object WakePhraseMatcher {
    @Volatile private var activationSettings = VoiceActivationSettings()

    fun updateActivationSettings(settings: VoiceActivationSettings) {
        activationSettings = settings.normalized()
    }

    fun match(text: String): WakePhrase? {
        val words = text.lowercase(Locale.US)
            .split(Regex("[^a-z]+"))
            .filter { it.isNotBlank() }

        val settings = activationSettings
        val hasStart = settings.normalAliasWords.any { alias -> containsAlias(words, alias) }
        val hasRealTime = settings.realTimeAliasWords.any { alias -> containsAlias(words, alias) }
        val hasPatch = words.windowed(3).any { triple ->
            triple[0] == "patch" && triple[1] == "me" && triple[2] == "in"
        }
        val hasClipboard = words.windowed(3).any { triple ->
            triple[0] == "can" && triple[1] == "you" && triple[2] == "transcribe"
        } || words.any { it == "transcribe" }
        val hasSleep = words.windowed(3).any { triple ->
            triple[0] == "go" && triple[1] == "to" && triple[2] == "sleep"
        }
        val compact = words.joinToString("")
        val hasStatus = words.any { it == "status" } ||
            compact == "stateus" ||
            compact == "stateis" ||
            compact == "statuse" ||
            compact == "statuscheck" ||
            compact == "checkstatus"

        return when {
            hasSleep -> WakePhrase.SLEEP
            hasRealTime -> WakePhrase.REALTIME
            hasStart -> WakePhrase.START
            hasPatch -> WakePhrase.PATCH
            hasClipboard -> WakePhrase.CLIPBOARD
            hasStatus -> WakePhrase.STATUS
            else -> null
        }
    }

    private fun containsAlias(words: List<String>, alias: List<String>): Boolean {
        if (words.isEmpty() || alias.isEmpty() || alias.size > words.size) return false
        return words.windowed(alias.size).any { window -> window == alias }
    }
}

enum class WakePhrase {
    START,
    REALTIME,
    PATCH,
    CLIPBOARD,
    SLEEP,
    STATUS;

    val hasStart: Boolean
        get() = this == START

    val hasRealTime: Boolean
        get() = this == REALTIME

    val hasPatch: Boolean
        get() = this == PATCH

    val hasClipboard: Boolean
        get() = this == CLIPBOARD

    val hasSleep: Boolean
        get() = this == SLEEP

    val hasStatus: Boolean
        get() = this == STATUS
}

data class VoiceActivationSettings(
    val normalAliases: List<String> = listOf("hey Sebastian", "hay Sebastian"),
    val realTimeAliases: List<String> = listOf("Sebastian enter real-time mode", "Sebastian enter realtime mode"),
) {
    val normalAliasWords: List<List<String>>
        get() = normalizedAliases(normalAliases)

    val realTimeAliasWords: List<List<String>>
        get() = normalizedAliases(realTimeAliases)

    fun normalized(): VoiceActivationSettings {
        return VoiceActivationSettings(
            normalAliases = normalizedAliasText(normalAliases).ifEmpty { listOf("hey Sebastian", "hay Sebastian") },
            realTimeAliases = normalizedAliasText(realTimeAliases).ifEmpty { listOf("Sebastian enter real-time mode", "Sebastian enter realtime mode") },
        )
    }

    private fun normalizedAliases(values: List<String>): List<List<String>> {
        return normalizedAliasText(values).map { alias ->
            alias.lowercase(Locale.US).split(Regex("[^a-z]+")).filter { it.isNotBlank() }
        }.filter { it.isNotEmpty() }
    }

    private fun normalizedAliasText(values: List<String>): List<String> {
        val seen = LinkedHashSet<String>()
        val out = mutableListOf<String>()
        for (value in values) {
            val alias = value.trim().replace(Regex("\\s+"), " ")
            val key = alias.lowercase(Locale.US)
            if (alias.isBlank() || seen.contains(key)) continue
            seen.add(key)
            out.add(alias)
            if (out.size >= 12) break
        }
        return out
    }
}
