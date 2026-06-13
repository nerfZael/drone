package com.huntelkator.voicestreamnext

import android.Manifest
import android.os.Build

object VoicePermissions {
    fun candidatePermissions(sdkInt: Int): List<String> {
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (sdkInt >= Build.VERSION_CODES.TIRAMISU) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
        }
        if (sdkInt >= Build.VERSION_CODES.S) {
            permissions += Manifest.permission.BLUETOOTH_CONNECT
        }
        return permissions
    }

    fun missingPermissions(sdkInt: Int, isGranted: (String) -> Boolean): List<String> {
        return candidatePermissions(sdkInt).filterNot(isGranted)
    }
}
