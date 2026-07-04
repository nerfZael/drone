package com.huntelkator.voicestreamnext

object RealtimeTerminalPhrase {
    private val terminalPhrase = Regex("(?:^|\\b)(?:that\\s+is\\s+it|that['’]s\\s+it|thats\\s+it)(?:\\b|$)", RegexOption.IGNORE_CASE)

    fun isStopCommand(text: String): Boolean {
        return terminalPhrase.containsMatchIn(normalized(text))
    }

    fun isCommandOnlyStop(text: String): Boolean {
        val normalized = normalized(text)
        val match = terminalPhrase.find(normalized) ?: return false
        return normalized.substring(0, match.range.first).isBlank()
    }

    private fun normalized(text: String): String {
        return text
            .lowercase()
            .replace(Regex("[^a-z0-9'’]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }
}