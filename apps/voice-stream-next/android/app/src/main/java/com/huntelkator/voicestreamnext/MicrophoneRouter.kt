package com.huntelkator.voicestreamnext

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecord
import android.os.Build

class MicrophoneRouter(private val context: Context) {
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

    private var originalMode: Int? = null
    private var bluetoothScoStarted = false
    private var communicationDeviceSet = false

    fun describeCurrentSelection(): String = chooseInput().label

    fun routeForRecording(recorder: AudioRecord): MicrophoneSelection {
        val selection = chooseInput()
        runCatching {
            if (originalMode == null) {
                originalMode = audioManager.mode
            }
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        }

        applyCommunicationRouting(selection)
        if (applyPreferredDevice(recorder, selection) || selection.isAuto) {
            return selection
        }

        ClientLog.w("MicrophoneRouter", "Android rejected selected microphone route ${selection.label}")
        clearSelectedDevice()
        val fallback = chooseAutoInput()
        applyCommunicationRouting(fallback)
        applyPreferredDevice(recorder, fallback)
        return fallback
    }

    fun releaseRouting() {
        releaseCommunicationDeviceRouting()
        originalMode?.let { mode ->
            runCatching { audioManager.mode = mode }
        }
        originalMode = null
    }

    fun pickerOptions(): List<MicrophonePickerOption> {
        val devices = sortedInputDevices()
        val autoSelection = chooseAutoInput(devices)
        val selectedKey = currentSelectionKey(devices).takeUnless { it == AUTO_DEVICE_KEY }.orEmpty()
        return buildList {
            add(
                MicrophonePickerOption(
                    key = AUTO_DEVICE_KEY,
                    label = "Auto (${autoSelection.deviceLabel})",
                    isSelected = selectedKey.isBlank(),
                )
            )
            devices.forEach { device ->
                val key = deviceKey(device)
                add(
                    MicrophonePickerOption(
                        key = key,
                        label = deviceLabel(device),
                        isSelected = selectedKey == key,
                    )
                )
            }
        }
    }

    fun currentSelectionKey(): String = currentSelectionKey(sortedInputDevices())

    private fun currentSelectionKey(devices: List<AudioDeviceInfo>): String {
        val storedKey = selectedDeviceKey()
        if (storedKey.isBlank()) return AUTO_DEVICE_KEY
        if (devices.any { deviceKey(it) == storedKey }) return storedKey
        clearSelectedDevice()
        return AUTO_DEVICE_KEY
    }

    fun saveSelectedDeviceKey(key: String) {
        val cleanKey = key.trim()
        if (cleanKey.isBlank() || cleanKey == AUTO_DEVICE_KEY) {
            prefs.edit().remove(Constants.PREF_MICROPHONE_DEVICE_KEY).apply()
            return
        }
        val deviceStillAvailable = sortedInputDevices().any { deviceKey(it) == cleanKey }
        if (deviceStillAvailable) {
            prefs.edit().putString(Constants.PREF_MICROPHONE_DEVICE_KEY, cleanKey).apply()
        } else {
            clearSelectedDevice()
        }
    }

    private fun chooseInput(): MicrophoneSelection {
        val devices = sortedInputDevices()
        val selectedKey = selectedDeviceKey()
        if (selectedKey.isNotBlank()) {
            val selected = devices.firstOrNull { deviceKey(it) == selectedKey }
            if (selected != null) {
                val label = deviceLabel(selected)
                return MicrophoneSelection(
                    device = selected,
                    label = "Mic: $label",
                    deviceLabel = label,
                    isBluetooth = selected.isBluetoothInput(),
                    isAuto = false,
                )
            }
            clearSelectedDevice()
        }
        return chooseAutoInput(devices)
    }

    private fun chooseAutoInput(devices: List<AudioDeviceInfo> = sortedInputDevices()): MicrophoneSelection {
        val preferred = devices.firstOrNull()
        if (preferred == null) {
            return MicrophoneSelection(
                device = null,
                label = "Mic: Auto (phone)",
                deviceLabel = "phone",
                isBluetooth = false,
                isAuto = true,
            )
        }
        val label = deviceLabel(preferred)
        return MicrophoneSelection(
            device = preferred,
            label = "Mic: Auto ($label)",
            deviceLabel = label,
            isBluetooth = preferred.isBluetoothInput(),
            isAuto = true,
        )
    }

    private fun selectedDeviceKey(): String {
        return prefs.getString(Constants.PREF_MICROPHONE_DEVICE_KEY, "").orEmpty()
    }

    private fun clearSelectedDevice() {
        prefs.edit().remove(Constants.PREF_MICROPHONE_DEVICE_KEY).apply()
    }

