package com.example.voicestream

import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class WakeToggleControllerTest {
    @Before
    fun resetActivationSettings() {
        WakePhraseMatcher.updateActivationSettings(VoiceActivationSettings())
    }

    @Test
    fun heySebastianStartsRecordingAndDoesNotStopIt() {
        val controller = WakeToggleController()

        assertEquals(WakeAction.NONE, controller.startAwake())
        assertEquals(WakeState.AWAKE, controller.state)
        assertEquals(WakeAction.START_RECORDING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.RECORDING, controller.state)

        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.RECORDING, controller.state)
    }

    @Test
    fun localStopPhraseDoesNotControlRecording() {
        val controller = WakeToggleController()

        assertEquals(WakeAction.NONE, controller.startAwake())
        controller.wakeFromSleep()
        assertEquals(null, WakePhraseMatcher.match("that's it"))
        assertEquals(WakeState.AWAKE, controller.state)

        assertEquals(WakeAction.START_RECORDING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.RECORDING, controller.state)

        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.RECORDING, controller.state)
    }

    @Test
    fun statusPhraseOnlyPlaysWhileWaiting() {
        val controller = WakeToggleController()

        assertEquals(WakeAction.NONE, controller.startAwake())
        controller.wakeFromSleep()
        assertEquals(WakeAction.PLAY_STATUS, controller.wakeDetected(WakePhrase.STATUS))
        assertEquals(WakeState.AWAKE, controller.state)

        assertEquals(WakeAction.START_RECORDING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.RECORDING, controller.state)

        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.STATUS))
        assertEquals(WakeState.RECORDING, controller.state)
    }

    @Test
    fun sleepPhraseEntersSleepingWhileAwake() {
        val controller = WakeToggleController()

        assertEquals(WakeAction.NONE, controller.startAwake())
        assertEquals(WakeAction.ENTER_SLEEPING, controller.wakeDetected(WakePhrase.SLEEP))
        assertEquals(WakeState.SLEEPING, controller.state)
    }

    @Test
    fun sleepPhraseEntersSleepingWhileRecording() {
        val controller = WakeToggleController()

        assertEquals(WakeAction.NONE, controller.startAwake())
        assertEquals(WakeAction.START_RECORDING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.RECORDING, controller.state)
        assertEquals(WakeAction.ENTER_SLEEPING, controller.wakeDetected(WakePhrase.SLEEP))
        assertEquals(WakeState.SLEEPING, controller.state)
    }

    @Test
    fun patchPhraseStartsPatchRecording() {
        val controller = WakeToggleController()

        controller.startAwake()
        controller.wakeFromSleep()

        assertEquals(WakeAction.START_PATCH_RECORDING, controller.wakeDetected(WakePhrase.PATCH))
        assertEquals(WakeState.RECORDING, controller.state)
    }

    @Test
    fun realTimePhraseStartsRealTimeRecording() {
        val controller = WakeToggleController()

        controller.startAwake()
        controller.wakeFromSleep()

        assertEquals(WakeAction.START_REALTIME_RECORDING, controller.wakeDetected(WakePhrase.REALTIME))
        assertEquals(WakeState.RECORDING, controller.state)
    }

    @Test
    fun clipboardPhraseStartsClipboardRecording() {
        val controller = WakeToggleController()

        controller.startAwake()
        controller.wakeFromSleep()

        assertEquals(WakeAction.START_CLIPBOARD_RECORDING, controller.wakeDetected(WakePhrase.CLIPBOARD))
        assertEquals(WakeState.RECORDING, controller.state)
    }

    @Test
    fun stopAllStopsRecordingAndTurnsOff() {
        val controller = WakeToggleController()

        controller.startAwake()
        controller.wakeFromSleep()
        controller.wakeDetected(WakePhrase.START)

        assertEquals(WakeAction.STOP_RECORDING, controller.stopAll())
        assertEquals(WakeState.OFF, controller.state)
    }

    @Test
    fun toggleAwakeSleepSwitchesBetweenAwakeAndSleeping() {
        val controller = WakeToggleController()

        controller.startAwake()
        assertEquals(WakeState.AWAKE, controller.state)
        assertEquals(WakeAction.NONE, controller.toggleAwakeSleep())
        assertEquals(WakeState.SLEEPING, controller.state)
        assertEquals(WakeAction.NONE, controller.toggleAwakeSleep())
        assertEquals(WakeState.AWAKE, controller.state)
    }

    @Test
    fun toggleAwakeSleepStopsRecording() {
        val controller = WakeToggleController()

        controller.startAwake()
        controller.wakeDetected(WakePhrase.START)
        assertEquals(WakeAction.STOP_RECORDING, controller.toggleAwakeSleep())
        assertEquals(WakeState.AWAKE, controller.state)
    }

    @Test
    fun enterSleepingReturnsToSleepingState() {
        val controller = WakeToggleController()

        controller.startAwake()
        controller.wakeFromSleep()
        assertEquals(WakeState.AWAKE, controller.state)
        assertEquals(WakeAction.NONE, controller.enterSleeping())
        assertEquals(WakeState.SLEEPING, controller.state)
    }

    @Test
    fun matcherRecognizesStartAndStopPhrases() {
        assertEquals(null, WakePhraseMatcher.match("hey"))
        assertEquals(null, WakePhraseMatcher.match("hay"))
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hey sebastian"))
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hay sebastian"))
        assertEquals(WakePhrase.REALTIME, WakePhraseMatcher.match("sebastian enter real time mode"))
        assertEquals(WakePhrase.REALTIME, WakePhraseMatcher.match("sebastian enter realtime mode"))
        assertEquals(WakePhrase.PATCH, WakePhraseMatcher.match("patch me in"))
        assertEquals(WakePhrase.CLIPBOARD, WakePhraseMatcher.match("can you transcribe"))
        assertEquals(WakePhrase.CLIPBOARD, WakePhraseMatcher.match("transcribe"))
        assertEquals(WakePhrase.SLEEP, WakePhraseMatcher.match("go to sleep"))
        assertEquals(WakePhrase.SLEEP, WakePhraseMatcher.match("hey sebastian go to sleep"))
        assertEquals(null, WakePhraseMatcher.match("that's it"))
        assertEquals(null, WakePhraseMatcher.match("that is it"))
        assertEquals(null, WakePhraseMatcher.match("thats it"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("status"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("state us"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("state is"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("check status"))
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hey sebastian that's it"))
        assertEquals(null, WakePhraseMatcher.match("what is it"))
    }

    @Test
    fun matcherUsesConfiguredActivationAliases() {
        WakePhraseMatcher.updateActivationSettings(
            VoiceActivationSettings(
                normalAliases = listOf("computer listen"),
                realTimeAliases = listOf("computer live mode"),
            )
        )

        assertEquals(null, WakePhraseMatcher.match("hey sebastian"))
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("computer listen"))
        assertEquals(WakePhrase.REALTIME, WakePhraseMatcher.match("computer live mode"))
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
    fun approvalCodeRecognizesModeTransitionCodes() {
        val unlockRecognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)
        unlockRecognizer.accept("approval code one two three four", 0)
        assertEquals(ApprovalCodeUpdate.Completed("1234"), unlockRecognizer.flush(600))

        val lockRecognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)
        lockRecognizer.accept("approval code four three two one", 0)
        assertEquals(ApprovalCodeUpdate.Completed("4321"), lockRecognizer.flush(600))

        val offRecognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)
        offRecognizer.accept("approval code zero zero zero zero", 0)
        assertEquals(ApprovalCodeUpdate.Completed("0000"), offRecognizer.flush(600))
    }

    @Test
    fun approvalCodeCancelsWhenTooShort() {
        val recognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 1_000)

        assertEquals(ApprovalCodeUpdate.Collecting(""), recognizer.accept("approval code", 0))
        assertEquals(ApprovalCodeUpdate.Collecting("12"), recognizer.accept("approval code one two", 100))
        assertEquals(ApprovalCodeUpdate.Cancelled, recognizer.flush(1_100))
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
}
