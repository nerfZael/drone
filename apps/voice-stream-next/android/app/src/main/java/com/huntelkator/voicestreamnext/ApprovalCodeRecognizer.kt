package com.huntelkator.voicestreamnext

import java.util.Locale

class ApprovalCodeRecognizer(
    minDigits: Int = 4,
    maxDigits: Int = 8,
    stableMs: Long = 900,
    collectTimeoutMs: Long = 5_000,
    duplicateCooldownMs: Long = 4_000,
) {
    private var settings = ApprovalCodeSettings(
        minDigits = minDigits,
        maxDigits = maxDigits,
        stableMs = stableMs,
        collectTimeoutMs = collectTimeoutMs,
        duplicateCooldownMs = duplicateCooldownMs,
    )
    private var collecting = false
    private var startedAtMs = 0L
    private var lastUpdateAtMs = 0L
    private var bestCode = ""
    private var lastCompletedCode = ""
    private var lastCompletedAtMs = 0L

    val isCollecting: Boolean
        get() = collecting

    fun configure(nextSettings: ApprovalCodeSettings) {
        val defaults = ApprovalCodeSettings()
        settings = nextSettings.copy(
            stableMs = preserveExistingTiming(nextSettings.stableMs, defaults.stableMs, settings.stableMs),
            collectTimeoutMs = preserveExistingTiming(nextSettings.collectTimeoutMs, defaults.collectTimeoutMs, settings.collectTimeoutMs),
            duplicateCooldownMs = preserveExistingTiming(nextSettings.duplicateCooldownMs, defaults.duplicateCooldownMs, settings.duplicateCooldownMs),
            finalizeCheckIntervalMs = preserveExistingTiming(nextSettings.finalizeCheckIntervalMs, defaults.finalizeCheckIntervalMs, settings.finalizeCheckIntervalMs),
        )
        reset()
    }

    fun accept(text: String, nowMs: Long): ApprovalCodeUpdate {
        val words = words(text)
        if (words.isEmpty()) return flush(nowMs)

        val phraseEnd = triggerPhraseEnd(words, words(settings.triggerPhrase))
        if (!collecting && phraseEnd == null) {
            return ApprovalCodeUpdate.None
        }

        var shouldReportCollecting = false
        if (!collecting) {
            collecting = true
            startedAtMs = nowMs
            lastUpdateAtMs = nowMs
            bestCode = ""
            shouldReportCollecting = true
        }

        val candidateWords = if (phraseEnd != null) {
            words.drop(phraseEnd)
        } else {
            words
        }
        val candidate = candidateWords.mapNotNull { digitForWord(it) }.joinToString("")
        if (candidate.length > bestCode.length) {
            bestCode = candidate.take(settings.maxDigits)
            lastUpdateAtMs = nowMs
            shouldReportCollecting = true
        }

        if (bestCode.length >= settings.maxDigits) {
            return complete(nowMs)
        }

        return flush(nowMs).let { update ->
            if (update == ApprovalCodeUpdate.None && shouldReportCollecting) {
                ApprovalCodeUpdate.Collecting(bestCode)
            } else {
                update
            }
        }
    }

    fun flush(nowMs: Long): ApprovalCodeUpdate {
        if (!collecting) {
            return ApprovalCodeUpdate.None
        }

        if (bestCode.length >= settings.minDigits && nowMs - lastUpdateAtMs >= settings.stableMs) {
            return complete(nowMs)
        }

        if (nowMs - startedAtMs >= settings.collectTimeoutMs) {
            reset()
            return ApprovalCodeUpdate.Cancelled
        }

        return ApprovalCodeUpdate.None
    }

    fun reset() {
        collecting = false
        startedAtMs = 0L
        lastUpdateAtMs = 0L
        bestCode = ""
    }

    private fun complete(nowMs: Long): ApprovalCodeUpdate {
        val code = bestCode
        reset()
        if (code == lastCompletedCode && nowMs - lastCompletedAtMs < settings.duplicateCooldownMs) {
            return ApprovalCodeUpdate.None
        }
        lastCompletedCode = code
        lastCompletedAtMs = nowMs
        return ApprovalCodeUpdate.Completed(code)
    }

    private fun preserveExistingTiming(nextValue: Long, defaultValue: Long, currentValue: Long): Long {
        return if (nextValue == defaultValue && currentValue != defaultValue) currentValue else nextValue
    }

    private fun words(text: String): List<String> {
        return text.lowercase(Locale.US)
            .split(Regex("[^a-z0-9]+"))
            .filter { it.isNotBlank() }
    }

    private fun triggerPhraseEnd(words: List<String>, triggerWords: List<String>): Int? {
        if (triggerWords.isEmpty() || words.size < triggerWords.size) return null
        for (index in 0..(words.size - triggerWords.size)) {
            var matched = true
            for (offset in triggerWords.indices) {
                if (words[index + offset] != triggerWords[offset]) {
                    matched = false
                    break
                }
            }
            if (matched) return index + triggerWords.size
        }
        return null
    }

    private fun digitForWord(word: String): String? {
        return when (word) {
            "0", "zero", "oh", "o" -> "0"
            "1", "one", "won" -> "1"
            "2", "two", "too", "to" -> "2"
            "3", "three", "tree" -> "3"
            "4", "four", "for" -> "4"
            "5", "five" -> "5"
            "6", "six" -> "6"
            "7", "seven" -> "7"
            "8", "eight", "ate" -> "8"
            "9", "nine", "niner" -> "9"
            else -> null
        }
    }
}

data class ApprovalCodeSettings(
    val triggerPhrase: String = "approval code",
    val minDigits: Int = 4,
    val maxDigits: Int = 8,
    val stableMs: Long = 900,
    val collectTimeoutMs: Long = 5_000,
    val duplicateCooldownMs: Long = 4_000,
    val finalizeCheckIntervalMs: Long = 250,
)

sealed class ApprovalCodeUpdate {
    data object None : ApprovalCodeUpdate()
    data class Collecting(val partialCode: String) : ApprovalCodeUpdate()
    data class Completed(val code: String) : ApprovalCodeUpdate()
    data object Cancelled : ApprovalCodeUpdate()
}
