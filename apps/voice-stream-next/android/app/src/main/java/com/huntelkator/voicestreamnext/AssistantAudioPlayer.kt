package com.huntelkator.voicestreamnext

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.MediaPlayer
import android.os.Build
import android.os.SystemClock
import java.io.File
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

object AssistantAudioPlayer {
    private val generation = AtomicInteger(0)
    private val lock = Any()
    private val queue = ArrayDeque<PlaybackRequest>()
    @Volatile private var activeTrack: AudioTrack? = null
    @Volatile private var activePlayer: MediaPlayer? = null
    @Volatile private var activeRequest: PlaybackRequest? = null
    @Volatile private var workerRunning = false
    @Volatile private var lastCompletedWav: ByteArray? = null

    fun stopAll() {
        generation.incrementAndGet()
        synchronized(lock) {
            queue.clear()
        }
        releaseActivePlayback()
    }

    fun stopCurrent() {
        generation.incrementAndGet()
        releaseActivePlayback()
    }

    fun isPlaybackActive(): Boolean {
        return activeRequest != null || activeTrack != null || activePlayer != null
    }

    fun repeatLast(context: Context, onStatus: ((String) -> Unit)? = null): Boolean {
        val wav = lastCompletedWav?.copyOf() ?: return false
        generation.incrementAndGet()
        releaseActivePlayback()
        synchronized(lock) {
            queue.addFirst(PlaybackRequest(context.applicationContext, wav, onStatus, rememberOnComplete = true))
            if (workerRunning) return true
            workerRunning = true
        }
        startWorker()
        return true
    }

    fun playWav(context: Context, wav: ByteArray, rememberOnComplete: Boolean = true, onStatus: ((String) -> Unit)? = null) {
        synchronized(lock) {
            queue.add(PlaybackRequest(context.applicationContext, wav, onStatus, rememberOnComplete))
            if (workerRunning) return
            workerRunning = true
        }
        startWorker()
    }

    private fun startWorker() {
        Thread {
            val playbackGeneration = generation.get()
            try {
                while (playbackGeneration == generation.get()) {
                    val next = synchronized(lock) { queue.poll() } ?: break
                    activeRequest = next
                    try {
                        runCatching {
                            val attributes = AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build()
                            try {
                                playPcmWav(next, attributes, playbackGeneration)
                            } catch (error: Exception) {
                                ClientLog.w("AssistantAudio", "PCM WAV playback unavailable signature=${signature(next.wav)} message=${error.message ?: error.javaClass.simpleName}; trying MediaPlayer", error)
                                playWithMediaPlayer(next, attributes, playbackGeneration)
                            }
                        }.onFailure { error ->
                            ClientLog.w("AssistantAudio", "Assistant audio playback failed", error)
                            next.onStatus?.invoke("Assistant audio failed: ${error.message ?: error.javaClass.simpleName}")
                        }
                    } finally {
                        if (activeRequest === next) activeRequest = null
                    }
                }
            } finally {
                var restart = false
                synchronized(lock) {
                    if (workerRunning) {
                        workerRunning = false
                    }
                    if (queue.isNotEmpty()) {
                        workerRunning = true
                        restart = true
                    }
                }
                if (restart) startWorker()
            }
        }.apply {
            name = "VoiceStreamAssistantAudio"
            isDaemon = true
            start()
        }
    }

    private fun playPcmWav(next: PlaybackRequest, attributes: AudioAttributes, playbackGeneration: Int) {
        val audio = WavPcm.parse(next.wav)
        val channelMask = if (audio.channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
        val minBuffer = AudioTrack.getMinBufferSize(audio.sampleRateHz, channelMask, AudioFormat.ENCODING_PCM_16BIT)
        require(minBuffer > 0) { "AudioTrack does not support ${audio.sampleRateHz}Hz/${audio.channels}ch PCM16" }
        val focus = requestAudioFocus(next.context, attributes)
        val track = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(audio.sampleRateHz).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(channelMask).build())
            .setBufferSizeInBytes(max(minBuffer, audio.bytesPerFrame * audio.sampleRateHz / 4))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        activeTrack = track
        try {
            ClientLog.i("AssistantAudio", "Playing assistant audio wavBytes=${next.wav.size} pcmBytes=${audio.pcm.size} sampleRate=${audio.sampleRateHz} channels=${audio.channels} durationMs=${audio.durationMs} ${audioRouteSummary(next.context)}")
            next.onStatus?.invoke("Playing assistant audio.")
            track.setVolume(AudioTrack.getMaxVolume())
            track.play()
            var offset = 0
            while (offset < audio.pcm.size) {
                if (playbackGeneration != generation.get()) return
                val written = track.write(audio.pcm, offset, audio.pcm.size - offset, AudioTrack.WRITE_BLOCKING)
                if (written <= 0) return
                offset += written
            }
            waitForAudioTrackCompletion(track, audio.pcm.size / audio.bytesPerFrame, audio.durationMs, playbackGeneration)
            if (playbackGeneration != generation.get()) return
            rememberCompleted(next)
            ClientLog.i("AssistantAudio", "Assistant audio played durationMs=${audio.durationMs}")
            next.onStatus?.invoke("Assistant audio played.")
        } finally {
            if (activeTrack === track) activeTrack = null
            runCatching { track.stop() }
            runCatching { track.release() }
            abandonAudioFocus(next.context, focus)
        }
    }

