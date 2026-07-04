package com.huntelkator.voicestreamnext

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RealtimeTerminalPhraseTest {
    @Test
    fun detectsRealtimeStopPhrases() {
        assertTrue(RealtimeTerminalPhrase.isStopCommand("that's it"))
        assertTrue(RealtimeTerminalPhrase.isStopCommand("That is it."))
        assertTrue(RealtimeTerminalPhrase.isStopCommand("Please remember Julio, thats it."))
        assertTrue(RealtimeTerminalPhrase.isCommandOnlyStop("that's it"))
    }

    @Test
    fun ignoresNonTerminalText() {
        assertFalse(RealtimeTerminalPhrase.isCommandOnlyStop("Please remember Julio, thats it."))
        assertFalse(RealtimeTerminalPhrase.isStopCommand("that was useful"))
        assertFalse(RealtimeTerminalPhrase.isStopCommand("that it can continue"))
        assertFalse(RealtimeTerminalPhrase.isStopCommand("it is done"))
    }
}