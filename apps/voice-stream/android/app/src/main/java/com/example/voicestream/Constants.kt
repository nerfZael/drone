package com.example.voicestream

object Constants {
    const val PREFS_NAME = "voice_stream_prefs"
    const val PREF_SERVER_URL = "server_url"
    const val PREF_AUTH_TOKEN = "auth_token"
    const val PREF_INPUT_DEVICE = "input_device"
    const val PREF_OUTPUT_DEVICE = "output_device"
    const val DEFAULT_SERVER_URL = "ws://127.0.0.1:3000/audio"

    const val ACTION_START = "com.example.voicestream.action.START"
    const val ACTION_STOP = "com.example.voicestream.action.STOP"
    const val ACTION_START_AWAKE = "com.example.voicestream.action.START_AWAKE"
    const val ACTION_STOP_AWAKE = "com.example.voicestream.action.STOP_AWAKE"
    const val ACTION_START_RECORDING = "com.example.voicestream.action.START_RECORDING"
    const val ACTION_STOP_RECORDING = "com.example.voicestream.action.STOP_RECORDING"
    const val ACTION_TOGGLE_AWAKE_SLEEP = "com.example.voicestream.action.TOGGLE_AWAKE_SLEEP"
    const val ACTION_QUERY_STATUS = "com.example.voicestream.action.QUERY_STATUS"
    const val ACTION_UPDATE_AUDIO_ROUTE = "com.example.voicestream.action.UPDATE_AUDIO_ROUTE"
    const val ACTION_STATUS = "com.example.voicestream.action.STATUS"

    const val EXTRA_SERVER_URL = "server_url"
    const val EXTRA_AUTH_TOKEN = "auth_token"
    const val EXTRA_STATUS = "status"
    const val EXTRA_MODE = "mode"
    const val EXTRA_MICROPHONE = "microphone"
    const val EXTRA_OUTPUT = "output"
    const val EXTRA_APPROVAL_STATUS = "approval_status"

    const val MODE_OFF = "off"
    const val MODE_SLEEPING = "sleeping"
    const val MODE_LOADING = "loading"
    const val MODE_AWAKE = "awake"
    const val MODE_RECORDING = "recording"
    const val MODE_ERROR = "error"

    const val SAMPLE_RATE_HZ = 16_000
    const val CHANNEL_COUNT = 1
    const val BYTES_PER_SAMPLE = 2
    const val CHUNK_MS = 20
    const val CHUNK_BYTES = SAMPLE_RATE_HZ * CHANNEL_COUNT * BYTES_PER_SAMPLE * CHUNK_MS / 1000
}
