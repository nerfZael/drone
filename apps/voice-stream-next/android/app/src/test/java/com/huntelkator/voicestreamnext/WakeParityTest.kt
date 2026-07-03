package com.huntelkator.voicestreamnext

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WakeParityTest {
    @Test
    fun matchesLegacyWakePhrases() {
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hey sebastian")?.phrase)
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hay sebastien")?.phrase)
        assertEquals(WakePhrase.PATCH, WakePhraseMatcher.match("patch me in")?.phrase)
        assertEquals(WakePhrase.CLIPBOARD, WakePhraseMatcher.match("can you transcribe this")?.phrase)
        assertEquals(WakePhrase.SLEEP, WakePhraseMatcher.match("go to sleep")?.phrase)
        assertEquals(WakePhrase.STOP_AUDIO, WakePhraseMatcher.match("ok stop")?.phrase)
        assertEquals(WakePhrase.STOP_AUDIO, WakePhraseMatcher.match("okay stop")?.phrase)
        assertEquals(WakePhrase.REPEAT_AUDIO, WakePhraseMatcher.match("repeat what you said")?.phrase)
        assertEquals(WakePhrase.SHUTDOWN, WakePhraseMatcher.match("shut down completely")?.phrase)
        assertNull(WakePhraseMatcher.match("hello there"))
        assertNull(WakePhraseMatcher.match("hey"))
        assertNull(WakePhraseMatcher.match("sebastian"))
    }

    @Test
    fun statusWakeCommandIsDisabled() {
        assertNull(WakePhraseMatcher.match("status"))
        assertNull(WakePhraseMatcher.match("status check"))
        assertNull(WakePhraseMatcher.match("check status"))
    }

    @Test
    fun matchesConfiguredAssistantWakePhrase() {
        val match = WakePhraseMatcher.match(
            "hey jenny",
            listOf(AssistantVoiceProfile(id = "profile_jenny", name = "Jenny", wakePhrase = "hey jenny", wakePhraseAliases = listOf("hello jenny"), ttsVoice = "jenny", enabled = true)),
        )

        assertEquals(WakePhrase.START, match?.phrase)
        assertEquals("profile_jenny", match?.assistantProfileId)
        assertEquals(
            "profile_jenny",
            WakePhraseMatcher.match(
                "hello jenny",
                listOf(AssistantVoiceProfile(id = "profile_jenny", name = "Jenny", wakePhrase = "hey jenny", wakePhraseAliases = listOf("hello jenny"), ttsVoice = "jenny", enabled = true)),
            )?.assistantProfileId,
        )
    }

    @Test
    fun doesNotUseLegacySebastianWhenProfilesAreConfigured() {
        val match = WakePhraseMatcher.match(
            "hey sebastian",
            listOf(AssistantVoiceProfile(id = "profile_sebastian", name = "Sebastian", wakePhrase = "hey sebastian", wakePhraseAliases = listOf("hay sebastian"), ttsVoice = "austin", enabled = false)),
        )

        assertNull(match)
    }

    @Test
    fun matchesConfiguredSleepPhrases() {
        assertEquals(
            WakePhrase.UNLOCK,
            WakePhraseMatcher.matchSleep(
                "please wake up now",
                VoicePhraseDefaults.unlockPhrase,
                VoicePhraseDefaults.shutdownPhrase,
            )?.phrase,
        )
        assertEquals(
            WakePhrase.SHUTDOWN,
            WakePhraseMatcher.matchSleep(
                "shut down completely",
                VoicePhraseDefaults.unlockPhrase,
                VoicePhraseDefaults.shutdownPhrase,
            )?.phrase,
        )
        assertNull(
            WakePhraseMatcher.matchSleep(
                "hey sebastian",
                VoicePhraseDefaults.unlockPhrase,
                VoicePhraseDefaults.shutdownPhrase,
            ),
        )
    }

    @Test
    fun sleepPhraseStabilityPrefersFinalResults() {
        val stability = SleepPhraseStability(stableMs = 650, minHits = 2)

        assertEquals(WakePhrase.UNLOCK, stability.accept(WakePhrase.UNLOCK, finalResult = true, nowMs = 0))
    }

    @Test
    fun sleepPhraseStabilityRequiresRepeatedStablePartialResults() {
        val stability = SleepPhraseStability(stableMs = 650, minHits = 2)

        assertNull(stability.accept(WakePhrase.UNLOCK, finalResult = false, nowMs = 0))
        assertNull(stability.accept(WakePhrase.UNLOCK, finalResult = false, nowMs = 400))
        assertEquals(WakePhrase.UNLOCK, stability.accept(WakePhrase.UNLOCK, finalResult = false, nowMs = 700))
    }

    @Test
    fun sleepPhraseStabilityResetsOnNonSleepMatch() {
        val stability = SleepPhraseStability(stableMs = 650, minHits = 2)

        assertNull(stability.accept(WakePhrase.UNLOCK, finalResult = false, nowMs = 0))
        assertNull(stability.accept(WakePhrase.START, finalResult = false, nowMs = 700))
        assertNull(stability.accept(WakePhrase.UNLOCK, finalResult = false, nowMs = 800))
    }

    @Test
    fun sleepPhraseStabilityResetsAfterLongGap() {
        val stability = SleepPhraseStability(stableMs = 650, minHits = 2, maxGapMs = 1_500)

        assertNull(stability.accept(WakePhrase.UNLOCK, finalResult = false, nowMs = 0))
        assertNull(stability.accept(WakePhrase.UNLOCK, finalResult = false, nowMs = 1_700))
    }

    @Test
    fun approvalCodeRequiresPhraseAndStableDigits() {
        val recognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)

        assertEquals(ApprovalCodeUpdate.None, recognizer.accept("one one five nine", 0))
        assertEquals(ApprovalCodeUpdate.Collecting(""), recognizer.accept("approval code", 100))
        assertEquals(ApprovalCodeUpdate.Collecting("11"), recognizer.accept("approval code one one", 200))
        assertEquals(ApprovalCodeUpdate.Collecting("1159"), recognizer.accept("approval code one one five nine", 300))
        assertEquals(ApprovalCodeUpdate.None, recognizer.flush(700))
        assertEquals(ApprovalCodeUpdate.Completed("1159"), recognizer.flush(850))
    }

    @Test
    fun approvalCodeRecognizesLockCode() {
        val lockRecognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)
        lockRecognizer.accept("approval code four three two one", 0)
        assertEquals(ApprovalCodeUpdate.Completed("4321"), lockRecognizer.flush(600))
    }

    @Test
    fun approvalCodeCancelsWhenTooShort() {
        val recognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 1_000)

        assertEquals(ApprovalCodeUpdate.Collecting(""), recognizer.accept("approval code", 0))
        assertEquals(ApprovalCodeUpdate.Collecting("12"), recognizer.accept("approval code one two", 100))
        assertEquals(ApprovalCodeUpdate.Cancelled, recognizer.flush(1_100))
    }

    @Test
    fun approvalCodeUsesCustomTriggerPhrase() {
        val recognizer = ApprovalCodeRecognizer(
            stableMs = 500,
            collectTimeoutMs = 3_000,
        )
        recognizer.configure(
            ApprovalCodeSettings(
                triggerPhrase = "gate code",
                minDigits = 4,
                maxDigits = 6,
            ),
        )

        assertEquals(ApprovalCodeUpdate.None, recognizer.accept("approval code one two three four", 0))
        assertEquals(ApprovalCodeUpdate.Collecting("1234"), recognizer.accept("gate code one two three four", 100))
        assertEquals(ApprovalCodeUpdate.Completed("1234"), recognizer.flush(700))
    }

    @Test
    fun approvalCodeSuppressesImmediateDuplicateCompletion() {
        val recognizer = ApprovalCodeRecognizer(stableMs = 500, duplicateCooldownMs = 4_000)

        recognizer.accept("approval code one two three four five six", 0)
        assertEquals(ApprovalCodeUpdate.Completed("123456"), recognizer.flush(600))

        recognizer.accept("approval code one two three four five six", 1_000)
        assertEquals(ApprovalCodeUpdate.None, recognizer.flush(1_600))

        recognizer.accept("approval code one two three four five six", 5_000)
        assertEquals(ApprovalCodeUpdate.Completed("123456"), recognizer.flush(5_600))
    }

    @Test
    fun syncsWakeStateFromServiceMode() {
        val controller = WakeToggleController()
        controller.applyServiceMode(Constants.MODE_RECORDING)
        assertEquals(WakeState.RECORDING, controller.state)

        controller.applyServiceMode(Constants.MODE_SLEEPING)
        assertEquals(WakeState.SLEEPING, controller.state)

        controller.applyServiceMode(Constants.MODE_OFF)
        assertEquals(WakeState.OFF, controller.state)
    }

    @Test
    fun recordingIgnoresWakeCommands() {
        val controller = WakeToggleController()
        controller.startAwake()
        assertEquals(WakeAction.START_RECORDING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.RECORDING, controller.state)

        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.SLEEP))
        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.STOP_AUDIO))
        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.REPEAT_AUDIO))
        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.STATUS))
        assertEquals(WakeState.RECORDING, controller.state)
    }
}
