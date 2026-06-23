package com.huntelkator.voicestreamnext

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class Pcm16GainTest {
    @Test
    fun appliesRequestedGain() {
        val result = Pcm16Gain.applyGain(pcm16(1_000, -2_000), gain = 2.5)

        assertEquals(2.5, result.gain, 0.0001)
        assertEquals(2_000, result.peakBefore)
        assertEquals(5_000, result.peakAfter)
        assertArrayEquals(pcm16(2_500, -5_000), result.pcm)
    }

    @Test
    fun leavesHundredPercentVolumeUnchanged() {
        val pcm = pcm16(1_000, -25_000)
        val result = Pcm16Gain.applyGain(pcm, gain = 1.0)

        assertEquals(1.0, result.gain, 0.0001)
        assertEquals(25_000, result.peakBefore)
        assertEquals(25_000, result.peakAfter)
        assertArrayEquals(pcm, result.pcm)
    }

    @Test
    fun appliesVolumeReduction() {
        val result = Pcm16Gain.applyGain(pcm16(1_000, -2_000), gain = 0.5)

        assertEquals(0.5, result.gain, 0.0001)
        assertEquals(2_000, result.peakBefore)
        assertEquals(1_000, result.peakAfter)
        assertArrayEquals(pcm16(500, -1_000), result.pcm)
    }

    @Test
    fun keepsSilentPcmSilent() {
        val pcm = pcm16(0, 0)
        val result = Pcm16Gain.applyGain(pcm, gain = 3.0)

        assertEquals(1.0, result.gain, 0.0001)
        assertEquals(0, result.peakBefore)
        assertEquals(0, result.peakAfter)
        assertArrayEquals(pcm, result.pcm)
    }

    private fun pcm16(vararg samples: Int): ByteArray {
        val bytes = ByteArray(samples.size * 2)
        for ((index, sample) in samples.withIndex()) {
            val offset = index * 2
            bytes[offset] = (sample and 0xff).toByte()
            bytes[offset + 1] = ((sample shr 8) and 0xff).toByte()
        }
        return bytes
    }
}
