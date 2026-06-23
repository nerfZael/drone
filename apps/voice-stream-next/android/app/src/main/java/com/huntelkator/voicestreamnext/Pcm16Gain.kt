package com.huntelkator.voicestreamnext

import kotlin.math.roundToInt

object Pcm16Gain {
    data class Result(val pcm: ByteArray, val gain: Double, val peakBefore: Int, val peakAfter: Int)

    fun applyGain(
        pcm: ByteArray,
        gain: Double,
    ): Result {
        require(gain in MIN_GAIN..MAX_GAIN) { "gain must be between $MIN_GAIN and $MAX_GAIN" }
        if (pcm.size < 2) return Result(pcm, 1.0, 0, 0)

        val peak = peakAbs(pcm)
        if (peak <= 0) return Result(pcm, 1.0, 0, 0)
        if (kotlin.math.abs(gain - 1.0) <= 0.0001) return Result(pcm, 1.0, peak, peak)

        val boosted = pcm.copyOf()
        var peakAfter = 0
        for (offset in 0 until boosted.size - 1 step 2) {
            val sample = readInt16Le(boosted, offset)
            val amplified = (sample * gain).roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            writeInt16Le(boosted, offset, amplified)
            val abs = if (amplified == Short.MIN_VALUE.toInt()) Short.MAX_VALUE.toInt() else kotlin.math.abs(amplified)
            if (abs > peakAfter) peakAfter = abs
        }
        return Result(boosted, gain, peak, peakAfter)
    }

    private fun peakAbs(pcm: ByteArray): Int {
        var peak = 0
        for (offset in 0 until pcm.size - 1 step 2) {
            val sample = readInt16Le(pcm, offset)
            val abs = if (sample == Short.MIN_VALUE.toInt()) Short.MAX_VALUE.toInt() else kotlin.math.abs(sample)
            if (abs > peak) peak = abs
        }
        return peak
    }

    private fun readInt16Le(bytes: ByteArray, offset: Int): Int {
        return ((bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)).toShort().toInt()
    }

    private fun writeInt16Le(bytes: ByteArray, offset: Int, value: Int) {
        bytes[offset] = (value and 0xff).toByte()
        bytes[offset + 1] = ((value shr 8) and 0xff).toByte()
    }

    private const val MIN_GAIN = 0.5
    private const val MAX_GAIN = 3.0
}