    private fun sortedInputDevices(): List<AudioDeviceInfo> {
        return getInputDevices()
            .sortedWith(compareBy<AudioDeviceInfo> { priorityFor(it.type) }.thenBy { safeName(it) })
    }

    private fun getInputDevices(): List<AudioDeviceInfo> {
        return runCatching {
            audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                .filter { it.isSource }
                .filter { device -> !device.isBluetoothInput() || hasBluetoothConnectPermission() }
        }.getOrDefault(emptyList())
    }

    private fun releaseCommunicationDeviceRouting() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && communicationDeviceSet) {
            runCatching { audioManager.clearCommunicationDevice() }
        }
        if (bluetoothScoStarted) {
            @Suppress("DEPRECATION")
            runCatching { audioManager.isBluetoothScoOn = false }
            @Suppress("DEPRECATION")
            runCatching { audioManager.stopBluetoothSco() }
        }
        bluetoothScoStarted = false
        communicationDeviceSet = false
    }

    private fun applyCommunicationRouting(selection: MicrophoneSelection) {
        if (selection.isBluetooth) {
            enableBluetoothRouting(selection.device)
        } else {
            releaseCommunicationDeviceRouting()
        }
    }

    private fun applyPreferredDevice(recorder: AudioRecord, selection: MicrophoneSelection): Boolean {
        val device = selection.device ?: return true
        return runCatching { recorder.setPreferredDevice(device) }.getOrDefault(false)
    }

    @SuppressLint("MissingPermission")
    private fun enableBluetoothRouting(device: AudioDeviceInfo?) {
        if (!hasBluetoothConnectPermission()) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val communicationDevice = runCatching {
                audioManager.availableCommunicationDevices
                    .firstOrNull { available -> device != null && deviceKey(available) == deviceKey(device) }
                    ?: audioManager.availableCommunicationDevices
                        .firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.safeIsBleHeadset() }
                    ?: device
            }.getOrNull()
            if (communicationDevice != null) {
                communicationDeviceSet = runCatching {
                    audioManager.setCommunicationDevice(communicationDevice)
                }.getOrDefault(false)
            }
        } else {
            @Suppress("DEPRECATION")
            runCatching { audioManager.startBluetoothSco() }
            @Suppress("DEPRECATION")
            runCatching { audioManager.isBluetoothScoOn = true }
            bluetoothScoStarted = true
        }
    }

    private fun hasBluetoothConnectPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    }

    private fun deviceLabel(device: AudioDeviceInfo): String {
        val name = safeName(device)
        val generic = when {
            device.isBluetoothInput() -> "Bluetooth headset"
            device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired headset"
            device.type == AudioDeviceInfo.TYPE_USB_HEADSET || device.type == AudioDeviceInfo.TYPE_USB_DEVICE -> "USB headset"
            device.type == AudioDeviceInfo.TYPE_BUILTIN_MIC -> "phone"
            else -> "external mic"
        }
        return if (name.isBlank() || name.equals(generic, ignoreCase = true)) generic else name
    }

    private fun priorityFor(type: Int): Int {
        return when {
            type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type.safeIsBleHeadsetType() -> 0
            type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> 1
            type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_DEVICE -> 2
            type == AudioDeviceInfo.TYPE_BUILTIN_MIC -> 3
            else -> 4
        }
    }

    private fun safeName(device: AudioDeviceInfo): String {
        return runCatching { device.productName?.toString().orEmpty().trim() }.getOrDefault("")
    }

    private fun safeAddress(device: AudioDeviceInfo): String {
        return runCatching { device.address.orEmpty().trim() }.getOrDefault("")
    }

    private fun deviceKey(device: AudioDeviceInfo): String {
        return listOf(device.type.toString(), safeName(device), safeAddress(device))
            .joinToString("|") { part -> part.replace("|", "/") }
    }

    private fun AudioDeviceInfo.isBluetoothInput(): Boolean {
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || safeIsBleHeadset()
    }

    private fun AudioDeviceInfo.safeIsBleHeadset(): Boolean {
        return type.safeIsBleHeadsetType()
    }

    private fun Int.safeIsBleHeadsetType(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && this == AudioDeviceInfo.TYPE_BLE_HEADSET
    }
}

data class MicrophoneSelection(
    val device: AudioDeviceInfo?,
    val label: String,
    val deviceLabel: String,
    val isBluetooth: Boolean,
    val isAuto: Boolean,
)

data class MicrophonePickerOption(
    val key: String,
    val label: String,
    val isSelected: Boolean,
)

private const val AUTO_DEVICE_KEY = "auto"
