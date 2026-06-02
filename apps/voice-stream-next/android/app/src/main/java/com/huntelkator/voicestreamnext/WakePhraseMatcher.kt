package com.huntelkator.voicestreamnext

import java.util.Locale

// Keep the status command implementation available, but do not detect it from local voice phrases.
internal const val STATUS_WAKE_COMMAND_ENABLED = false

object PhraseMatcher {
    fun words(text: String): List<String> {
        return text.lowercase(Locale.US)
            .split(Regex("[^a-z0-9]+"))
            .filter { it.isNotBlank() }
    }

    fun normalizePhrase(phrase: String): String {
        return phrase.lowercase(Locale.US)
            .split(Regex("[^a-z0-9\\s]+"))
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .trim()
    }

    fun matchesPhrase(text: String, phrase: String): Boolean {
        val target = words(normalizePhrase(phrase))
        val source = words(text)
        if (target.isEmpty() || source.size < target.size) return false
        return source.windowed(target.size).any { window -> window == target }
    }
}

object WakePhraseMatcher {
    fun match(text: String, assistantProfiles: List<AssistantVoiceProfile> = listOf(AssistantVoiceProfile.defaultSebastian())): WakePhraseMatch? {
        val words = PhraseMatcher.words(text)

        val startProfile = assistantProfiles
            .filter { it.enabled }
            .firstOrNull { profile ->
                listOf(profile.wakePhrase).plus(profile.wakePhraseAliases).any { phrase ->
                    PhraseMatcher.matchesPhrase(text, phrase)
                }
            }
        val hasPatch = words.windowed(3).any { triple ->
            triple[0] == "patch" && triple[1] == "me" && triple[2] == "in"
        }
        val hasClipboard = words.windowed(3).any { triple ->
            triple[0] == "can" && triple[1] == "you" && triple[2] == "transcribe"
        } || words.any { it == "transcribe" }
        val hasSleep = words.windowed(3).any { triple ->
            triple[0] == "go" && triple[1] == "to" && triple[2] == "sleep"
        }
        val hasStopAudio = words.windowed(2).any { pair ->
            (pair[0] == "ok" || pair[0] == "okay") && pair[1] == "stop"
        }
        val hasRepeatAudio = words.windowed(4).any { phrase ->
            phrase[0] == "repeat" && phrase[1] == "what" && phrase[2] == "you" && phrase[3] == "said"
        }
        val compact = words.joinToString("")
        val hasStatus = STATUS_WAKE_COMMAND_ENABLED && (
            words.any { it == "status" } ||
                compact == "stateus" ||
                compact == "stateis" ||
                compact == "statuse" ||
                compact == "statuscheck" ||
                compact == "checkstatus"
        )

        return when {
            hasSleep -> WakePhraseMatch(WakePhrase.SLEEP)
            hasStopAudio -> WakePhraseMatch(WakePhrase.STOP_AUDIO)
            hasRepeatAudio -> WakePhraseMatch(WakePhrase.REPEAT_AUDIO)
            startProfile != null -> WakePhraseMatch(WakePhrase.START, startProfile.id.takeIf { it.isNotBlank() })
            hasPatch -> WakePhraseMatch(WakePhrase.PATCH)
            hasClipboard -> WakePhraseMatch(WakePhrase.CLIPBOARD)
            hasStatus -> WakePhraseMatch(WakePhrase.STATUS)
            else -> null
        }
    }

    fun matchSleep(text: String, unlockPhrase: String, shutdownPhrase: String): WakePhraseMatch? {
        return when {
            PhraseMatcher.matchesPhrase(text, unlockPhrase) -> WakePhraseMatch(WakePhrase.UNLOCK)
            PhraseMatcher.matchesPhrase(text, shutdownPhrase) -> WakePhraseMatch(WakePhrase.SHUTDOWN)
            else -> null
        }
    }
}

data class WakePhraseMatch(
    val phrase: WakePhrase,
    val assistantProfileId: String? = null,
) {
    val hasStart: Boolean get() = phrase.hasStart
    val hasPatch: Boolean get() = phrase.hasPatch
    val hasClipboard: Boolean get() = phrase.hasClipboard
    val hasSleep: Boolean get() = phrase.hasSleep
    val hasStopAudio: Boolean get() = phrase.hasStopAudio
    val hasRepeatAudio: Boolean get() = phrase.hasRepeatAudio
    val hasStatus: Boolean get() = phrase.hasStatus
    val hasUnlock: Boolean get() = phrase.hasUnlock
    val hasShutdown: Boolean get() = phrase.hasShutdown
}

class SleepPhraseStability(
    private val stableMs: Long = 650L,
    private val minHits: Int = 2,
    private val maxGapMs: Long = 1_500L,
) {
    private var candidate: WakePhrase? = null
    private var firstSeenAtMs = 0L
    private var lastSeenAtMs = 0L
    private var hits = 0

    fun accept(phrase: WakePhrase?, finalResult: Boolean, nowMs: Long): WakePhrase? {
        if (phrase != WakePhrase.UNLOCK && phrase != WakePhrase.SHUTDOWN) {
            reset()
            return null
        }
        if (finalResult) {
            reset()
            return phrase
        }
        if (candidate != phrase || nowMs - lastSeenAtMs > maxGapMs) {
            candidate = phrase
            firstSeenAtMs = nowMs
            lastSeenAtMs = nowMs
            hits = 1
            return null
        }
        hits += 1
        lastSeenAtMs = nowMs
        if (hits >= minHits && nowMs - firstSeenAtMs >= stableMs) {
            reset()
            return phrase
        }
        return null
    }

    fun reset() {
        candidate = null
        firstSeenAtMs = 0L
        lastSeenAtMs = 0L
        hits = 0
    }
}

enum class WakePhrase {
    START,
    PATCH,
    CLIPBOARD,
    SLEEP,
    STOP_AUDIO,
    REPEAT_AUDIO,
    STATUS,
    UNLOCK,
    SHUTDOWN;

    val hasStart: Boolean get() = this == START
    val hasPatch: Boolean get() = this == PATCH
    val hasClipboard: Boolean get() = this == CLIPBOARD
    val hasSleep: Boolean get() = this == SLEEP
    val hasStopAudio: Boolean get() = this == STOP_AUDIO
    val hasRepeatAudio: Boolean get() = this == REPEAT_AUDIO
    val hasStatus: Boolean get() = this == STATUS
    val hasUnlock: Boolean get() = this == UNLOCK
    val hasShutdown: Boolean get() = this == SHUTDOWN
}