    private fun playWithMediaPlayer(next: PlaybackRequest, attributes: AudioAttributes, playbackGeneration: Int) {
        val file = File.createTempFile("assistant-audio-", audioExtension(next.wav), next.context.cacheDir)
        file.writeBytes(next.wav)
        val focus = requestAudioFocus(next.context, attributes)
        val player = MediaPlayer()
        val completed = CountDownLatch(1)
        var playbackError: String? = null
        activePlayer = player
        try {
            player.setAudioAttributes(attributes)
            player.setOnCompletionListener { completed.countDown() }
            player.setOnErrorListener { _, what, extra ->
                playbackError = "MediaPlayer error what=$what extra=$extra"
                completed.countDown()
                true
            }
            player.setDataSource(file.absolutePath)
            player.prepare()
            val durationMs = player.duration.takeIf { it > 0 }?.toLong() ?: 0L
            ClientLog.i("AssistantAudio", "Playing assistant audio with MediaPlayer bytes=${next.wav.size} signature=${signature(next.wav)} durationMs=$durationMs ${audioRouteSummary(next.context)}")
            next.onStatus?.invoke("Playing assistant audio.")
            player.start()
            while (playbackGeneration == generation.get()) {
                if (completed.await(200, TimeUnit.MILLISECONDS)) break
            }
            if (playbackGeneration != generation.get()) return
            playbackError?.let { error(it) }
            rememberCompleted(next)
            if (durationMs > 0L) SystemClock.sleep(80L)
            if (playbackGeneration != generation.get()) return
            ClientLog.i("AssistantAudio", "Assistant audio played with MediaPlayer durationMs=$durationMs")
            next.onStatus?.invoke("Assistant audio played.")
        } finally {
            if (activePlayer === player) activePlayer = null
            runCatching { player.stop() }
            runCatching { player.release() }
            abandonAudioFocus(next.context, focus)
            runCatching { file.delete() }
        }
    }

    private fun audioExtension(bytes: ByteArray): String = when {
        bytes.size >= 12 && asciiOrEmpty(bytes, 0, 4) == "RIFF" && asciiOrEmpty(bytes, 8, 4) == "WAVE" -> ".wav"
        bytes.size >= 3 && asciiOrEmpty(bytes, 0, 3) == "ID3" -> ".mp3"
        bytes.size >= 2 && (bytes[0].toInt() and 0xff) == 0xff && (bytes[1].toInt() and 0xe0) == 0xe0 -> ".mp3"
        bytes.size >= 4 && asciiOrEmpty(bytes, 0, 4) == "OggS" -> ".ogg"
        bytes.size >= 12 && asciiOrEmpty(bytes, 4, 4) == "ftyp" -> ".m4a"
        else -> ".bin"
    }

    private fun signature(bytes: ByteArray): String {
        val prefix = bytes.take(12).joinToString(" ") { byte -> "%02x".format(byte) }
        val riff = if (bytes.size >= 12) "${asciiOrEmpty(bytes, 0, 4)}/${asciiOrEmpty(bytes, 8, 4)}" else "short"
        return "$riff bytes=${bytes.size} head=$prefix"
    }

    private fun asciiOrEmpty(bytes: ByteArray, offset: Int, length: Int): String {
        if (offset < 0 || length < 0 || offset + length > bytes.size) return ""
        return String(bytes, offset, length, Charsets.US_ASCII)
    }

    private fun releaseActivePlayback() {
        activeTrack?.let { track ->
            runCatching { track.pause() }
            runCatching { track.stop() }
            runCatching { track.flush() }
            runCatching { track.release() }
        }
        activeTrack = null
        activePlayer?.let { player ->
            runCatching { player.stop() }
            runCatching { player.release() }
        }
        activePlayer = null
    }

    private fun rememberCompleted(next: PlaybackRequest) {
        if (next.rememberOnComplete) {
            lastCompletedWav = next.wav.copyOf()
        }
    }

