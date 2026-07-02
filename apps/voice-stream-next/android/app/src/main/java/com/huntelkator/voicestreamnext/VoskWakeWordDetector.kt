package com.huntelkator.voicestreamnext

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
    private var lastDetectedPhrase: WakePhrase? = null
    private var lastDetectedAtMs = 0L
    @Volatile private var sleepMode = false
    @Volatile private var unlockPhrase = VoicePhraseDefaults.unlockPhrase
    @Volatile private var shutdownPhrase = VoicePhraseDefaults.shutdownPhrase
    @Volatile private var approvalTriggerPhrase = "approval code"
    @Volatile private var assistantProfiles = listOf(AssistantVoiceProfile.defaultSebastian())
    private val sleepPhraseStability = SleepPhraseStability()

    fun prepare() {
        if (available || !loading.compareAndSet(false, true)) return

        onStatus("Waking local detector")
        StorageService.unpack(
            context,
            ASSET_MODEL_DIR,
            TARGET_MODEL_DIR,
            { loadedModel ->
                val loadedRecognizer = try {
                    Recognizer(loadedModel, SAMPLE_RATE_HZ.toFloat(), buildGrammarJson())
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
                    onStatus(listeningStatus())
                }
            },
            { error ->
                available = false
                loading.set(false)
                onStatus("Error: local Vosk model failed to unpack (${error.message ?: error.javaClass.simpleName})")
            },
        )
    }

    fun applyListeningSettings(
        sleepModeEnabled: Boolean,
        unlock: String,
        shutdown: String,
        approvalTrigger: String,
        profiles: List<AssistantVoiceProfile> = listOf(AssistantVoiceProfile.defaultSebastian()),
    ) {
        val nextUnlock = PhraseMatcher.normalizePhrase(unlock).ifBlank { VoicePhraseDefaults.unlockPhrase }
        val nextShutdown = PhraseMatcher.normalizePhrase(shutdown).ifBlank { VoicePhraseDefaults.shutdownPhrase }
        val nextTrigger = PhraseMatcher.normalizePhrase(approvalTrigger).ifBlank { "approval code" }
        val nextProfiles = if (profiles.isEmpty()) {
            listOf(AssistantVoiceProfile.defaultSebastian())
        } else {
            profiles.filter { it.wakePhrase.isNotBlank() }
        }
        synchronized(recognizerLock) {
            val modeChanged = sleepMode != sleepModeEnabled
            val phrasesChanged = unlockPhrase != nextUnlock ||
                shutdownPhrase != nextShutdown ||
                approvalTriggerPhrase != nextTrigger ||
                assistantProfiles != nextProfiles
            sleepMode = sleepModeEnabled
            unlockPhrase = nextUnlock
            shutdownPhrase = nextShutdown
            approvalTriggerPhrase = nextTrigger
            assistantProfiles = nextProfiles
            if (!modeChanged && !phrasesChanged) return@synchronized
            lastDetectedPhrase = null
            lastDetectedAtMs = 0L
            sleepPhraseStability.reset()
            rebuildRecognizerLocked()
            if (available) {
                onStatus(listeningStatus())
            }
        }
    }

    fun acceptPcm(frame: ByteArray, length: Int): WakePhraseMatch? {
        val (resultJson, finalResult) = synchronized(recognizerLock) {
            val localRecognizer = recognizer ?: return null
            val accepted = runCatching { localRecognizer.acceptWaveForm(frame, length) }.getOrDefault(false)
            Pair(if (accepted) localRecognizer.result else localRecognizer.partialResult, accepted)
        }
        return detectWakePhrase(resultJson, finalResult)
    }

    fun reset() {
        synchronized(recognizerLock) {
            recognizer?.runCatching { reset() }
            lastDetectedPhrase = null
            lastDetectedAtMs = 0L
            sleepPhraseStability.reset()
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
            sleepPhraseStability.reset()
        }
        loading.set(false)
    }

    private fun detectWakePhrase(json: String?, finalResult: Boolean): WakePhraseMatch? {
        if (json.isNullOrBlank()) return null
        val text = runCatching {
            val obj = JSONObject(json)
            obj.optString("partial").ifBlank { obj.optString("text") }
        }.getOrDefault("")
        if (text.isNotBlank()) {
            onText(text)
        }
        val now = SystemClock.elapsedRealtime()
        val match = if (sleepMode) {
            sleepPhraseStability.accept(
                WakePhraseMatcher.matchSleep(text, unlockPhrase, shutdownPhrase)?.phrase,
                finalResult,
                now,
            )?.let { WakePhraseMatch(it) }
        } else {
            WakePhraseMatcher.match(text, assistantProfiles, shutdownPhrase)
        } ?: return null
        val phrase = match.phrase
        val suppress = synchronized(recognizerLock) {
            phrase == lastDetectedPhrase && now - lastDetectedAtMs < PHRASE_COOLDOWN_MS
        }
        if (suppress) return null
        synchronized(recognizerLock) {
            lastDetectedPhrase = phrase
            lastDetectedAtMs = now
        }
        return match
    }

    private fun rebuildRecognizerLocked() {
        val localModel = model ?: return
        val nextRecognizer = try {
            Recognizer(localModel, SAMPLE_RATE_HZ.toFloat(), buildGrammarJson())
        } catch (error: IOException) {
            ClientLog.w("Vosk", "Failed to rebuild recognizer", error)
            return
        }
        recognizer?.runCatching { close() }
        recognizer = nextRecognizer
        available = true
        lastDetectedPhrase = null
        lastDetectedAtMs = 0L
        sleepPhraseStability.reset()
    }

    private fun buildGrammarJson(): String = JSONArray(buildGrammarEntries()).toString()

    private fun buildGrammarEntries(): List<String> {
        return if (sleepMode) {
            buildSleepGrammarEntries(unlockPhrase, shutdownPhrase)
        } else {
            buildAwakeGrammarEntries(approvalTriggerPhrase, shutdownPhrase, assistantProfiles)
        }
    }

    private fun listeningStatus(): String {
        return if (sleepMode) {
            "Sleep: say unlock or shutdown phrase"
        } else {
            "Awake: waiting for assistant wake phrase"
        }
    }

    private companion object {
        private const val ASSET_MODEL_DIR = "model-en-us"
        private const val TARGET_MODEL_DIR = "vosk-model-en-us"
        private const val SAMPLE_RATE_HZ = 16_000
        private const val PHRASE_COOLDOWN_MS = 900L
        private val AWAKE_WAKE_PHRASES = listOf(
            "patch me in",
            "can you transcribe",
            "transcribe",
            "ok stop",
            "okay stop",
            "repeat what you said",
            "go to sleep",
        )
        private val APPROVAL_GRAMMAR = listOf(
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
        )
        private val STATUS_WAKE_GRAMMAR = listOf(
            "status",
            "state us",
            "state is",
            "status check",
            "check status",
        )

        private fun buildAwakeGrammarEntries(triggerPhrase: String, shutdownPhrase: String, assistantProfiles: List<AssistantVoiceProfile>): List<String> {
            val entries = LinkedHashSet<String>()
            entries.addAll(AWAKE_WAKE_PHRASES)
            assistantProfiles.filter { it.enabled }.forEach { profile ->
                listOf(profile.wakePhrase).plus(profile.wakePhraseAliases).forEach { phrase ->
                    val wakePhrase = PhraseMatcher.normalizePhrase(phrase)
                    if (wakePhrase.isNotBlank()) entries.add(wakePhrase)
                }
            }
            entries.addAll(APPROVAL_GRAMMAR)
            entries.add(PhraseMatcher.normalizePhrase(shutdownPhrase))
            val trigger = PhraseMatcher.normalizePhrase(triggerPhrase)
            if (trigger.isNotBlank()) {
                entries.add(trigger)
            }
            if (STATUS_WAKE_COMMAND_ENABLED) {
                entries.addAll(STATUS_WAKE_GRAMMAR)
            }
            entries.add("[unk]")
            return entries.filter { it.isNotBlank() || it == "[unk]" }
        }

        private fun buildSleepGrammarEntries(unlockPhrase: String, shutdownPhrase: String): List<String> {
            val entries = LinkedHashSet<String>()
            val unlock = PhraseMatcher.normalizePhrase(unlockPhrase)
            val shutdown = PhraseMatcher.normalizePhrase(shutdownPhrase)
            if (unlock.isNotBlank()) entries.add(unlock)
            if (shutdown.isNotBlank()) entries.add(shutdown)
            entries.add("[unk]")
            return entries.toList()
        }
    }
}

object VoicePhraseDefaults {
    const val unlockPhrase = "wake up now"
    const val shutdownPhrase = "shut down completely"
}
