package com.example.voicestream

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

object ApprovalTtsPlayer {
    private val generation = AtomicInteger(0)
    @Volatile private var activeTrack: AudioTrack? = null

    fun stopAll() {
        generation.incrementAndGet()
        releaseActiveTrack()
    }

    fun playWav(wav: ByteArray) {
        val playbackGeneration = generation.incrementAndGet()
        releaseActiveTrack()
        Thread {
            runCatching {
                if (playbackGeneration != generation.get()) return@runCatching
                val audio = WavPcm.parse(wav)
                val channelMask = when (audio.channels) {
                    1 -> AudioFormat.CHANNEL_OUT_MONO
                    2 -> AudioFormat.CHANNEL_OUT_STEREO
                    else -> throw IllegalArgumentException("Unsupported WAV channels=${audio.channels}")
                }
                val minBuffer = AudioTrack.getMinBufferSize(
                    audio.sampleRateHz,
                    channelMask,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                val bufferSize = max(minBuffer, audio.bytesPerFrame * audio.sampleRateHz / 4)
                val track = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setSampleRate(audio.sampleRateHz)
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setChannelMask(channelMask)
                            .build()
                    )
                    .setBufferSizeInBytes(bufferSize)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
                activeTrack = track
                try {
                    if (playbackGeneration != generation.get()) return@runCatching
                    track.play()
                    var offset = 0
                    while (offset < audio.pcm.size) {
                        if (playbackGeneration != generation.get()) return@runCatching
                        val written = track.write(
                            audio.pcm,
                            offset,
                            audio.pcm.size - offset,
                            AudioTrack.WRITE_BLOCKING
                        )
                        if (written <= 0) {
                            throw IllegalStateException("AudioTrack write failed: $written")
                        }
                        offset += written
                    }
                    if (playbackGeneration != generation.get()) return@runCatching
                    SystemClock.sleep(audio.durationMs + RELEASE_DELAY_MS)
                } finally {
                    if (activeTrack === track) {
                        activeTrack = null
                    }
                    runCatching { track.stop() }
                    runCatching { track.release() }
                }
            }.onFailure { error ->
                DroneLog.w("ApprovalTTS", "Failed to play approval TTS", error)
            }
        }.apply {
            name = "DroneApprovalTts"
            isDaemon = true
            start()
        }
    }

    private fun releaseActiveTrack() {
        activeTrack?.let { track ->
            runCatching { track.pause() }
            runCatching { track.stop() }
            runCatching { track.flush() }
            runCatching { track.release() }
        }
        activeTrack = null
    }

    private data class WavPcm(
        val pcm: ByteArray,
        val sampleRateHz: Int,
        val channels: Int,
        val bitsPerSample: Int,
    ) {
        val bytesPerFrame: Int = channels * bitsPerSample / 8
        val durationMs: Long = if (bytesPerFrame <= 0 || sampleRateHz <= 0) {
            0L
        } else {
            pcm.size.toLong() * 1000L / bytesPerFrame / sampleRateHz
        }

        companion object {
            fun parse(wav: ByteArray): WavPcm {
                require(wav.size >= 12) { "WAV body is too small" }
                require(ascii(wav, 0, 4) == "RIFF" && ascii(wav, 8, 4) == "WAVE") {
                    "Expected RIFF/WAVE audio"
                }

                var offset = 12
                var channels = 0
                var sampleRateHz = 0
                var bitsPerSample = 0
                var format = 0
                var pcm: ByteArray? = null

                while (offset + CHUNK_HEADER_BYTES <= wav.size) {
                    val chunkId = ascii(wav, offset, 4)
                    val chunkSize = readUInt32Le(wav, offset + 4)
                    val dataStart = offset + CHUNK_HEADER_BYTES
                    val dataEnd = dataStart + chunkSize
                    require(chunkSize >= 0 && dataEnd <= wav.size) { "Invalid WAV chunk size" }

                    when (chunkId) {
                        "fmt " -> {
                            require(chunkSize >= 16) { "Invalid WAV fmt chunk" }
                            format = readUInt16Le(wav, dataStart)
                            channels = readUInt16Le(wav, dataStart + 2)
                            sampleRateHz = readUInt32Le(wav, dataStart + 4)
                            bitsPerSample = readUInt16Le(wav, dataStart + 14)
                        }
                        "data" -> pcm = wav.copyOfRange(dataStart, dataEnd)
                    }

                    offset = dataEnd + (chunkSize % 2)
                }

                require(format == 1) { "Only PCM WAV is supported" }
                require(channels == 1 || channels == 2) { "Unsupported WAV channels=$channels" }
                require(sampleRateHz > 0) { "Invalid WAV sample rate" }
                require(bitsPerSample == 16) { "Only 16-bit PCM WAV is supported" }
                return WavPcm(requireNotNull(pcm) { "WAV data chunk missing" }, sampleRateHz, channels, bitsPerSample)
            }

            private fun ascii(bytes: ByteArray, offset: Int, length: Int): String =
                String(bytes, offset, length, Charsets.US_ASCII)

            private fun readUInt16Le(bytes: ByteArray, offset: Int): Int =
                (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)

            private fun readUInt32Le(bytes: ByteArray, offset: Int): Int =
                (bytes[offset].toInt() and 0xff) or
                    ((bytes[offset + 1].toInt() and 0xff) shl 8) or
                    ((bytes[offset + 2].toInt() and 0xff) shl 16) or
                    ((bytes[offset + 3].toInt() and 0xff) shl 24)
        }
    }

    private const val CHUNK_HEADER_BYTES = 8
    private const val RELEASE_DELAY_MS = 180L
}