    private fun waitForAudioTrackCompletion(track: AudioTrack, targetFrames: Int, durationMs: Long, playbackGeneration: Int) {
        if (targetFrames <= 0) return
        val deadlineMs = SystemClock.elapsedRealtime() + max(5_000L, durationMs + 1_000L)
        while (playbackGeneration == generation.get()) {
            val playedFrames = runCatching { track.playbackHeadPosition }.getOrDefault(targetFrames)
            if (playedFrames >= targetFrames) return
            if (SystemClock.elapsedRealtime() > deadlineMs) return
            SystemClock.sleep(20L)
        }
    }

    private fun requestAudioFocus(context: Context, attributes: AudioAttributes): AudioFocusRequest? {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return null
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes)
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener { }
            .build()
        val result = runCatching { audioManager.requestAudioFocus(request) }.getOrDefault(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
        if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            ClientLog.w("AssistantAudio", "Assistant audio focus not granted result=$result")
        }
        return request
    }

    private fun audioRouteSummary(context: Context): String {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return "audioManager=missing"
        return runCatching {
            val volume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
            val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            "mode=${audioManager.mode} musicVolume=$volume/$maxVolume ${communicationRouteSummary(audioManager)}"
        }.getOrDefault("audioRoute=unavailable")
    }

    private fun communicationRouteSummary(audioManager: AudioManager): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val device = runCatching { audioManager.communicationDevice }.getOrNull()
            return "communicationDevice=${device?.audioRouteLabel() ?: "default"}"
        }

        val outputs = runCatching {
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                .filter { it.isSink }
                .map { it.audioRouteLabel() }
                .distinct()
                .joinToString(",")
        }.getOrDefault("")
        return if (outputs.isBlank()) "outputs=unavailable" else "outputs=$outputs"
    }

    private fun AudioDeviceInfo.audioRouteLabel(): String {
        val typeLabel = when (type) {
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
            else -> "type-$type"
        }
        val name = runCatching { productName?.toString().orEmpty().trim() }.getOrDefault("")
        return if (name.isBlank()) typeLabel else "$typeLabel:$name"
    }

    private fun abandonAudioFocus(context: Context, request: AudioFocusRequest?) {
        if (request == null) return
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return
        runCatching { audioManager.abandonAudioFocusRequest(request) }
    }

    private data class PlaybackRequest(
        val context: Context,
        val wav: ByteArray,
        val onStatus: ((String) -> Unit)?,
        val rememberOnComplete: Boolean,
    )

    private data class WavPcm(val pcm: ByteArray, val sampleRateHz: Int, val channels: Int, val bitsPerSample: Int) {
        val bytesPerFrame: Int = channels * bitsPerSample / 8
        val durationMs: Long = if (bytesPerFrame <= 0 || sampleRateHz <= 0) 0L else pcm.size.toLong() * 1000L / bytesPerFrame / sampleRateHz

        companion object {
            fun parse(wav: ByteArray): WavPcm {
                require(wav.size >= 12)
                require(ascii(wav, 0, 4) == "RIFF" && ascii(wav, 8, 4) == "WAVE")
                var offset = 12
                var channels = 0
                var sampleRateHz = 0
                var bitsPerSample = 0
                var blockAlign = 0
                var format = 0
                var formatLabel = "unknown"
                var data: ByteArray? = null
                while (offset + 8 <= wav.size) {
                    val chunkId = ascii(wav, offset, 4)
                    val chunkSize = readUInt32Le(wav, offset + 4)
                    val dataStart = offset + 8
                    val dataEnd = dataStart + chunkSize
                    require(chunkSize >= 0 && dataEnd <= wav.size)
                    when (chunkId) {
                        "fmt " -> {
                            format = readUInt16Le(wav, dataStart)
                            channels = readUInt16Le(wav, dataStart + 2)
                            sampleRateHz = readUInt32Le(wav, dataStart + 4)
                            blockAlign = readUInt16Le(wav, dataStart + 12)
                            bitsPerSample = readUInt16Le(wav, dataStart + 14)
                            if (format == WAVE_FORMAT_EXTENSIBLE && dataStart + 40 <= dataEnd) {
                                format = readUInt16Le(wav, dataStart + 24)
                                formatLabel = "extensible:$format"
                            } else {
                                formatLabel = format.toString()
                            }
                        }
                        "data" -> data = wav.copyOfRange(dataStart, dataEnd)
                    }
                    offset = dataEnd + (chunkSize % 2)
                }
                val input = requireNotNull(data) { "WAV missing data chunk" }
                val converted = convertToPcm16(input, format, channels, sampleRateHz, bitsPerSample, blockAlign)
                ClientLog.i(
                    "AssistantAudio",
                    "Parsed WAV format=$formatLabel inputChannels=$channels outputChannels=${converted.channels} sampleRate=$sampleRateHz bits=$bitsPerSample inputBytes=${input.size} outputBytes=${converted.pcm.size}"
                )
                return converted
            }

            private fun ascii(bytes: ByteArray, offset: Int, length: Int): String = String(bytes, offset, length, Charsets.US_ASCII)
            private fun readUInt16Le(bytes: ByteArray, offset: Int): Int = (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)
            private fun readUInt32Le(bytes: ByteArray, offset: Int): Int = (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8) or ((bytes[offset + 2].toInt() and 0xff) shl 16) or ((bytes[offset + 3].toInt() and 0xff) shl 24)
            private fun readInt32Le(bytes: ByteArray, offset: Int): Int = readUInt32Le(bytes, offset)
            private fun readInt64Le(bytes: ByteArray, offset: Int): Long {
                var value = 0L
                for (index in 0 until 8) {
                    value = value or ((bytes[offset + index].toLong() and 0xffL) shl (8 * index))
                }
                return value
            }

            private fun convertToPcm16(
                input: ByteArray,
                format: Int,
                channels: Int,
                sampleRateHz: Int,
                bitsPerSample: Int,
                blockAlign: Int,
            ): WavPcm {
                require(channels > 0) { "WAV has no channels" }
                require(sampleRateHz > 0) { "WAV has no sample rate" }
                require(bitsPerSample == 8 || bitsPerSample == 16 || bitsPerSample == 24 || bitsPerSample == 32 || bitsPerSample == 64) {
                    "Unsupported WAV bit depth $bitsPerSample"
                }
                require(format == WAVE_FORMAT_PCM || format == WAVE_FORMAT_IEEE_FLOAT) { "Unsupported WAV format $format" }
                val bytesPerSample = bitsPerSample / 8
                val frameBytes = blockAlign.takeIf { it > 0 } ?: channels * bytesPerSample
                require(frameBytes >= channels * bytesPerSample) { "Invalid WAV block align $blockAlign" }
                val outputChannels = if (channels == 1) 1 else 2
                val frames = input.size / frameBytes
                val output = ByteArray(frames * outputChannels * 2)
                var outputOffset = 0
                for (frame in 0 until frames) {
                    val frameOffset = frame * frameBytes
                    for (channel in 0 until outputChannels) {
                        val inputChannel = channel.coerceAtMost(channels - 1)
                        val sampleOffset = frameOffset + inputChannel * bytesPerSample
                        val sample = readSample16(input, sampleOffset, format, bitsPerSample)
                        output[outputOffset] = (sample and 0xff).toByte()
                        output[outputOffset + 1] = ((sample shr 8) and 0xff).toByte()
                        outputOffset += 2
                    }
                }
                return WavPcm(output, sampleRateHz, outputChannels, 16)
            }

            private fun readSample16(bytes: ByteArray, offset: Int, format: Int, bitsPerSample: Int): Int {
                return if (format == WAVE_FORMAT_IEEE_FLOAT) {
                    val value = when (bitsPerSample) {
                        32 -> java.lang.Float.intBitsToFloat(readInt32Le(bytes, offset)).toDouble()
                        64 -> java.lang.Double.longBitsToDouble(readInt64Le(bytes, offset))
                        else -> throw IllegalArgumentException("Unsupported float WAV bit depth $bitsPerSample")
                    }.coerceIn(-1.0, 1.0)
                    (value * 32767.0).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                } else {
                    when (bitsPerSample) {
                        8 -> ((bytes[offset].toInt() and 0xff) - 128) shl 8
                        16 -> readUInt16Le(bytes, offset).toShort().toInt()
                        24 -> {
                            var value = (bytes[offset].toInt() and 0xff) or
                                ((bytes[offset + 1].toInt() and 0xff) shl 8) or
                                ((bytes[offset + 2].toInt() and 0xff) shl 16)
                            if ((value and 0x800000) != 0) value = value or -0x1000000
                            (value shr 8).coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                        }
                        32 -> (readInt32Le(bytes, offset) shr 16).coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                        else -> throw IllegalArgumentException("Unsupported PCM WAV bit depth $bitsPerSample")
                    }
                }
            }

            private const val WAVE_FORMAT_PCM = 1
            private const val WAVE_FORMAT_IEEE_FLOAT = 3
            private const val WAVE_FORMAT_EXTENSIBLE = 0xfffe
        }
    }
}
