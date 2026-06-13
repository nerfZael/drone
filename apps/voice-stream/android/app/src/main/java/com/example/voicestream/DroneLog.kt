package com.example.voicestream

import android.content.Context
import android.util.Log
import java.io.File
import java.time.Instant

object DroneLog {
    private const val LOG_TAG = "Drone"
    private const val MAX_LOG_BYTES = 512 * 1024
    private const val LOG_FILE = "drone-debug.log"

    @Volatile private var appContext: Context? = null
    @Volatile private var crashHandlerInstalled = false

    fun install(context: Context) {
        appContext = context.applicationContext
        if (crashHandlerInstalled) return
        crashHandlerInstalled = true
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            e("Crash", "Uncaught exception on ${thread.name}", error)
            previous?.uncaughtException(thread, error)
        }
        i("Startup", "Diagnostics writing to ${path(context)}")
    }

    fun i(tag: String, message: String) {
        Log.i("$LOG_TAG/$tag", message)
        write("INFO", tag, message, null)
    }

    fun w(tag: String, message: String, error: Throwable? = null) {
        Log.w("$LOG_TAG/$tag", message, error)
        write("WARN", tag, message, error)
    }

    fun e(tag: String, message: String, error: Throwable? = null) {
        Log.e("$LOG_TAG/$tag", message, error)
        write("ERROR", tag, message, error)
    }

    fun path(context: Context): String {
        return file(context.applicationContext).absolutePath
    }

    fun read(context: Context): String {
        return runCatching {
            val logFile = file(context.applicationContext)
            if (logFile.exists()) logFile.readText() else ""
        }.getOrDefault("")
    }

    @Synchronized
    private fun write(level: String, tag: String, message: String, error: Throwable?) {
        val context = appContext ?: return
        val logFile = file(context)
        runCatching {
            logFile.parentFile?.mkdirs()
            if (logFile.exists() && logFile.length() > MAX_LOG_BYTES) {
                logFile.writeText("")
            }
            val stack = error?.stackTraceToString()?.let { "\n$it" }.orEmpty()
            logFile.appendText("${Instant.now()} $level $tag: $message$stack\n")
        }
    }

    private fun file(context: Context): File {
        return File(context.getExternalFilesDir(null) ?: context.filesDir, LOG_FILE)
    }
}
