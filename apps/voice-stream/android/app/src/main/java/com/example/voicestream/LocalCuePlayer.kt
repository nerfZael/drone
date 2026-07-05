package com.example.voicestream

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import kotlin.math.PI
import kotlin.math.sin

class LocalCuePlayer(context: Context) {
    private val appContext = context.applicationContext

    fun play(cue: LocalCue) {
        Thread {
            runCatching {
                val cuePcm = buildCuePcm(cue)
                val track = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setSampleRate(SAMPLE_RATE_HZ)
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build()
                    )
                    .setBufferSizeInBytes(cuePcm.pcm.size)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()
                AudioDeviceRouter(appContext).routeForPlayback(track)
                try {
                    track.setVolume(1.0f)
                    track.write(cuePcm.pcm, 0, cuePcm.pcm.size)
                    track.play()
                    SystemClock.sleep(cuePcm.durationMs + CUE_RELEASE_DELAY_MS)
                } finally {
                    runCatching { track.stop() }
                    runCatching { track.release() }
                }
            }.onFailure { error ->
                DroneLog.w("Cue", "Failed to play $cue cue", error)
            }
        }.apply {
            name = "DroneCuePlayer"
            isDaemon = true
            start()
        }
    }

    private fun buildCuePcm(cue: LocalCue): CuePcm {
        val tones = when (cue) {
            LocalCue.START_BUTTON -> listOf(Tone(420.0, 70), Tone(640.0, 120))
            LocalCue.STOP_BUTTON -> listOf(Tone(520.0, 70), Tone(260.0, 150))
            LocalCue.UNLOCK -> listOf(Tone(360.0, 70), Tone(560.0, 80), Tone(820.0, 130))
            LocalCue.SLEEPING_OFF -> listOf(Tone(460.0, 120), Tone(0.0, 50), Tone(330.0, 150), Tone(220.0, 230))
            LocalCue.WAKE -> listOf(Tone(620.0, 80), Tone(880.0, 130))
            LocalCue.SLEEP -> listOf(Tone(760.0, 90), Tone(420.0, 160))
            LocalCue.STATUS -> listOf(Tone(520.0, 70), Tone(0.0, 45), Tone(520.0, 70), Tone(0.0, 45), Tone(700.0, 90))
        }
        val pcm = tones.flatMap { tone -> tone.samples().asIterable() }.toByteArray()
        return CuePcm(pcm, tones.sumOf { it.durationMs })
    }

    private fun Tone.samples(): ByteArray {
        val sampleCount = SAMPLE_RATE_HZ * durationMs / 1000
        val output = ByteArray(sampleCount * 2)
        for (index in 0 until sampleCount) {
            val fade = envelope(index, sampleCount)
            val value = if (frequencyHz <= 0.0) {
                0
            } else {
                (sin(2.0 * PI * frequencyHz * index / SAMPLE_RATE_HZ) * Short.MAX_VALUE * 0.72 * fade).toInt()
            }
            output[index * 2] = (value and 0xff).toByte()
            output[index * 2 + 1] = ((value shr 8) and 0xff).toByte()
        }
        return output
    }

    private fun envelope(index: Int, sampleCount: Int): Double {
        val fadeSamples = minOf(sampleCount / 3, SAMPLE_RATE_HZ / 100)
        return when {
            fadeSamples <= 0 -> 1.0
            index < fadeSamples -> index.toDouble() / fadeSamples
            index > sampleCount - fadeSamples -> (sampleCount - index).toDouble() / fadeSamples
            else -> 1.0
        }.coerceIn(0.0, 1.0)
    }

    private data class Tone(val frequencyHz: Double, val durationMs: Int)
    private data class CuePcm(val pcm: ByteArray, val durationMs: Int)

    private companion object {
        private const val SAMPLE_RATE_HZ = 22_050
        private const val CUE_RELEASE_DELAY_MS = 90L
    }
}

enum class LocalCue {
    START_BUTTON,
    STOP_BUTTON,
    UNLOCK,
    SLEEPING_OFF,
    WAKE,
    SLEEP,
    STATUS,
}
