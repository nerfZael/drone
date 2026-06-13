package com.example.voicestream

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PcmFrameBufferTest {
    @Test
    fun keepsOnlyMostRecentFrames() {
        val buffer = PcmFrameBuffer(maxFrames = 3)

        buffer.push(byteArrayOf(1))
        buffer.push(byteArrayOf(2))
        buffer.push(byteArrayOf(3))
        buffer.push(byteArrayOf(4))

        val snapshot = buffer.snapshot()
        assertEquals(3, snapshot.size)
        assertArrayEquals(byteArrayOf(2), snapshot[0])
        assertArrayEquals(byteArrayOf(3), snapshot[1])
        assertArrayEquals(byteArrayOf(4), snapshot[2])
    }

    @Test
    fun snapshotsAreDefensiveCopies() {
        val frame = byteArrayOf(1, 2)
        val buffer = PcmFrameBuffer(maxFrames = 2)

        buffer.push(frame)
        frame[0] = 9
        val snapshot = buffer.snapshot()
        snapshot[0][1] = 8

        assertArrayEquals(byteArrayOf(1, 2), buffer.snapshot()[0])
    }

    @Test
    fun drainReturnsFramesAndClearsBuffer() {
        val buffer = PcmFrameBuffer(maxFrames = 2)
        buffer.push(byteArrayOf(1))
        buffer.push(byteArrayOf(2))

        val drained = buffer.drain()

        assertEquals(2, drained.size)
        assertEquals(0, buffer.size())
    }
}
