package com.huntelkator.voicestreamnext

data class StreamStatus(
    val text: String,
    val microphone: String = "",
    val approvalStatus: String = "",
)
