package com.huntelkator.voicestreamnext

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID

data class SpeechHistoryEntry(
    val id: String,
    val createdAt: String,
    val text: String?,
    val source: String?,
    val contentType: String,
    val fileName: String,
    val bytes: Int,
)

object SpeechHistoryStore {
    private const val MAX_ENTRIES = 10
    private const val DIRECTORY_NAME = "speech-history"
    private const val INDEX_FILE = "history.json"

    @Synchronized
    fun add(
        context: Context,
        audio: ByteArray,
        text: String? = null,
        source: String? = null,
        contentType: String = "audio/wav",
    ): SpeechHistoryEntry {
        val directory = directory(context)
        directory.mkdirs()

        val now = Instant.now().toString()
        val id = UUID.randomUUID().toString()
        val fileName = "$id${extensionFor(contentType, audio)}"
        directory.resolve(fileName).writeBytes(audio)

        val entry = SpeechHistoryEntry(
            id = id,
            createdAt = now,
            text = text?.trim()?.takeIf { it.isNotBlank() }?.take(240),
            source = source?.trim()?.takeIf { it.isNotBlank() }?.take(80),
            contentType = contentType.ifBlank { "audio/wav" },
            fileName = fileName,
            bytes = audio.size,
        )

        val kept = (listInternal(directory) + entry)
            .sortedByDescending { it.createdAt }
            .take(MAX_ENTRIES)
        writeIndex(directory, kept)
        deleteUnreferencedFiles(directory, kept)
        return entry
    }

    @Synchronized
    fun list(context: Context): List<SpeechHistoryEntry> {
        return listInternal(directory(context)).sortedBy { it.createdAt }
    }

    @Synchronized
    fun readAudio(context: Context, entry: SpeechHistoryEntry): ByteArray? {
        val file = directory(context).resolve(entry.fileName)
        return if (file.isFile) file.readBytes() else null
    }

    private fun directory(context: Context): File = File(context.filesDir, DIRECTORY_NAME)

    private fun listInternal(directory: File): List<SpeechHistoryEntry> {
        val index = directory.resolve(INDEX_FILE)
        if (!index.isFile) return emptyList()
        val array = runCatching { JSONArray(index.readText()) }.getOrNull() ?: return emptyList()
        return buildList {
            for (position in 0 until array.length()) {
                val item = array.optJSONObject(position) ?: continue
                val entry = SpeechHistoryEntry(
                    id = item.optString("id").takeIf { it.isNotBlank() } ?: continue,
                    createdAt = item.optString("createdAt"),
                    text = item.optString("text").takeIf { it.isNotBlank() },
                    source = item.optString("source").takeIf { it.isNotBlank() },
                    contentType = item.optString("contentType", "audio/wav"),
                    fileName = item.optString("fileName").takeIf { it.isNotBlank() } ?: continue,
                    bytes = item.optInt("bytes", 0),
                )
                if (directory.resolve(entry.fileName).isFile) add(entry)
            }
        }
    }

    private fun writeIndex(directory: File, entries: List<SpeechHistoryEntry>) {
        val array = JSONArray()
        entries.forEach { entry ->
            array.put(JSONObject()
                .put("id", entry.id)
                .put("createdAt", entry.createdAt)
                .put("text", entry.text ?: "")
                .put("source", entry.source ?: "")
                .put("contentType", entry.contentType)
                .put("fileName", entry.fileName)
                .put("bytes", entry.bytes))
        }
        directory.resolve(INDEX_FILE).writeText(array.toString())
    }

    private fun deleteUnreferencedFiles(directory: File, entries: List<SpeechHistoryEntry>) {
        val keep = entries.map { it.fileName }.toSet() + INDEX_FILE
        directory.listFiles()?.forEach { file ->
            if (file.isFile && file.name !in keep) {
                runCatching { file.delete() }
            }
        }
    }

    private fun extensionFor(contentType: String, audio: ByteArray): String {
        val normalized = contentType.lowercase()
        return when {
            normalized.contains("wav") -> ".wav"
            normalized.contains("mpeg") || normalized.contains("mp3") -> ".mp3"
            normalized.contains("ogg") -> ".ogg"
            normalized.contains("mp4") || normalized.contains("m4a") -> ".m4a"
            audio.size >= 12 && ascii(audio, 0, 4) == "RIFF" && ascii(audio, 8, 4) == "WAVE" -> ".wav"
            else -> ".bin"
        }
    }

    private fun ascii(bytes: ByteArray, offset: Int, length: Int): String {
        if (offset < 0 || length < 0 || offset + length > bytes.size) return ""
        return String(bytes, offset, length, Charsets.US_ASCII)
    }
}
