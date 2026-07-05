package com.example.voicestream

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.os.Build

class AudioDeviceRouter(private val context: Context) {
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
    private var originalMode: Int? = null
    private var bluetoothScoStarted = false
    private var communicationDeviceSet = false

    fun inputOptions(): List<AudioRouteOption> {
        return listOf(AudioRouteOption(AUDIO_DEVICE_AUTO, "Auto microphone")) +
            getInputDevices()
                .sortedWith(compareBy<AudioDeviceInfo> { inputPriorityFor(it.type) }.thenBy { safeName(it) })
                .map { device ->
                    AudioRouteOption(devicePreferenceValue(device), inputLabelFor(device), device)
                }
    }

    fun outputOptions(): List<AudioRouteOption> {
        return listOf(AudioRouteOption(AUDIO_DEVICE_AUTO, "Auto output")) +
            getOutputDevices()
                .sortedWith(compareBy<AudioDeviceInfo> { outputPriorityFor(it.type) }.thenBy { safeName(it) })
                .map { device ->
                    AudioRouteOption(devicePreferenceValue(device), outputLabelFor(device), device)
                }
    }

    fun preferredInputValue(): String = prefs.getString(Constants.PREF_INPUT_DEVICE, AUDIO_DEVICE_AUTO) ?: AUDIO_DEVICE_AUTO

    fun preferredOutputValue(): String = prefs.getString(Constants.PREF_OUTPUT_DEVICE, AUDIO_DEVICE_AUTO) ?: AUDIO_DEVICE_AUTO

    fun savePreferredInput(value: String) {
        prefs.edit().putString(Constants.PREF_INPUT_DEVICE, value).apply()
    }

    fun savePreferredOutput(value: String) {
        prefs.edit().putString(Constants.PREF_OUTPUT_DEVICE, value).apply()
    }

    fun routeForRecording(recorder: AudioRecord): AudioRouteSelection {
        val selection = chooseInput()
        DroneLog.i("AudioRoute", "Selected input ${selection.label}")

        releaseRecordingRouting()
        if (selection.isBluetoothInput) {
            enterCommunicationMode()
            enableBluetoothInputRouting(selection.device)
        }

        setPreferredInputDevice(recorder, selection.device)

        return selection
    }

    fun routeForPlayback(player: AudioTrack): AudioRouteSelection {
        val selection = chooseOutput()
        DroneLog.i("AudioRoute", "Selected output ${selection.label}")
        setPreferredOutputDevice(player, selection.device)
        return selection
    }

    fun describeSelectedInput(): String {
        return chooseInput().label
    }

    fun describeSelectedOutput(): String {
        return chooseOutput().label
    }

