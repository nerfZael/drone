package com.huntelkator.voicestreamnext

import android.Manifest
import android.os.Build
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoicePermissionsTest {
    @Test
    fun candidatePermissionsAlwaysIncludeMicrophone() {
        assertTrue(VoicePermissions.candidatePermissions(Build.VERSION_CODES.O).contains(Manifest.permission.RECORD_AUDIO))
    }

    @Test
    fun candidatePermissionsIncludeNotificationPermissionOnAndroid13Plus() {
        val permissions = VoicePermissions.candidatePermissions(Build.VERSION_CODES.TIRAMISU)
        assertTrue(permissions.contains(Manifest.permission.POST_NOTIFICATIONS))
    }

    @Test
    fun candidatePermissionsOmitNotificationPermissionBeforeAndroid13() {
        val permissions = VoicePermissions.candidatePermissions(Build.VERSION_CODES.S_V2)
        assertFalse(permissions.contains(Manifest.permission.POST_NOTIFICATIONS))
    }

    @Test
    fun candidatePermissionsIncludeBluetoothConnectOnAndroid12Plus() {
        val permissions = VoicePermissions.candidatePermissions(Build.VERSION_CODES.S)
        assertTrue(permissions.contains(Manifest.permission.BLUETOOTH_CONNECT))
    }

    @Test
    fun missingPermissionsReturnsOnlyUngrantedPermissions() {
        val missing = VoicePermissions.missingPermissions(Build.VERSION_CODES.TIRAMISU) { permission ->
            permission != Manifest.permission.POST_NOTIFICATIONS
        }
        assertEquals(listOf(Manifest.permission.POST_NOTIFICATIONS), missing)
    }
}
