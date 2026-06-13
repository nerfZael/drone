package com.example.voicestream

import android.Manifest
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    private lateinit var urlInput: EditText
    private lateinit var pairingInput: EditText
    private lateinit var pairingText: TextView
    private lateinit var statusText: TextView
    private lateinit var approvalText: TextView
    private lateinit var microphoneText: TextView
    private lateinit var awakeButton: Button
    private lateinit var offButton: Button
    private lateinit var root: LinearLayout
    private lateinit var settingsPanel: View
    private lateinit var settingsButton: Button
    private lateinit var qrButton: ImageButton
    private val cuePlayer = LocalCuePlayer()
    private var sessionMode = SessionMode.OFF

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            launchQrScanner()
        } else {
            showPairingMessage("Camera permission denied. Paste the QR text instead.")
        }
    }

    private val qrScanLauncher = registerForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (contents.isNullOrBlank()) {
            showPairingMessage("QR scan cancelled")
        } else {
            applyPairingPayload(contents)
        }
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val status = intent.getStringExtra(Constants.EXTRA_STATUS) ?: "Unknown"
            val mode = SessionMode.fromValue(intent.getStringExtra(Constants.EXTRA_MODE), status)
            val microphone = intent.getStringExtra(Constants.EXTRA_MICROPHONE)
            val approvalStatus = intent.getStringExtra(Constants.EXTRA_APPROVAL_STATUS).orEmpty()
            updateSessionUi(mode, status)
            updateApprovalUi(mode, approvalStatus)
            if (!microphone.isNullOrBlank()) {
                updateMicrophoneUi(microphone)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        DroneLog.install(applicationContext)
        DroneLog.i("Activity", "MainActivity created")

        val prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        DroneLogUploader.upload(
            this,
            prefs.getString(Constants.PREF_SERVER_URL, Constants.DEFAULT_SERVER_URL).orEmpty(),
            prefs.getString(Constants.PREF_AUTH_TOKEN, "").orEmpty(),
            "activity-start",
            force = true
        )
        window.statusBarColor = COLOR_BACKGROUND
        window.navigationBarColor = COLOR_BACKGROUND

        val screen = FrameLayout(this).apply {
            setBackgroundColor(COLOR_BACKGROUND)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24.dp(), 58.dp(), 24.dp(), 196.dp())
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        screen.addView(root)

        root.addView(TextView(this).apply {
            text = "Drone"
            textSize = 34f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(COLOR_TEXT)
            includeFontPadding = false
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        })

        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
            awakeButton = Button(this@MainActivity).apply {
                setOnClickListener { toggleAwakeSleep() }
                styleActionButton(SessionMode.OFF)
            }
            addView(awakeButton, LinearLayout.LayoutParams(
                166.dp(),
                166.dp()
            ))
            offButton = Button(this@MainActivity).apply {
                text = "Off"
                visibility = View.GONE
                styleOffButton()
                setOnClickListener { turnOff() }
            }
            addView(offButton, LinearLayout.LayoutParams(
                148.dp(),
                48.dp()
            ).apply {
                topMargin = 18.dp()
            })
        })

        statusText = TextView(this).apply {
            text = "Off"
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(COLOR_MUTED)
            gravity = Gravity.CENTER
            includeFontPadding = false
            setPadding(18.dp(), 10.dp(), 18.dp(), 10.dp())
        }
        screen.addView(statusText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        ).apply {
            leftMargin = 42.dp()
            rightMargin = 42.dp()
            bottomMargin = 132.dp()
        })

        approvalText = TextView(this).apply {
            text = ""
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(COLOR_MUTED)
            gravity = Gravity.CENTER
            includeFontPadding = false
            visibility = View.GONE
            setPadding(18.dp(), 8.dp(), 18.dp(), 8.dp())
        }
        screen.addView(approvalText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        ).apply {
            leftMargin = 42.dp()
            rightMargin = 42.dp()
            bottomMargin = 108.dp()
        })

        settingsPanel = ScrollView(this).apply {
            visibility = View.GONE
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            ).apply {
                leftMargin = 16.dp()
                rightMargin = 16.dp()
                bottomMargin = 92.dp()
            }
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                background = rounded(COLOR_SURFACE, 18.dp(), COLOR_STROKE, 1.dp())
                setPadding(16.dp(), 16.dp(), 16.dp(), 16.dp())

                addView(fieldLabel("WebSocket URL"))

                urlInput = EditText(this@MainActivity).apply {
                    setSingleLine(true)
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                    setText(prefs.getString(Constants.PREF_SERVER_URL, Constants.DEFAULT_SERVER_URL))
                    styleInput()
                }
                addView(urlInput)

                val saveButton = Button(this@MainActivity).apply {
                    text = "Save URL"
                    styleButton(primary = false)
                    setOnClickListener {
                        val url = urlInput.text.toString().trim()
                        val existingToken = prefs.getString(Constants.PREF_AUTH_TOKEN, "").orEmpty()
                        val tokenFromUrl = PairingPayloadParser.parse(url).getOrNull()?.token.orEmpty()
                        prefs.edit()
                            .putString(Constants.PREF_SERVER_URL, url)
                            .putString(Constants.PREF_AUTH_TOKEN, tokenFromUrl.ifBlank { existingToken })
                            .apply()
                        updatePairingText()
                        Toast.makeText(this@MainActivity, "Saved", Toast.LENGTH_SHORT).show()
                    }
                }
                addView(saveButton, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    48.dp()
                ).apply {
                    topMargin = 12.dp()
                    bottomMargin = 18.dp()
                })

                addView(fieldLabel("QR text or authenticated URL"))

                pairingInput = EditText(this@MainActivity).apply {
                    setSingleLine(true)
                    hint = "voicestream://pair?... or voicestream://update?..."
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                    styleInput()
                }
                addView(pairingInput)

                val applyPairingButton = Button(this@MainActivity).apply {
                    text = "Apply QR Text"
                    styleButton(primary = false)
                    setOnClickListener {
                        applyPairingPayload(pairingInput.text.toString())
                    }
                }
                addView(applyPairingButton, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    48.dp()
                ).apply {
                    topMargin = 12.dp()
                })

                pairingText = TextView(this@MainActivity).apply {
                    textSize = 13f
                    setTextColor(COLOR_MUTED)
                    gravity = Gravity.CENTER
                    setPadding(0, 12.dp(), 0, 0)
                }
                addView(pairingText)

                addView(TextView(this@MainActivity).apply {
                    text = "Version: ${currentVersionLabel()}"
                    textSize = 11f
                    setTextColor(COLOR_MUTED)
                    setPadding(0, 12.dp(), 0, 0)
                })

                addView(TextView(this@MainActivity).apply {
                    text = "Diagnostics: ${DroneLog.path(this@MainActivity)}"
                    textSize = 11f
                    setTextColor(COLOR_MUTED)
                    setPadding(0, 12.dp(), 0, 0)
                })
            })
        }
        screen.addView(settingsPanel)

        settingsButton = Button(this).apply {
            text = "Settings"
            styleFloatingButton()
            setOnClickListener { toggleSettings() }
        }
        screen.addView(settingsButton, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            54.dp(),
            Gravity.BOTTOM or Gravity.START
        ).apply {
            leftMargin = 18.dp()
            bottomMargin = 22.dp()
        })

        microphoneText = TextView(this).apply {
            text = "Mic: phone"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(COLOR_MUTED)
            gravity = Gravity.CENTER
            includeFontPadding = false
            setPadding(12.dp(), 8.dp(), 12.dp(), 8.dp())
            background = rounded(COLOR_FLOATING, 16.dp(), COLOR_STROKE, 1.dp())
        }
        screen.addView(microphoneText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.END
        ).apply {
            rightMargin = 18.dp()
            bottomMargin = 92.dp()
        })

        qrButton = ImageButton(this).apply {
            contentDescription = "Scan Drone QR"
            setImageResource(android.R.drawable.ic_menu_camera)
            scaleType = android.widget.ImageView.ScaleType.CENTER
            styleIconButton()
            setOnClickListener { startQrScan() }
        }
        screen.addView(qrButton, FrameLayout.LayoutParams(
            58.dp(),
            58.dp(),
            Gravity.BOTTOM or Gravity.END
        ).apply {
            rightMargin = 18.dp()
            bottomMargin = 20.dp()
        })

        positionBottomControls(0)
        screen.setOnApplyWindowInsetsListener { _, insets ->
            positionBottomControls(insets.bottomSystemInset())
            insets
        }

        updatePairingText()
        updateSessionUi(SessionMode.OFF, "Off")
        updateApprovalUi(SessionMode.OFF, "")
        updateMicrophoneUi("Mic: phone")

        setContentView(screen)
        requestNeededPermissions()
    }

    private fun section(title: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16.dp(), 16.dp(), 16.dp(), 16.dp())
            background = rounded(COLOR_SURFACE, 16.dp(), COLOR_STROKE, 1.dp())
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = 18.dp()
            }
            addView(TextView(this@MainActivity).apply {
                text = title
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(COLOR_MUTED)
                setPadding(0, 0, 0, 12.dp())
            })
        }
    }

    private fun fieldLabel(textValue: String): TextView {
        return TextView(this).apply {
            text = textValue
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(COLOR_MUTED)
            setPadding(0, 0, 0, 8.dp())
        }
    }

    private fun buttonRow(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = 12.dp()
            }
        }
    }

    private fun weightedButtonParams(leftMargin: Int = 0): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(0, 48.dp(), 1f).apply {
            this.leftMargin = leftMargin
        }
    }

    private fun EditText.styleInput() {
        setTextColor(COLOR_TEXT)
        setHintTextColor(COLOR_MUTED)
        textSize = 14f
        setPadding(14.dp(), 6.dp(), 14.dp(), 6.dp())
        background = rounded(COLOR_INPUT, 12.dp(), COLOR_STROKE, 1.dp())
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            50.dp()
        )
    }

    private fun Button.styleButton(primary: Boolean) {
        isAllCaps = false
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(if (primary) Color.rgb(3, 12, 18) else COLOR_TEXT)
        background = rounded(
            if (primary) COLOR_ACCENT else COLOR_BUTTON,
            12.dp(),
            if (primary) COLOR_ACCENT else COLOR_STROKE,
            1.dp()
        )
        minHeight = 0
        minimumHeight = 0
        setPadding(14.dp(), 0, 14.dp(), 0)
    }

    private fun Button.styleActionButton(mode: SessionMode) {
        isAllCaps = false
        textSize = 22f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(COLOR_TEXT)
        text = when (mode) {
            SessionMode.OFF,
            SessionMode.ERROR -> "Start"
            SessionMode.SLEEPING -> "Sleep"
            SessionMode.LOADING,
            SessionMode.AWAKE,
            SessionMode.RECORDING -> "Awake"
        }
        background = actionBackground(mode)
        minHeight = 0
        minimumHeight = 0
        elevation = 14.dp().toFloat()
        translationZ = 3.dp().toFloat()
    }

    private fun Button.styleOffButton() {
        isAllCaps = false
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(COLOR_MUTED)
        background = rounded(Color.rgb(18, 26, 36), 14.dp(), COLOR_STROKE, 1.dp())
        minHeight = 0
        minimumHeight = 0
        elevation = 0f
        translationZ = 0f
    }

    private fun Button.styleFloatingButton() {
        isAllCaps = false
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(COLOR_TEXT)
        setPadding(18.dp(), 0, 18.dp(), 0)
        background = rounded(COLOR_FLOATING, 28.dp(), COLOR_STROKE, 1.dp())
        minHeight = 0
        minimumHeight = 0
        elevation = 8.dp().toFloat()
    }

    private fun ImageButton.styleIconButton() {
        setColorFilter(COLOR_TEXT)
        background = rounded(COLOR_FLOATING, 29.dp(), COLOR_STROKE, 1.dp())
        elevation = 8.dp().toFloat()
        setPadding(14.dp(), 14.dp(), 14.dp(), 14.dp())
    }

    private fun actionBackground(mode: SessionMode): GradientDrawable {
        val colors = when (mode) {
            SessionMode.OFF,
            SessionMode.ERROR -> intArrayOf(Color.rgb(37, 51, 67), Color.rgb(14, 22, 34))
            SessionMode.SLEEPING -> intArrayOf(Color.rgb(42, 52, 68), Color.rgb(18, 24, 34))
            SessionMode.LOADING -> intArrayOf(Color.rgb(64, 48, 24), Color.rgb(34, 28, 18))
            SessionMode.AWAKE,
            SessionMode.RECORDING -> intArrayOf(Color.rgb(18, 88, 82), Color.rgb(10, 52, 58))
        }
        val stroke = when (mode) {
            SessionMode.OFF,
            SessionMode.ERROR -> COLOR_STROKE
            SessionMode.SLEEPING -> Color.rgb(100, 116, 139)
            SessionMode.LOADING -> Color.rgb(251, 191, 36)
            SessionMode.AWAKE,
            SessionMode.RECORDING -> COLOR_ACCENT
        }
        return GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, colors).apply {
            shape = GradientDrawable.OVAL
            setStroke(2.dp(), stroke)
        }
    }

    private fun rounded(
        fillColor: Int,
        radius: Int,
        strokeColor: Int? = null,
        strokeWidth: Int = 0
    ): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radius.toFloat()
            setColor(fillColor)
            if (strokeColor != null && strokeWidth > 0) {
                setStroke(strokeWidth, strokeColor)
            }
        }
    }

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).roundToInt()

    private fun toggleSettings() {
        val showing = settingsPanel.visibility == View.VISIBLE
        settingsPanel.visibility = if (showing) View.GONE else View.VISIBLE
        settingsButton.text = if (showing) "Settings" else "Close"
    }

    override fun onStart() {
        super.onStart()
        DroneLog.i("Activity", "MainActivity started")
        val filter = IntentFilter(Constants.ACTION_STATUS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(statusReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(statusReceiver, filter)
        }
        queryServiceStatus()
    }

    override fun onStop() {
        super.onStop()
        DroneLog.i("Activity", "MainActivity stopped")
        runCatching { unregisterReceiver(statusReceiver) }
            .onFailure { error -> DroneLog.w("Activity", "Status receiver was not registered", error) }
    }

    private fun startAwake() {
        startWithUrl(Constants.ACTION_START_AWAKE)
    }

    private fun toggleAwakeSleep() {
        if (sessionMode == SessionMode.OFF || sessionMode == SessionMode.ERROR) {
            cuePlayer.play(LocalCue.START_BUTTON)
            updateSessionUi(SessionMode.LOADING, "Waking local detector")
            startAwake()
        } else {
            sendServiceAction(Constants.ACTION_TOGGLE_AWAKE_SLEEP)
        }
    }

    private fun turnOff() {
        cuePlayer.play(LocalCue.STOP_BUTTON)
        stopAwake()
        updateSessionUi(SessionMode.OFF, "Off")
    }

    private fun startWithUrl(actionName: String) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestNeededPermissions()
            Toast.makeText(this, "Microphone permission is required", Toast.LENGTH_LONG).show()
            return
        }

        val url = urlInput.text.toString().trim()
        if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
            Toast.makeText(this, "URL must start with ws:// or wss://", Toast.LENGTH_LONG).show()
            return
        }

        getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(Constants.PREF_SERVER_URL, url)
            .apply()

        val intent = Intent(this, VoiceSessionService::class.java).apply {
            action = actionName
            putExtra(Constants.EXTRA_SERVER_URL, url)
            putExtra(
                Constants.EXTRA_AUTH_TOKEN,
                getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
                    .getString(Constants.PREF_AUTH_TOKEN, "")
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopAwake() {
        sendServiceAction(Constants.ACTION_STOP_AWAKE)
    }

    private fun sendServiceAction(actionName: String) {
        startService(Intent(this, VoiceSessionService::class.java).apply {
            action = actionName
        })
    }

    private fun queryServiceStatus() {
        startService(Intent(this, VoiceSessionService::class.java).apply {
            action = Constants.ACTION_QUERY_STATUS
        })
    }

    private fun requestNeededPermissions() {
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        val missing = permissions.filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            DroneLog.i("Permissions", "Requesting ${missing.joinToString()}")
            requestPermissions(missing.toTypedArray(), 100)
        }
    }

    private fun startQrScan() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            return
        }
        launchQrScanner()
    }

    private fun launchQrScanner() {
        val options = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Scan Drone QR")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
        try {
            qrScanLauncher.launch(options)
        } catch (error: Throwable) {
            showPairingMessage("Scanner unavailable: ${error.message}. Paste the QR text instead.")
        }
    }

    private fun applyPairingPayload(payload: String) {
        if (PairingPayloadParser.isUpdatePayload(payload)) {
            val config = PairingPayloadParser.parseUpdate(payload).getOrElse { error ->
                showPairingMessage("Update check failed: ${error.message}")
                return
            }
            handleUpdatePayload(config)
            return
        }

        val config = PairingPayloadParser.parse(payload).getOrElse { error ->
            showPairingMessage("Pairing failed: ${error.message}")
            return
        }

        val minVersionCode = config.minVersionCode
        if (minVersionCode != null && currentVersionCode() < minVersionCode) {
            showUpdateRequired(config)
            return
        }

        getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(Constants.PREF_SERVER_URL, config.audioUrl)
            .putString(Constants.PREF_AUTH_TOKEN, config.token)
            .apply()
        urlInput.setText(config.audioUrl)
        pairingInput.setText("")
        updatePairingText()
        showPairingMessage("Paired with server")
    }

    private fun handleUpdatePayload(config: UpdateConfig) {
        val currentVersionCode = currentVersionCode()
        if (currentVersionCode >= config.versionCode) {
            showPairingMessage("Drone app is up to date")
            return
        }

        showUpdateAvailable(config)
    }

    private fun showUpdateAvailable(config: UpdateConfig) {
        val message = "A newer Drone app build is available. Current versionCode is ${currentVersionCode()}; latest is ${config.versionCode}."
        showPairingMessage("Update available")
        AlertDialog.Builder(this)
            .setTitle("Update Drone")
            .setMessage(message)
            .setPositiveButton("Download APK") { _, _ ->
                openUpdateUrl(config.apkUrl)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showUpdateRequired(config: PairingConfig) {
        val message = "This server requires a newer Drone app build before pairing. Download and install the latest APK, then scan again."
        showPairingMessage("Update required")
        AlertDialog.Builder(this)
            .setTitle("Update Drone")
            .setMessage(message)
            .setPositiveButton("Download APK") { _, _ ->
                openUpdateUrl(config.apkUrl)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openUpdateUrl(apkUrl: String?) {
        if (apkUrl.isNullOrBlank()) {
            Toast.makeText(this, "No APK download URL was included in the QR code", Toast.LENGTH_LONG).show()
            return
        }
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(apkUrl)))
        }.onFailure { error ->
            Toast.makeText(this, "Could not open APK URL: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun currentVersionCode(): Long {
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }
    }

    private fun currentVersionLabel(): String {
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val versionName = packageInfo.versionName?.takeIf { it.isNotBlank() } ?: "unknown"
        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }
        return "$versionName (versionCode $versionCode)"
    }

    private fun showPairingMessage(message: String) {
        if (::pairingText.isInitialized) {
            pairingText.text = message
        }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun updatePairingText() {
        if (!::pairingText.isInitialized) return
        val prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        val token = prefs.getString(Constants.PREF_AUTH_TOKEN, "").orEmpty()
        pairingText.text = if (token.isBlank()) {
            "Pairing: not paired"
        } else {
            "Pairing: token saved"
        }
    }

    private fun updateMicrophoneUi(label: String) {
        if (::microphoneText.isInitialized) {
            microphoneText.text = label
        }
    }

    private fun updateSessionUi(mode: SessionMode, status: String) {
        sessionMode = mode
        if (::statusText.isInitialized) {
            statusText.visibility = if (mode == SessionMode.OFF) View.GONE else View.VISIBLE
            statusText.text = if (mode == SessionMode.OFF) "" else status
            statusText.setTextColor(statusStrokeColor(mode))
            statusText.background = null
        }
        if (!::awakeButton.isInitialized) {
            return
        }

        awakeButton.text = when (mode) {
            SessionMode.OFF,
            SessionMode.ERROR -> "Start"
            SessionMode.SLEEPING -> "Sleep"
            SessionMode.LOADING,
            SessionMode.AWAKE,
            SessionMode.RECORDING -> "Awake"
        }
        awakeButton.styleActionButton(mode)
        if (::offButton.isInitialized) {
            offButton.visibility = if (mode == SessionMode.OFF || mode == SessionMode.ERROR) View.GONE else View.VISIBLE
        }
    }

    private fun updateApprovalUi(mode: SessionMode, approvalStatus: String) {
        if (!::approvalText.isInitialized) return
        val show = mode != SessionMode.OFF && approvalStatus.isNotBlank()
        approvalText.visibility = if (show) View.VISIBLE else View.GONE
        approvalText.text = if (show) approvalStatus else ""
        approvalText.setTextColor(COLOR_MUTED)
    }

    private fun positionBottomControls(bottomInset: Int) {
        val safeBottom = bottomInset + 26.dp()
        if (::settingsButton.isInitialized) {
            settingsButton.updateFrameMargins(bottom = safeBottom)
        }
        if (::qrButton.isInitialized) {
            qrButton.updateFrameMargins(bottom = safeBottom)
        }
        if (::microphoneText.isInitialized) {
            microphoneText.updateFrameMargins(bottom = safeBottom + 70.dp())
        }
        if (::statusText.isInitialized) {
            statusText.updateFrameMargins(bottom = safeBottom + 126.dp())
        }
        if (::approvalText.isInitialized) {
            approvalText.updateFrameMargins(bottom = safeBottom + 102.dp())
        }
        if (::settingsPanel.isInitialized) {
            settingsPanel.updateFrameMargins(bottom = safeBottom + 74.dp())
        }
        if (::root.isInitialized) {
            root.setPadding(24.dp(), 58.dp(), 24.dp(), safeBottom + 182.dp())
        }
    }

    private fun View.updateFrameMargins(bottom: Int) {
        val params = layoutParams as? FrameLayout.LayoutParams ?: return
        params.bottomMargin = bottom
        layoutParams = params
    }

    private fun WindowInsets.bottomSystemInset(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getInsets(WindowInsets.Type.systemBars()).bottom
        } else {
            @Suppress("DEPRECATION")
            systemWindowInsetBottom
        }
    }

    private fun statusFillColor(mode: SessionMode): Int {
        return when (mode) {
            SessionMode.OFF -> Color.rgb(30, 41, 59)
            SessionMode.SLEEPING -> Color.rgb(42, 52, 68)
            SessionMode.LOADING -> Color.rgb(64, 48, 24)
            SessionMode.AWAKE -> Color.rgb(13, 54, 48)
            SessionMode.RECORDING -> Color.rgb(20, 54, 92)
            SessionMode.ERROR -> Color.rgb(80, 29, 34)
        }
    }

    private fun statusStrokeColor(mode: SessionMode): Int {
        return when (mode) {
            SessionMode.OFF -> Color.rgb(51, 65, 85)
            SessionMode.SLEEPING -> Color.rgb(148, 163, 184)
            SessionMode.LOADING -> Color.rgb(180, 120, 36)
            SessionMode.AWAKE -> Color.rgb(45, 212, 191)
            SessionMode.RECORDING -> Color.rgb(96, 165, 250)
            SessionMode.ERROR -> Color.rgb(248, 113, 113)
        }
    }

    private enum class SessionMode {
        OFF,
        SLEEPING,
        LOADING,
        AWAKE,
        RECORDING,
        ERROR;

        companion object {
            fun fromValue(value: String?, status: String): SessionMode {
                return when (value) {
                    Constants.MODE_OFF -> OFF
                    Constants.MODE_SLEEPING -> SLEEPING
                    Constants.MODE_LOADING -> LOADING
                    Constants.MODE_AWAKE -> AWAKE
                    Constants.MODE_RECORDING -> RECORDING
                    Constants.MODE_ERROR -> ERROR
                    else -> fromStatus(status)
                }
            }

            private fun fromStatus(status: String): SessionMode {
                return when {
                    status == "Off" -> OFF
                    status.startsWith("Error:") -> ERROR
                    status.startsWith("Awake: waiting") -> AWAKE
                    status.startsWith("Awake: status") -> AWAKE
                    status.startsWith("Awake") -> RECORDING
                    status.startsWith("Sleep") -> SLEEPING
                    status.startsWith("Asleep") -> AWAKE
                    status.startsWith("Waking") -> LOADING
                    else -> AWAKE
                }
            }
        }
    }

    companion object {
        private val COLOR_BACKGROUND = Color.rgb(7, 10, 15)
        private val COLOR_SURFACE = Color.rgb(15, 23, 32)
        private val COLOR_INPUT = Color.rgb(9, 14, 22)
        private val COLOR_BUTTON = Color.rgb(31, 42, 55)
        private val COLOR_FLOATING = Color.rgb(20, 30, 42)
        private val COLOR_STROKE = Color.rgb(38, 52, 68)
        private val COLOR_TEXT = Color.rgb(229, 237, 244)
        private val COLOR_MUTED = Color.rgb(139, 152, 168)
        private val COLOR_ACCENT = Color.rgb(45, 212, 191)
    }
}
