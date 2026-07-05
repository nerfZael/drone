package com.huntelkator.voicestreamnext

import android.content.Context

object AssistantSpeechPlaybackVolume {
    fun percent(context: Context): Int {
        return context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            .getInt(Constants.PREF_ASSISTANT_SPEECH_PLAYBACK_VOLUME_PERCENT, Constants.ASSISTANT_SPEECH_PLAYBACK_VOLUME_DEFAULT_PERCENT)
            .coerceIn(Constants.ASSISTANT_SPEECH_PLAYBACK_VOLUME_MIN_PERCENT, Constants.ASSISTANT_SPEECH_PLAYBACK_VOLUME_MAX_PERCENT)
    }

    fun gain(percent: Int): Double = percent.coerceIn(
        Constants.ASSISTANT_SPEECH_PLAYBACK_VOLUME_MIN_PERCENT,
        Constants.ASSISTANT_SPEECH_PLAYBACK_VOLUME_MAX_PERCENT,
    ) / 100.0
}