    fun releaseRecordingRouting() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && communicationDeviceSet) {
            runCatching { audioManager.clearCommunicationDevice() }
                .onFailure { error -> DroneLog.w("AudioRoute", "Could not clear communication device", error) }
        }
        if (bluetoothScoStarted) {
            @Suppress("DEPRECATION")
            runCatching { audioManager.isBluetoothScoOn = false }
                .onFailure { error -> DroneLog.w("AudioRoute", "Could not disable Bluetooth SCO flag", error) }
            @Suppress("DEPRECATION")
            runCatching { audioManager.stopBluetoothSco() }
                .onFailure { error -> DroneLog.w("AudioRoute", "Could not stop Bluetooth SCO", error) }
        }
        originalMode?.let { mode ->
            runCatching { audioManager.mode = mode }
                .onFailure { error -> DroneLog.w("AudioRoute", "Could not restore audio mode", error) }
        }
        originalMode = null
        bluetoothScoStarted = false
        communicationDeviceSet = false
    }

    private fun chooseInput(): AudioRouteSelection {
        val inputs = getInputDevices()
        val preferredValue = preferredInputValue()
        val device = if (preferredValue == AUDIO_DEVICE_AUTO) {
            inputs.sortedWith(compareBy<AudioDeviceInfo> { inputPriorityFor(it.type) }.thenBy { safeName(it) }).firstOrNull()
        } else {
            inputs.firstOrNull { devicePreferenceValue(it) == preferredValue }
                ?: inputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
        }

        return if (device == null) {
            AudioRouteSelection(null, "Mic: phone", isBluetoothInput = false)
        } else {
            AudioRouteSelection(device, inputLabelFor(device), isBluetoothInput = device.isBluetoothInput())
        }
    }

    private fun chooseOutput(): AudioRouteSelection {
        val outputs = getOutputDevices()
        val preferredValue = preferredOutputValue()
        val device = if (preferredValue == AUDIO_DEVICE_AUTO) {
            null
        } else {
            outputs.firstOrNull { devicePreferenceValue(it) == preferredValue }
        }

        return if (device == null) {
            AudioRouteSelection(null, "Out: auto", isBluetoothInput = false)
        } else {
            AudioRouteSelection(device, outputLabelFor(device), isBluetoothInput = false)
        }
    }

    private fun getInputDevices(): List<AudioDeviceInfo> {
        return runCatching {
            audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                .filter { it.isSource }
                .filter { device ->
                    if (device.isBluetoothInput()) hasBluetoothConnectPermission() else true
                }
        }.onFailure { error ->
            DroneLog.w("AudioRoute", "Could not enumerate input devices", error)
        }.getOrDefault(emptyList())
    }

    private fun getOutputDevices(): List<AudioDeviceInfo> {
        return runCatching {
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                .filter { it.isSink }
                .filter { it.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
                .filter { device ->
                    if (device.isBluetoothOutput()) hasBluetoothConnectPermission() else true
                }
        }.onFailure { error ->
            DroneLog.w("AudioRoute", "Could not enumerate output devices", error)
        }.getOrDefault(emptyList())
    }

    private fun enterCommunicationMode() {
        runCatching {
            if (originalMode == null) {
                originalMode = audioManager.mode
            }
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        }.onFailure { error ->
            DroneLog.w("AudioRoute", "Could not enter communication audio mode", error)
        }
    }

    @SuppressLint("MissingPermission")
    private fun enableBluetoothInputRouting(device: AudioDeviceInfo?) {
        if (!hasBluetoothConnectPermission()) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val communicationDevice = runCatching {
                audioManager.availableCommunicationDevices
                    .firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.safeIsBleHeadset() }
                    ?: device
            }.onFailure { error ->
                DroneLog.w("AudioRoute", "Could not enumerate communication devices", error)
            }.getOrNull()
            if (communicationDevice != null) {
                communicationDeviceSet = runCatching {
                    audioManager.setCommunicationDevice(communicationDevice)
                }.onFailure { error ->
                    DroneLog.w("AudioRoute", "Could not set Bluetooth communication device", error)
                }.getOrDefault(false)
            }
        } else {
            @Suppress("DEPRECATION")
            runCatching { audioManager.startBluetoothSco() }
                .onFailure { error -> DroneLog.w("AudioRoute", "Could not start Bluetooth SCO", error) }
            @Suppress("DEPRECATION")
            runCatching { audioManager.isBluetoothScoOn = true }
                .onFailure { error -> DroneLog.w("AudioRoute", "Could not enable Bluetooth SCO flag", error) }
            bluetoothScoStarted = true
        }
    }

    private fun setPreferredInputDevice(recorder: AudioRecord, device: AudioDeviceInfo?) {
        runCatching { recorder.setPreferredDevice(device) }
            .onSuccess { applied ->
                if (!applied) {
                    DroneLog.w("AudioRoute", "Android did not apply preferred input device")
                }
            }
            .onFailure { error -> DroneLog.w("AudioRoute", "Could not set preferred input device", error) }
    }

    private fun setPreferredOutputDevice(player: AudioTrack, device: AudioDeviceInfo?) {
        runCatching { player.setPreferredDevice(device) }
            .onSuccess { applied ->
                if (!applied) {
                    DroneLog.w("AudioRoute", "Android did not apply preferred output device")
                }
            }
            .onFailure { error -> DroneLog.w("AudioRoute", "Could not set preferred output device", error) }
    }

    private fun hasBluetoothConnectPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    }

    private fun inputLabelFor(device: AudioDeviceInfo): String {
        val name = safeName(device)
        val generic = when {
            device.isBluetoothInput() -> "Bluetooth microphone"
            device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired headset mic"
            device.type == AudioDeviceInfo.TYPE_USB_HEADSET || device.type == AudioDeviceInfo.TYPE_USB_DEVICE -> "USB microphone"
            device.type == AudioDeviceInfo.TYPE_BUILTIN_MIC -> "phone"
            else -> "external mic"
        }
        return if (name.isBlank() || name.equals(generic, ignoreCase = true)) {
            "Mic: $generic"
        } else {
            "Mic: $name"
        }
    }

    private fun outputLabelFor(device: AudioDeviceInfo): String {
        val name = safeName(device)
        val generic = when {
            device.isBluetoothOutput() -> "Bluetooth"
            device.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> "headphones"
            device.type == AudioDeviceInfo.TYPE_USB_HEADSET || device.type == AudioDeviceInfo.TYPE_USB_DEVICE -> "USB audio"
            device.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "phone speaker"
            device.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
            else -> "external output"
        }
        return if (name.isBlank() || name.equals(generic, ignoreCase = true)) {
            "Out: $generic"
        } else {
            "Out: $name"
        }
    }

    private fun inputPriorityFor(type: Int): Int {
        return when {
            type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type.safeIsBleHeadsetType() -> 0
            type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> 1
            type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_DEVICE -> 2
            type == AudioDeviceInfo.TYPE_BUILTIN_MIC -> 3
            else -> 4
        }
    }

    private fun outputPriorityFor(type: Int): Int {
        return when {
            type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type.safeIsBleHeadsetType() -> 0
            type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> 1
            type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_DEVICE -> 2
            type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> 3
            type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> 4
            else -> 5
        }
    }

    private fun devicePreferenceValue(device: AudioDeviceInfo): String {
        if (device.type == AudioDeviceInfo.TYPE_BUILTIN_MIC) return AUDIO_DEVICE_BUILTIN_MIC
        if (device.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return AUDIO_DEVICE_BUILTIN_SPEAKER
        return listOf(
            AUDIO_DEVICE_PREFIX,
            device.type.toString(),
            safeName(device).lowercase()
        ).joinToString(":")
    }

    private fun safeName(device: AudioDeviceInfo): String {
        return runCatching { device.productName?.toString().orEmpty().trim() }.getOrDefault("")
    }

    private fun AudioDeviceInfo.isBluetoothInput(): Boolean {
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || safeIsBleHeadset()
    }

    private fun AudioDeviceInfo.isBluetoothOutput(): Boolean {
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
            safeIsBleHeadset()
    }

    private fun AudioDeviceInfo.safeIsBleHeadset(): Boolean {
        return type.safeIsBleHeadsetType()
    }

    private fun Int.safeIsBleHeadsetType(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && this == AudioDeviceInfo.TYPE_BLE_HEADSET
    }

    companion object {
        const val AUDIO_DEVICE_AUTO = "auto"
        private const val AUDIO_DEVICE_BUILTIN_MIC = "built_in_mic"
        private const val AUDIO_DEVICE_BUILTIN_SPEAKER = "built_in_speaker"
        private const val AUDIO_DEVICE_PREFIX = "device"
    }
}

data class AudioRouteOption(
    val value: String,
    val label: String,
    val device: AudioDeviceInfo? = null
)

data class AudioRouteSelection(
    val device: AudioDeviceInfo?,
    val label: String,
    val isBluetoothInput: Boolean
)
