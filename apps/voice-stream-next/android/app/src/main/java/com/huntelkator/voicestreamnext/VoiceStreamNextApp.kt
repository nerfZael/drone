package com.huntelkator.voicestreamnext

import android.app.Application
import com.clerk.api.Clerk

class VoiceStreamNextApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ClientLog.install(this)
        val publishableKey = BuildConfig.CLERK_PUBLISHABLE_KEY.trim()
        if (publishableKey.isNotBlank()) {
            Clerk.initialize(this, publishableKey = publishableKey)
        }
    }
}
