package com.huntelkator.voicestreamnext

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
                WakeAction.NONE
            }
            WakeState.SLEEPING, WakeState.OFF, WakeState.ERROR -> WakeAction.NONE
        }
    }

    fun manualStartRecording(): WakeAction {
        state = WakeState.RECORDING
        return WakeAction.START_RECORDING
    }

    fun manualStopRecording(returnToAwake: Boolean): WakeAction {
        state = if (returnToAwake) WakeState.AWAKE else WakeState.OFF
        return WakeAction.STOP_RECORDING
    }

    fun applyServiceMode(mode: String) {
        state = when (mode) {
            Constants.MODE_LOADING -> state
            Constants.MODE_AWAKE -> WakeState.AWAKE
            Constants.MODE_SLEEPING -> WakeState.SLEEPING
            Constants.MODE_RECORDING -> WakeState.RECORDING
            Constants.MODE_ERROR -> WakeState.ERROR
            else -> WakeState.OFF
        }
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
    START_PATCH_RECORDING,
    START_CLIPBOARD_RECORDING,
    STOP_RECORDING,
    ENTER_SLEEPING,
    PLAY_STATUS,
}
