package com.example.voicestream

class WakeToggleController {
    var state: WakeState = WakeState.OFF
        private set

    fun startAwake(): WakeAction {
        state = WakeState.AWAKE
        return WakeAction.NONE
    }

    fun toggleAwakeSleep(): WakeAction {
        return when (state) {
            WakeState.RECORDING -> {
                state = WakeState.AWAKE
                WakeAction.STOP_RECORDING
            }
            WakeState.AWAKE -> {
                state = WakeState.SLEEPING
                WakeAction.NONE
            }
            WakeState.SLEEPING -> {
                state = WakeState.AWAKE
                WakeAction.NONE
            }
            WakeState.OFF,
            WakeState.ERROR -> WakeAction.NONE
        }
    }

    fun stopAll(): WakeAction {
        val action = if (state == WakeState.RECORDING) WakeAction.STOP_RECORDING else WakeAction.NONE
        state = WakeState.OFF
        return action
    }

    fun wakeDetected(phrase: WakePhrase): WakeAction {
        return when (state) {
            WakeState.AWAKE -> {
                if (phrase.hasStart) {
                    state = WakeState.RECORDING
                    WakeAction.START_RECORDING
                } else if (phrase.hasRealTime) {
                    state = WakeState.RECORDING
                    WakeAction.START_REALTIME_RECORDING
                } else if (phrase.hasPatch) {
                    state = WakeState.RECORDING
                    WakeAction.START_PATCH_RECORDING
                } else if (phrase.hasClipboard) {
                    state = WakeState.RECORDING
                    WakeAction.START_CLIPBOARD_RECORDING
                } else if (phrase.hasSleep) {
                    state = WakeState.SLEEPING
                    WakeAction.ENTER_SLEEPING
                } else if (phrase.hasStatus) {
                    WakeAction.PLAY_STATUS
                } else {
                    WakeAction.NONE
                }
            }
            WakeState.RECORDING -> {
                if (phrase.hasSleep) {
                    state = WakeState.SLEEPING
                    WakeAction.ENTER_SLEEPING
                } else {
                    WakeAction.NONE
                }
            }
            WakeState.SLEEPING, WakeState.OFF, WakeState.ERROR -> WakeAction.NONE
        }
    }

    fun wakeFromSleep(): WakeAction {
        state = WakeState.AWAKE
        return WakeAction.NONE
    }

    fun enterSleeping(): WakeAction {
        val action = if (state == WakeState.RECORDING) WakeAction.STOP_RECORDING else WakeAction.NONE
        state = WakeState.SLEEPING
        return action
    }

    fun manualStartRecording(): WakeAction {
        state = WakeState.RECORDING
        return WakeAction.START_RECORDING
    }

    fun manualStopRecording(returnToAwake: Boolean): WakeAction {
        state = if (returnToAwake) WakeState.AWAKE else WakeState.OFF
        return WakeAction.STOP_RECORDING
    }

    fun error(): WakeAction {
        val action = if (state == WakeState.RECORDING) WakeAction.STOP_RECORDING else WakeAction.NONE
        state = WakeState.ERROR
        return action
    }
}

enum class WakeState {
    OFF,
    AWAKE,
    SLEEPING,
    RECORDING,
    ERROR,
}

enum class WakeAction {
    NONE,
    START_RECORDING,
    START_REALTIME_RECORDING,
    START_PATCH_RECORDING,
    START_CLIPBOARD_RECORDING,
    STOP_RECORDING,
    ENTER_SLEEPING,
    PLAY_STATUS,
}
