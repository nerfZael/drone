package com.example.voicestream

import android.content.Context
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.StorageService
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

class VoskWakeWordDetector(
    private val context: Context,
    private val onStatus: (String) -> Unit,
    private val onText: (String) -> Unit = {},
) {
    private val loading = AtomicBoolean(false)
    private val recognizerLock = Any()
    @Volatile private var model: Model? = null
    @Volatile private var recognizer: Recognizer? = null
    @Volatile var available: Boolean = false
        private set
    private var lastLoggedText = ""
    private var lastLoggedAtMs = 0L
    private var lastDetectedPhrase: WakePhrase? = null
    private var lastDetectedAtMs = 0L
    @Volatile private var approvalTriggerPhrase = "approval code"
    @Volatile private var activationSettings = VoiceActivationSettings()

    fun prepare() {
        if (available || !loading.compareAndSet(false, true)) return

        onStatus("Waking local detector")
        StorageService.unpack(
            context,
            ASSET_MODEL_DIR,
            TARGET_MODEL_DIR,
            { loadedModel ->
                val loadedRecognizer = try {
                    Recognizer(loadedModel, Constants.SAMPLE_RATE_HZ.toFloat(), buildWakeGrammar())
                } catch (error: IOException) {
                    onStatus("Error: Vosk recognizer failed ${error.message ?: error.javaClass.simpleName}")
                    null
                }
                synchronized(recognizerLock) {
                    model = loadedModel
                    recognizer = loadedRecognizer
                    available = loadedRecognizer != null
                }
                loading.set(false)
                if (available) {
                    onStatus("Awake: waiting for \"hey sebastian\"")
                }
            },
            { error ->
                available = false
                loading.set(false)
                val detail = error.message ?: error.javaClass.simpleName
                onStatus("Error: local Vosk model failed to unpack from assets/$ASSET_MODEL_DIR ($detail)")
            }
        )
    }

    fun acceptPcm(frame: ByteArray, length: Int): WakePhrase? {
        val resultJson = synchronized(recognizerLock) {
            val localRecognizer = recognizer ?: return null
            val accepted = runCatching { localRecognizer.acceptWaveForm(frame, length) }.getOrDefault(false)
            if (accepted) {
                localRecognizer.result
            } else {
                localRecognizer.partialResult
            }
        }
        return detectWakePhrase(resultJson)
    }

    fun reset() {
        synchronized(recognizerLock) {
            recognizer?.runCatching { reset() }
            lastDetectedPhrase = null
            lastDetectedAtMs = 0L
        }
    }

    fun updateApprovalTriggerPhrase(phrase: String) {
        val normalized = normalizeGrammarPhrase(phrase).ifBlank { "approval code" }
        if (normalized == approvalTriggerPhrase) return
        synchronized(recognizerLock) {
            approvalTriggerPhrase = normalized
            val localModel = model ?: return@synchronized
            val nextRecognizer = try {
                Recognizer(localModel, Constants.SAMPLE_RATE_HZ.toFloat(), buildWakeGrammar())
            } catch (error: IOException) {
                DroneLog.w("Vosk", "Failed to rebuild recognizer for approval trigger", error)
                return@synchronized
            }
            recognizer?.runCatching { close() }
            recognizer = nextRecognizer
            available = true
            lastDetectedPhrase = null
            lastDetectedAtMs = 0L
        }
    }

    fun updateActivationSettings(settings: VoiceActivationSettings) {
        val next = settings.normalized()
        activationSettings = next
        WakePhraseMatcher.updateActivationSettings(next)
        synchronized(recognizerLock) {
            val localModel = model ?: return@synchronized
            val nextRecognizer = try {
                Recognizer(localModel, Constants.SAMPLE_RATE_HZ.toFloat(), buildWakeGrammar())
            } catch (error: IOException) {
                DroneLog.w("Vosk", "Failed to rebuild recognizer for activation aliases", error)
                return@synchronized
            }
            recognizer?.runCatching { close() }
            recognizer = nextRecognizer
            available = true
            lastDetectedPhrase = null
            lastDetectedAtMs = 0L
        }
    }

    fun release() {
        synchronized(recognizerLock) {
            available = false
            recognizer?.runCatching { close() }
            model?.runCatching { close() }
            recognizer = null
            model = null
            lastDetectedPhrase = null
            lastDetectedAtMs = 0L
        }
        loading.set(false)
    }

    private fun detectWakePhrase(json: String?): WakePhrase? {
        if (json.isNullOrBlank()) return null
        val text = runCatching {
            val obj = JSONObject(json)
            obj.optString("partial").ifBlank { obj.optString("text") }
        }.getOrDefault("")
        logRecognizedText(text)
        if (text.isNotBlank()) {
            onText(text)
        }
        val phrase = WakePhraseMatcher.match(text)
        if (phrase != null) {
            val shouldSuppress = synchronized(recognizerLock) {
                val now = SystemClock.elapsedRealtime()
                if (phrase == lastDetectedPhrase && now - lastDetectedAtMs < PHRASE_COOLDOWN_MS) {
                    true
                } else {
                    lastDetectedPhrase = phrase
                    lastDetectedAtMs = now
                    false
                }
            }
            if (shouldSuppress) {
                return null
            }
            DroneLog.i("Vosk", "Matched local phrase=$phrase text=$text")
        }
        return phrase
    }

    private fun logRecognizedText(text: String) {
        if (text.isBlank()) return
        val now = SystemClock.elapsedRealtime()
        if (text != lastLoggedText || now - lastLoggedAtMs >= RECOGNIZER_LOG_INTERVAL_MS) {
            DroneLog.i("Vosk", "Local recognizer text=$text")
            lastLoggedText = text
            lastLoggedAtMs = now
        }
    }

    companion object {
        private const val ASSET_MODEL_DIR = "model-en-us"
        private const val TARGET_MODEL_DIR = "vosk-model-en-us"
        private const val RECOGNIZER_LOG_INTERVAL_MS = 1_500L
        private const val PHRASE_COOLDOWN_MS = 900L
        private val BASE_WAKE_GRAMMAR = listOf(
            "hey sebastian",
            "hay sebastian",
            "sebastian enter real time mode",
            "sebastian enter realtime mode",
            "hey",
            "hay",
            "sebastian",
            "patch me in",
            "can you transcribe",
            "transcribe",
            "go to sleep",
            "go",
            "to",
            "sleep",
            "status",
            "state us",
            "state is",
            "status check",
            "check status",
            "approval",
            "code",
            "approval code",
            "zero",
            "oh",
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
            "[unk]",
        )
    }

    private fun buildWakeGrammar(): String {
        val entries = LinkedHashSet<String>()
        entries.addAll(BASE_WAKE_GRAMMAR)
        activationSettings.normalAliases.forEach { addGrammarPhrase(entries, it) }
        activationSettings.realTimeAliases.forEach { addGrammarPhrase(entries, it) }
        val trigger = normalizeGrammarPhrase(approvalTriggerPhrase)
        if (trigger.isNotBlank()) {
            addGrammarPhrase(entries, trigger)
        }
        return JSONArray(entries.toList()).toString()
    }

    private fun addGrammarPhrase(entries: LinkedHashSet<String>, phrase: String) {
        val normalized = normalizeGrammarPhrase(phrase)
        if (normalized.isBlank()) return
        entries.add(normalized)
        normalized.split(Regex("\\s+")).filter { it.isNotBlank() }.forEach { entries.add(it) }
    }

    private fun normalizeGrammarPhrase(phrase: String): String {
        return phrase.lowercase()
            .split(Regex("[^a-z0-9]+"))
            .filter { it.isNotBlank() }
            .joinToString(" ")
    }
}
