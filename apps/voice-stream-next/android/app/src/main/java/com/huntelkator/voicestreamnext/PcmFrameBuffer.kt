package com.huntelkator.voicestreamnext

class PcmFrameBuffer(private val maxFrames: Int) {
    private val frames = ArrayDeque<ByteArray>()

    @Synchronized
    fun push(frame: ByteArray) {
        if (maxFrames <= 0) return
        frames.addLast(frame.copyOf())
        trimToMaxFrames()
    }

    @Synchronized
    fun pushAll(newFrames: List<ByteArray>) {
        if (maxFrames <= 0) return
        for (frame in newFrames) {
            frames.addLast(frame.copyOf())
        }
        trimToMaxFrames()
    }

    @Synchronized
    fun drain(): List<ByteArray> {
        val output = frames.map { it.copyOf() }
        frames.clear()
        return output
    }

    @Synchronized
    fun clear() {
        frames.clear()
    }

    private fun trimToMaxFrames() {
        while (frames.size > maxFrames) {
            frames.removeFirst()
        }
    }
}
