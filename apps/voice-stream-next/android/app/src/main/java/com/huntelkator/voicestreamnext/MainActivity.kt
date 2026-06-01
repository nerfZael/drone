package com.huntelkator.voicestreamnext

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
import android.media.audiofx.AcousticEchoCanceler
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.net.URI
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.concurrent.thread
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    private lateinit var api: VoiceStreamApi
    private lateinit var browserAuth: BrowserAuthCoordinator
    private lateinit var serverInput: EditText
    private lateinit var deviceNameInput: EditText
    private lateinit var echoCancellationCheckbox: CheckBox
    private lateinit var statusText: TextView
    private lateinit var approvalText: TextView
    private lateinit var microphoneText: TextView
    private lateinit var pairingMessageText: TextView
    private lateinit var primaryActionButton: Button
    private lateinit var offButton: Button
    private lateinit var root: LinearLayout
    private lateinit var signedOutPanel: View
    private lateinit var voicePanel: LinearLayout
    private lateinit var settingsPanel: View
    private lateinit var settingsButton: Button
    private lateinit var signInButton: Button
    private lateinit var signOutButton: Button
    private lateinit var updateBanner: LinearLayout
    private lateinit var updateBannerTitle: TextView
    private lateinit var updateBannerSubtitle: TextView
    private lateinit var updateBannerButton: Button
    private lateinit var speechHistoryPanel: LinearLayout
    private lateinit var speechHistoryTitle: TextView
    private lateinit var speechHistorySubtitle: TextView
    private lateinit var speechHistoryPrevButton: Button
    private lateinit var speechHistoryPlayButton: Button
    private lateinit var speechHistoryStopButton: Button
    private lateinit var speechHistoryNextButton: Button
    private lateinit var assistantActivityText: TextView
    private lateinit var filesButton: Button
    private lateinit var filesBadgeText: TextView
    private lateinit var filesPanel: View
    private lateinit var filesTitleText: TextView
    private lateinit var filesSubtitleText: TextView
    private lateinit var filePathText: TextView
    private lateinit var fileMetaText: TextView
    private lateinit var fileContentText: TextView
    private lateinit var filePrevButton: Button
    private lateinit var fileNextButton: Button
    private lateinit var fileExplorerButton: Button
    private lateinit var fileRefreshButton: Button

    private val wakeController = WakeToggleController()
    @Volatile private var updateCheckRunning = false
    private val cuePlayer = LocalCuePlayer()
    private var pendingStartAwake = false
    private var pendingStartTarget = Constants.STREAM_TARGET_ASSISTANT
    private var sessionMode = SessionMode.OFF
    private var currentUpdateConfig: UpdateConfig? = null
    private var lastUpdateCheckAtMs = 0L
    private var speechHistoryEntries: List<SpeechHistoryEntry> = emptyList()
    private var speechHistoryIndex = -1
    private var assistantThreadSummary: AssistantThreadSummary? = null
    private var assistantArtifacts: List<AssistantArtifact> = emptyList()
    private var selectedArtifactIndex = -1
    @Volatile private var assistantFilesLoading = false

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val status = intent?.getStringExtra(Constants.EXTRA_STATUS).orEmpty()
            val mode = intent?.getStringExtra(Constants.EXTRA_MODE).orEmpty()
            val microphone = intent?.getStringExtra(Constants.EXTRA_MICROPHONE).orEmpty()
            val approvalStatus = intent?.getStringExtra(Constants.EXTRA_APPROVAL_STATUS).orEmpty()
            if (status.isNotBlank()) {
                updateSessionUi(SessionMode.fromBroadcast(mode, status), status)
            }
            if (mode.isNotBlank()) {
                wakeController.applyServiceMode(mode)
            }
            if (microphone.isNotBlank()) {
                updateMicrophoneUi(microphone)
            }
            updateApprovalUi(approvalStatus)
        }
    }

    private val speechHistoryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshSpeechHistory(selectLatest = true)
        }
    }

    private val voicePermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        if (!grants.values.all { it }) {
            showStatus("Voice permissions denied.")
            return@registerForActivityResult
        }
        if (pendingStartAwake) {
            startAwakeService()
        } else {
            startVoiceSession(pendingStartTarget)
        }
    }

    private val qrScanLauncher = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents
        if (text.isNullOrBlank()) {
            showPairingMessage("QR scan cancelled.")
        } else {
            applyPairingPayload(text)
        }
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            launchQrScanner()
        } else {
            showPairingMessage("Camera permission denied. Paste the QR payload instead.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ClientLog.install(applicationContext)
        ClientLog.i("Activity", "MainActivity created")
        api = VoiceStreamApi(applicationContext)
        browserAuth = BrowserAuthCoordinator(api, browserAuthCallbacks())
        DiagnosticsUploader.upload(applicationContext, api, "activity-start", force = true)
        runCatching { configureSystemBars() }.onFailure { error ->
            ClientLog.w("Activity", "System bar configuration failed", error)
        }
        buildUi()
        loadConfigIntoForm()
        updateSessionUi(SessionMode.OFF, "Ready")
        refreshSpeechHistory(selectLatest = true)
        renderAuthState()
        if (api.pairedDeviceId().isNotBlank()) {
            refreshDashboard()
            refreshAssistantThreadSummary()
        }
    }

    override fun onStart() {
        super.onStart()
        ClientLog.i("Activity", "MainActivity started")
        ContextCompat.registerReceiver(
            this,
            statusReceiver,
            IntentFilter(Constants.ACTION_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        ContextCompat.registerReceiver(
            this,
            speechHistoryReceiver,
            IntentFilter(Constants.ACTION_SPEECH_HISTORY_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onResume() {
        super.onResume()
        refreshSpeechHistory(selectLatest = false)
        refreshAssistantThreadSummary()
        resyncServiceStatus()
    }

    override fun onStop() {
        runCatching { unregisterReceiver(statusReceiver) }
        runCatching { unregisterReceiver(speechHistoryReceiver) }
        super.onStop()
    }

    override fun onDestroy() {
        if (::browserAuth.isInitialized) browserAuth.stop()
        super.onDestroy()
    }

    private fun buildUi() {
        val screen = FrameLayout(this).apply {
            setBackgroundColor(COLOR_BACKGROUND)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24.dp(), 48.dp(), 24.dp(), 132.dp())
        }
        screen.addView(root, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))

        root.addView(buildHeader(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 54.dp()))
        updateBanner = buildUpdateBanner()
        root.addView(updateBanner, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = 6.dp()
        })

        signedOutPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val card = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                background = rounded(COLOR_SURFACE, 12.dp(), COLOR_STROKE)
                setPadding(18.dp(), 18.dp(), 18.dp(), 18.dp())
            }
            addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            card.addView(label("Sign in to connect this phone", 20f, COLOR_TEXT, true).apply {
                gravity = Gravity.CENTER
            })
            card.addView(label("Use the web dashboard sign-in flow, including social login, then return here.", 13f, COLOR_MUTED, false).apply {
                gravity = Gravity.CENTER
                setPadding(0, 8.dp(), 0, 16.dp())
            })
            signInButton = button("Sign in") { signInWithBrowser() }
            card.addView(signInButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 52.dp()))
            card.addView(row(
                button("Scan QR") { startQrScan() },
                button("Open web") { openWebDashboard() },
            ))
            pairingMessageText = label("", 13f, COLOR_MUTED, false).apply {
                gravity = Gravity.CENTER
                setPadding(0, 14.dp(), 0, 0)
            }
            card.addView(pairingMessageText)
        }
        root.addView(signedOutPanel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply {
            topMargin = 20.dp()
        })

        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        voicePanel = hero
        primaryActionButton = Button(this).apply {
            setOnClickListener { togglePrimaryAction() }
            stylePrimaryButton(SessionMode.OFF)
        }
        hero.addView(primaryActionButton, LinearLayout.LayoutParams(166.dp(), 166.dp()))
        statusText = label("Ready", 15f, COLOR_MUTED, true).apply {
            gravity = Gravity.CENTER
            setPadding(18.dp(), 16.dp(), 18.dp(), 0)
        }
        hero.addView(statusText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        approvalText = label("", 14f, COLOR_MUTED, true).apply {
            gravity = Gravity.CENTER
            visibility = View.GONE
            setPadding(18.dp(), 8.dp(), 18.dp(), 0)
        }
        hero.addView(approvalText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        assistantActivityText = label("", 13f, COLOR_YELLOW, true).apply {
            gravity = Gravity.CENTER
            visibility = View.GONE
            setPadding(14.dp(), 8.dp(), 14.dp(), 8.dp())
            background = rounded(COLOR_UPDATE_SURFACE, 14.dp(), COLOR_YELLOW)
        }
        hero.addView(assistantActivityText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = 10.dp()
        })
        offButton = Button(this).apply {
            text = "Turn off"
            visibility = View.GONE
            styleSecondaryButton()
            setOnClickListener { turnOff() }
        }
        hero.addView(offButton, LinearLayout.LayoutParams(148.dp(), 48.dp()).apply { topMargin = 18.dp() })
        speechHistoryPanel = buildSpeechHistoryPanel()
        hero.addView(speechHistoryPanel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = 22.dp()
        })
        root.addView(hero)

        microphoneText = label("Mic: phone", 12f, COLOR_MUTED, true).apply {
            gravity = Gravity.CENTER
            setPadding(14.dp(), 0, 14.dp(), 0)
            background = rounded(COLOR_FLOATING, 12.dp(), COLOR_STROKE)
        }
        screen.addView(microphoneText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            50.dp(),
            Gravity.BOTTOM or Gravity.END,
        ).apply {
            rightMargin = 18.dp()
            bottomMargin = 22.dp()
        })

        settingsPanel = ScrollView(this).apply {
            visibility = View.GONE
            setBackgroundColor(Color.TRANSPARENT)
            addView(buildSettingsContent())
        }
        screen.addView(settingsPanel, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM,
        ).apply {
            leftMargin = 16.dp()
            rightMargin = 16.dp()
            bottomMargin = 92.dp()
        })

        settingsButton = Button(this).apply {
            text = "Settings"
            styleFloatingButton()
            setOnClickListener { toggleSettings() }
        }
        screen.addView(settingsButton, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            50.dp(),
            Gravity.BOTTOM or Gravity.START,
        ).apply {
            leftMargin = 18.dp()
            bottomMargin = 22.dp()
        })

        filesPanel = buildFilesPanel().apply {
            visibility = View.GONE
        }
        screen.addView(filesPanel, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))

        screen.setOnApplyWindowInsetsListener { _, insets ->
            positionSystemBars(insets.topSystemInset(), insets.bottomSystemInset())
            insets
        }
        setContentView(screen)
        screen.requestApplyInsets()
    }

    private fun buildHeader(): LinearLayout {
        val title = label("Drone", 34f, COLOR_TEXT, true).apply {
            gravity = Gravity.CENTER
            setPadding(0, 2.dp(), 0, 0)
        }
        val filesButtonFrame = FrameLayout(this).apply {
            filesButton = Button(this@MainActivity).apply {
                text = "Files"
                styleFloatingButton()
                setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_save, 0, 0, 0)
                compoundDrawablePadding = 6.dp()
                setOnClickListener { openFilesView() }
            }
            addView(filesButton, FrameLayout.LayoutParams(104.dp(), 44.dp(), Gravity.CENTER))
            filesBadgeText = label("", 10f, COLOR_BUTTON_TEXT, true).apply {
                gravity = Gravity.CENTER
                visibility = View.GONE
                background = rounded(COLOR_GREEN, 9.dp(), COLOR_GREEN)
            }
            addView(filesBadgeText, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, 18.dp(), Gravity.TOP or Gravity.END).apply {
                topMargin = 1.dp()
                rightMargin = 1.dp()
            })
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(View(this@MainActivity), LinearLayout.LayoutParams(104.dp(), 1))
            addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
            addView(filesButtonFrame, LinearLayout.LayoutParams(104.dp(), ViewGroup.LayoutParams.MATCH_PARENT))
        }
    }

    private fun buildFilesPanel(): View {
        val panelRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(COLOR_BACKGROUND)
            setPadding(18.dp(), 48.dp(), 18.dp(), 26.dp())
        }

        val closeButton = button("Back") { closeFilesView() }
        fileExplorerButton = button("Explorer") { showFileExplorer() }
        fileRefreshButton = button("Refresh") { refreshAssistantFiles(selectFirst = false) }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(closeButton, LinearLayout.LayoutParams(82.dp(), 44.dp()))
            val titleColumn = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                filesTitleText = label("Files", 22f, COLOR_TEXT, true)
                filesSubtitleText = label("Current voice thread", 12f, COLOR_MUTED, false)
                addView(filesTitleText)
                addView(filesSubtitleText)
            }
            addView(titleColumn, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                leftMargin = 10.dp()
                rightMargin = 10.dp()
            })
            addView(fileExplorerButton, LinearLayout.LayoutParams(104.dp(), 44.dp()).apply { rightMargin = 8.dp() })
            addView(fileRefreshButton, LinearLayout.LayoutParams(94.dp(), 44.dp()))
        }
        panelRoot.addView(header)

        val fileCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(COLOR_SURFACE, 10.dp(), COLOR_STROKE)
            setPadding(14.dp(), 14.dp(), 14.dp(), 14.dp())
            filePathText = label("No file selected", 16f, COLOR_TEXT, true)
            fileMetaText = label("", 11f, COLOR_MUTED, false).apply {
                setPadding(0, 5.dp(), 0, 10.dp())
            }
            addView(filePathText)
            addView(fileMetaText)
        }
        panelRoot.addView(fileCard, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = 16.dp()
        })

        val contentScroll = ScrollView(this).apply {
            background = rounded(COLOR_INPUT, 8.dp(), COLOR_STROKE)
            setPadding(12.dp(), 12.dp(), 12.dp(), 12.dp())
            fileContentText = label("", 13f, COLOR_TEXT, false).apply {
                typeface = Typeface.MONOSPACE
                setLineSpacing(2.dp().toFloat(), 1f)
            }
            addView(fileContentText)
        }
        val gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(event: MotionEvent): Boolean = true

            override fun onFling(
                event1: MotionEvent?,
                event2: MotionEvent,
                velocityX: Float,
                velocityY: Float
            ): Boolean {
                val start = event1 ?: return false
                val deltaX = event2.x - start.x
                if (kotlin.math.abs(deltaX) < 70.dp() || kotlin.math.abs(velocityX) < kotlin.math.abs(velocityY)) return false
                moveArtifact(if (deltaX < 0) 1 else -1)
                return true
            }
        })
        contentScroll.setOnTouchListener { _, event ->
            gestureDetector.onTouchEvent(event)
            false
        }
        panelRoot.addView(contentScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply {
            topMargin = 12.dp()
        })

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            filePrevButton = button("Previous") { moveArtifact(-1) }
            fileNextButton = button("Next") { moveArtifact(1) }
            addView(filePrevButton, LinearLayout.LayoutParams(0, 48.dp(), 1f).apply { rightMargin = 8.dp() })
            addView(fileNextButton, LinearLayout.LayoutParams(0, 48.dp(), 1f))
        }
        panelRoot.addView(controls, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = 12.dp()
        })

        return panelRoot
    }

    private fun configureSystemBars() {
        window.statusBarColor = COLOR_SYSTEM_BAR
        window.navigationBarColor = COLOR_BACKGROUND
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.setSystemBarsAppearance(
                0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        } else {
            @Suppress("DEPRECATION")
            var flags = window.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags = flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
            }
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = flags
        }
    }

    private fun buildSettingsContent(): LinearLayout {
        serverInput = field("Server URL")
        deviceNameInput = field("Device name")
        echoCancellationCheckbox = CheckBox(this).apply {
            text = if (AcousticEchoCanceler.isAvailable()) "Acoustic echo canceler" else "Acoustic echo canceler unavailable"
            textSize = 14f
            setTextColor(COLOR_TEXT)
            isEnabled = AcousticEchoCanceler.isAvailable()
            setPadding(0, 6.dp(), 0, 2.dp())
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(COLOR_SURFACE, 12.dp(), COLOR_STROKE)
            setPadding(16.dp(), 16.dp(), 16.dp(), 16.dp())

            addView(card("Connection").apply {
                addView(serverInput)
                addView(deviceNameInput)
                addView(echoCancellationCheckbox)
                addView(row(
                    button("Save") { saveConfigFromForm() },
                    button("Open web") { openWebDashboard() }
                ))
                signOutButton = button("Sign out") { signOut() }
                addView(signOutButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 48.dp()).apply {
                    topMargin = 10.dp()
                })
            })

            addView(card("Pairing").apply {
                addView(row(
                    button("Scan QR") { startQrScan() },
                    button("Refresh") { refreshDashboard() }
                ))
                addView(button("Check update") { checkForAppUpdate(force = true, showNoUpdate = true) }, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    44.dp()
                ).apply {
                    topMargin = 8.dp()
                })
                addView(label("Scan a pairing or update QR from the web dashboard.", 12f, COLOR_MUTED, false).apply {
                    setPadding(0, 10.dp(), 0, 0)
                })
            })

            addView(label("Version: ${currentVersionLabel()}", 11f, COLOR_MUTED, false).apply {
                setPadding(0, 12.dp(), 0, 0)
            })
            addView(label("Diagnostics: ${ClientLog.path(this@MainActivity)}", 11f, COLOR_MUTED, false).apply {
                setPadding(0, 8.dp(), 0, 0)
            })
        }
    }

    private fun toggleSettings() {
        val showing = settingsPanel.visibility == View.VISIBLE
        settingsPanel.visibility = if (showing) View.GONE else View.VISIBLE
        settingsButton.text = if (showing) "Settings" else "Close"
    }

    private fun togglePrimaryAction() {
        when (sessionMode) {
            SessionMode.OFF, SessionMode.ERROR -> ensureMicThenStartAwake()
            SessionMode.SLEEPING -> ensureMicThenStartAwake()
            SessionMode.AWAKE -> enterSleep()
            SessionMode.RECORDING -> stopRecording()
            SessionMode.LOADING -> enterSleep()
        }
    }

    private fun updateSessionUi(mode: SessionMode, status: String) {
        sessionMode = mode
        statusText.text = status
        statusText.setTextColor(if (mode == SessionMode.ERROR) COLOR_ACCENT else COLOR_MUTED)
        statusText.visibility = View.VISIBLE
        renderAssistantActivity(status)
        primaryActionButton.stylePrimaryButton(mode)
        offButton.visibility = if (mode == SessionMode.OFF || mode == SessionMode.ERROR) View.GONE else View.VISIBLE
        if (mode == SessionMode.OFF) updateApprovalUi("")
        if (status.contains("assistant replied", ignoreCase = true) ||
            status.contains("artifact", ignoreCase = true) ||
            status.contains("transcript patched", ignoreCase = true)
        ) {
            refreshAssistantThreadSummary()
        }
    }

    private fun renderAssistantActivity(status: String) {
        if (!::assistantActivityText.isInitialized) return
        val lower = status.lowercase()
        val text = when {
            lower.contains("waiting for approval") -> "Waiting for approval"
            lower.contains("queued voice prompt") || lower.contains("queued") -> "Queued"
            lower.contains("assistant is thinking") -> ""
            lower.contains("thinking") -> "Assistant is thinking..."
            else -> ""
        }
        if (text.isBlank()) {
            assistantActivityText.visibility = View.GONE
            assistantActivityText.text = ""
        } else {
            assistantActivityText.visibility = View.VISIBLE
            assistantActivityText.text = text
        }
    }

    private fun refreshAssistantThreadSummary() {
        val connected = api.pairedDeviceId().isNotBlank() && api.pairedDeviceToken().isNotBlank()
        if (!connected || assistantFilesLoading) return
        thread(name = "VoiceStreamAssistantThreadSummary") {
            runCatching { api.assistantThreadSummary() }
                .onSuccess { summary ->
                    runOnUiThread {
                        assistantThreadSummary = summary
                        renderFilesBadge(summary.artifactsCount)
                        if (::filesPanel.isInitialized && filesPanel.visibility == View.VISIBLE) {
                            renderFilesView()
                        }
                    }
                }
        }
    }

    private fun refreshAssistantFiles(selectFirst: Boolean) {
        val connected = api.pairedDeviceId().isNotBlank() && api.pairedDeviceToken().isNotBlank()
        if (!connected || assistantFilesLoading) return
        assistantFilesLoading = true
        runOnUiThread {
            fileRefreshButton.isEnabled = false
            if (assistantArtifacts.isEmpty()) {
                fileContentText.text = "Loading files..."
            }
        }
        thread(name = "VoiceStreamAssistantFiles") {
            try {
                val result = api.assistantFiles()
                runOnUiThread {
                    assistantThreadSummary = result.thread
                    assistantArtifacts = result.artifacts
                    selectedArtifactIndex = when {
                        result.artifacts.isEmpty() -> -1
                        selectFirst || selectedArtifactIndex !in result.artifacts.indices -> 0
                        else -> selectedArtifactIndex
                    }
                    renderFilesBadge(result.thread.artifactsCount)
                    renderFilesView()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    filePathText.text = "Could not load files"
                    fileMetaText.text = ""
                    fileContentText.text = error.message ?: "Request failed"
                    filePrevButton.isEnabled = false
                    fileNextButton.isEnabled = false
                    fileExplorerButton.isEnabled = false
                }
            } finally {
                assistantFilesLoading = false
                runOnUiThread { fileRefreshButton.isEnabled = true }
            }
        }
    }

    private fun openFilesView() {
        if (!::filesPanel.isInitialized) return
        filesPanel.visibility = View.VISIBLE
        settingsPanel.visibility = View.GONE
        settingsButton.text = "Settings"
        renderFilesView()
        refreshAssistantFiles(selectFirst = assistantArtifacts.isEmpty())
    }

    private fun closeFilesView() {
        if (::filesPanel.isInitialized) filesPanel.visibility = View.GONE
    }

    private fun moveArtifact(delta: Int) {
        if (assistantArtifacts.isEmpty()) return
        selectedArtifactIndex = (selectedArtifactIndex + delta).coerceIn(0, assistantArtifacts.lastIndex)
        renderFilesView()
    }

    private fun showFileExplorer() {
        if (assistantArtifacts.isEmpty()) return
        val paths = assistantArtifacts.map { it.path.ifBlank { "Untitled" } }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Files")
            .setItems(paths) { _, which ->
                selectedArtifactIndex = which
                renderFilesView()
            }
            .show()
    }

    private fun renderFilesBadge(count: Int = assistantThreadSummary?.artifactsCount ?: assistantArtifacts.size) {
        if (!::filesBadgeText.isInitialized) return
        if (count <= 0) {
            filesBadgeText.visibility = View.GONE
            filesBadgeText.text = ""
            return
        }
        filesBadgeText.visibility = View.VISIBLE
        filesBadgeText.text = if (count > 9) "9+" else count.toString()
        filesBadgeText.setPadding(5.dp(), 0, 5.dp(), 0)
    }

    private fun renderFilesView() {
        if (!::filePathText.isInitialized) return
        val summary = assistantThreadSummary
        val count = summary?.artifactsCount ?: assistantArtifacts.size
        filesTitleText.text = "Files"
        filesSubtitleText.text = if (summary == null) {
            "Current voice thread"
        } else if (summary.id.isBlank()) {
            "No voice thread yet | 0 files"
        } else {
            "${summary.title.ifBlank { "Voice thread" }} | $count file${if (count == 1) "" else "s"}"
        }

        if (assistantFilesLoading && assistantArtifacts.isEmpty()) {
            filePathText.text = "Loading files"
            fileMetaText.text = ""
            fileContentText.text = "Loading files..."
            filePrevButton.isEnabled = false
            fileNextButton.isEnabled = false
            fileExplorerButton.isEnabled = false
            return
        }

        val artifact = assistantArtifacts.getOrNull(selectedArtifactIndex)
        if (artifact == null) {
            filePathText.text = "No files yet"
            fileMetaText.text = ""
            fileContentText.text = if (summary?.id.isNullOrBlank()) {
                "No voice thread yet. Start a voice request to create one."
            } else {
                "No files in this thread yet."
            }
            filePrevButton.isEnabled = false
            fileNextButton.isEnabled = false
            fileExplorerButton.isEnabled = false
            return
        }

        filePathText.text = artifact.path.ifBlank { "Untitled" }
        fileMetaText.text = "File ${selectedArtifactIndex + 1}/${assistantArtifacts.size} | ${formatArtifactSize(artifact.size)} | Updated ${artifact.updatedAt.take(16).replace('T', ' ')}"
        fileContentText.text = artifact.content.ifBlank { "This file is empty." }
        filePrevButton.isEnabled = selectedArtifactIndex > 0
        fileNextButton.isEnabled = selectedArtifactIndex < assistantArtifacts.lastIndex
        fileExplorerButton.isEnabled = true
    }

    private fun updateApprovalUi(approvalStatus: String) {
        if (approvalStatus.isBlank() || sessionMode == SessionMode.OFF) {
            approvalText.visibility = View.GONE
            approvalText.text = ""
        } else {
            approvalText.visibility = View.VISIBLE
            approvalText.text = approvalStatus
        }
    }

    private fun updateMicrophoneUi(microphone: String) {
        microphoneText.text = microphone
    }

    private fun refreshSpeechHistory(selectLatest: Boolean = false) {
        val currentId = speechHistoryEntries.getOrNull(speechHistoryIndex)?.id
        speechHistoryEntries = SpeechHistoryStore.list(this)
        speechHistoryIndex = when {
            speechHistoryEntries.isEmpty() -> -1
            selectLatest -> speechHistoryEntries.lastIndex
            currentId != null -> speechHistoryEntries.indexOfFirst { it.id == currentId }.takeIf { it >= 0 } ?: speechHistoryEntries.lastIndex
            speechHistoryIndex in speechHistoryEntries.indices -> speechHistoryIndex
            else -> speechHistoryEntries.lastIndex
        }
        renderSpeechHistory()
    }

    private fun renderSpeechHistory() {
        if (!::speechHistoryPanel.isInitialized) return
        val entry = speechHistoryEntries.getOrNull(speechHistoryIndex)
        val hasHistory = entry != null
        speechHistoryTitle.text = if (hasHistory) {
            "Speech ${speechHistoryIndex + 1}/${speechHistoryEntries.size}"
        } else {
            "Speech history"
        }
        speechHistorySubtitle.text = entry?.let { speechHistorySubtitle(it) } ?: "No saved speech yet."
        speechHistoryPrevButton.isEnabled = speechHistoryIndex > 0
        speechHistoryNextButton.isEnabled = speechHistoryIndex >= 0 && speechHistoryIndex < speechHistoryEntries.lastIndex
        speechHistoryPlayButton.isEnabled = hasHistory
        speechHistoryStopButton.isEnabled = hasHistory
    }

    private fun moveSpeechHistory(delta: Int) {
        if (speechHistoryEntries.isEmpty()) return
        speechHistoryIndex = (speechHistoryIndex + delta).coerceIn(0, speechHistoryEntries.lastIndex)
        renderSpeechHistory()
    }

    private fun playSelectedSpeech() {
        if (sessionMode == SessionMode.SLEEPING || sessionMode == SessionMode.OFF) {
            showStatus("Speech playback is only available while awake or recording.")
            return
        }
        val entry = speechHistoryEntries.getOrNull(speechHistoryIndex) ?: return
        thread(name = "VoiceStreamSpeechHistoryPlayback") {
            val audio = SpeechHistoryStore.readAudio(applicationContext, entry)
            if (audio == null) {
                showStatus("Saved speech is unavailable.")
                runOnUiThread { refreshSpeechHistory(selectLatest = false) }
                return@thread
            }
            AssistantAudioPlayer.playWav(applicationContext, audio, rememberOnComplete = false) { status ->
                showStatus(status)
            }
            showStatus("Playing saved speech.")
        }
    }

    private fun stopSpeechPlayback() {
        AssistantAudioPlayer.stopAll()
        showStatus("Assistant audio stopped.")
    }

    private fun speechHistorySubtitle(entry: SpeechHistoryEntry): String {
        val time = runCatching {
            SPEECH_TIME_FORMAT.format(Instant.parse(entry.createdAt).atZone(ZoneId.systemDefault()))
        }.getOrDefault(entry.createdAt.take(16))
        val text = entry.text?.takeIf { it.isNotBlank() } ?: entry.source?.takeIf { it.isNotBlank() }
        val size = if (entry.bytes > 0) " | ${entry.bytes / 1024} KB" else ""
        return if (text.isNullOrBlank()) "$time$size" else "$time | ${text.take(72)}$size"
    }

    private fun formatArtifactSize(bytes: Int): String {
        if (bytes <= 0) return "0 B"
        if (bytes < 1024) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024) return "${if (kb >= 10) kb.toInt().toString() else String.format(Locale.US, "%.1f", kb)} KB"
        val mb = kb / 1024.0
        return "${if (mb >= 10) mb.toInt().toString() else String.format(Locale.US, "%.1f", mb)} MB"
    }

    private fun loadConfigIntoForm() {
        val config = api.loadConfig()
        serverInput.setText(config.serverUrl)
        val prefs = getSharedPreferences(Constants.PREFS_NAME, MODE_PRIVATE)
        deviceNameInput.setText(prefs.getString(Constants.PREF_DEVICE_NAME, Constants.DEFAULT_DEVICE_NAME))
        if (::echoCancellationCheckbox.isInitialized) {
            echoCancellationCheckbox.isChecked = AcousticEchoCanceler.isAvailable() && api.androidEchoCancellationEnabled()
        }
        updatePairingMessage()
    }

    private fun saveConfigFromForm() {
        val current = api.loadConfig()
        api.saveConfig(ApiConfig(
            serverUrl = serverInput.text.toString(),
            authMode = current.authMode.ifBlank { Constants.AUTH_DEV },
            bearerToken = current.bearerToken,
            devEmail = current.devEmail.ifBlank { Constants.DEFAULT_DEV_EMAIL },
            devName = current.devName.ifBlank { Constants.DEFAULT_DEV_NAME },
            devAdmin = current.devAdmin
        ))
        getSharedPreferences(Constants.PREFS_NAME, MODE_PRIVATE).edit()
            .putString(Constants.PREF_DEVICE_NAME, deviceNameInput.text.toString().ifBlank { Constants.DEFAULT_DEVICE_NAME })
            .apply()
        val echoSettingChanged = if (::echoCancellationCheckbox.isInitialized) {
            val nextEchoEnabled = echoCancellationCheckbox.isEnabled && echoCancellationCheckbox.isChecked
            val changed = api.androidEchoCancellationEnabled() != nextEchoEnabled
            api.saveAndroidEchoCancellationEnabled(nextEchoEnabled)
            changed
        } else {
            false
        }
        showStatus(
            if (echoSettingChanged && sessionMode != SessionMode.OFF) {
                "Settings saved. Restart listening to apply echo canceler."
            } else {
                "Settings saved."
            }
        )
    }

    private fun refreshDashboard() = runApi("Loading dashboard") {
        if (api.pairedDeviceId().isNotBlank() && api.pairedDeviceToken().isNotBlank()) {
            val displayName = api.pairedDeviceDisplayName().ifBlank { "this phone" }
            showStatus("Connected as $displayName.")
            return@runApi
        }
        val dashboard = api.dashboard()
        showStatus("Connected as ${dashboard.displayName}.")
    }

    private fun pairDevice() {
        saveConfigFromForm()
        val deviceName = deviceNameInput.text.toString().ifBlank { Constants.DEFAULT_DEVICE_NAME }
        runApi("Pairing Android device") {
            val pairing = api.pairDevice(deviceName)
            api.savePairing(pairing, deviceName)
            showStatus("Paired ${pairing.deviceId.take(14)}.")
            updatePairingMessage()
            runOnUiThread { renderAuthState() }
            checkForAppUpdate(force = true)
        }
    }

    private fun startQrScan() {
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            launchQrScanner()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun launchQrScanner() {
        runCatching {
            qrScanLauncher.launch(
                ScanOptions()
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt("Scan VoiceStream pairing or update QR")
                    .setBeepEnabled(false)
                    .setOrientationLocked(false)
            )
        }.onFailure { error ->
            showPairingMessage("Scanner unavailable: ${error.message}. Paste the QR payload instead.")
        }
    }

    private fun applyPairingPayload(payload: String) {
        if (isAndroidSetupUrl(payload)) {
            redeemAndroidSetup(payload)
            return
        }

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

        val minClientVersion = config.minClientVersion ?: 1L
        if (BuildConfig.VERSION_CODE.toLong() < minClientVersion) {
            showUpdateRequired(config)
            return
        }
        config.expiresAt?.let { expiresAt ->
            runCatching { java.time.Instant.parse(expiresAt) }.getOrNull()?.let { expiry ->
                if (expiry.isBefore(java.time.Instant.now())) {
                    showPairingMessage("Pairing payload expired at $expiresAt.")
                    return
                }
            }
        }

        if (config.deviceId.isBlank()) {
            api.saveConfig(api.loadConfig().copy(serverUrl = config.serverUrl))
            loadConfigIntoForm()
            showPairingMessage("Server URL saved from QR. Pair this device to finish setup.")
            showStatus("Server URL saved from QR.")
            return
        }

        api.savePairing(config)
        loadConfigIntoForm()
        showPairingMessage("Paired ${config.deviceId.take(14)} from QR payload.")
        showStatus("Paired ${config.deviceId.take(14)} from QR payload.")
        renderAuthState()
        checkForAppUpdate(force = true)
    }

    private fun isAndroidSetupUrl(payload: String): Boolean = runCatching {
        val uri = URI(payload.trim())
        val scheme = uri.scheme?.lowercase()
        (scheme == "http" || scheme == "https") && uri.path.orEmpty().contains("/api/mobile/android/setup/")
    }.getOrDefault(false)

    private fun redeemAndroidSetup(payload: String) = runApi("Checking Android setup QR") {
        val result = api.redeemAndroidSetup(payload)
        if (result.updateAvailable) {
            val latestVersion = result.latestVersionCode ?: currentVersionCode() + 1
            runOnUiThread { showUpdateAvailable(UpdateConfig(latestVersion, result.apkUrl)) }
            return@runApi
        }

        val pairingPayload = result.pairingPayload
        if (pairingPayload.isNullOrBlank()) {
            showPairingMessage("Android setup QR did not return pairing data.")
            return@runApi
        }

        val config = PairingPayloadParser.parse(pairingPayload).getOrElse { error ->
            showPairingMessage("Pairing failed: ${error.message}")
            return@runApi
        }
        api.savePairing(config)
        runOnUiThread {
            loadConfigIntoForm()
            showPairingMessage("Paired ${config.deviceId.take(14)} from setup QR.")
            showStatus("Paired ${config.deviceId.take(14)} from setup QR.")
            renderAuthState()
            checkForAppUpdate(force = true)
        }
    }

    private fun handleUpdatePayload(config: UpdateConfig) {
        val currentVersionCode = currentVersionCode()
        if (currentVersionCode >= config.versionCode) {
            showPairingMessage("VoiceStream app is up to date.")
            renderUpdateBanner(null)
            return
        }
        renderUpdateBanner(config)
        showUpdateAvailable(config)
    }

    private fun showUpdateAvailable(config: UpdateConfig) {
        val message = "A newer VoiceStream build is available. Current versionCode is ${currentVersionCode()}; latest is ${config.versionCode}."
        showPairingMessage("Update available")
        AlertDialog.Builder(this)
            .setTitle("Update VoiceStream")
            .setMessage(message)
            .setPositiveButton("Download APK") { _, _ -> openUpdateUrl(config.apkUrl) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showUpdateRequired(config: PairingConfig) {
        showPairingMessage("Update required")
        AlertDialog.Builder(this)
            .setTitle("Update VoiceStream")
            .setMessage("This server requires a newer app build before pairing. Download and install the latest APK, then scan again.")
            .setPositiveButton("Download APK") { _, _ -> openUpdateUrl(config.apkUrl) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openUpdateUrl(apkUrl: String?) {
        if (apkUrl.isNullOrBlank()) {
            Toast.makeText(this, "No APK download URL was included in the QR code", Toast.LENGTH_LONG).show()
            return
        }
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl)))
        }.onFailure { error ->
            Toast.makeText(this, "Could not open APK URL: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun checkForAppUpdate(force: Boolean = false, showNoUpdate: Boolean = false) {
        val connected = api.pairedDeviceId().isNotBlank() && api.pairedDeviceToken().isNotBlank()
        if (!connected) {
            renderUpdateBanner(null)
            if (showNoUpdate) showStatus("Sign in to check for app updates.")
            return
        }

        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastUpdateCheckAtMs < UPDATE_CHECK_INTERVAL_MS) return
        if (updateCheckRunning) return

        lastUpdateCheckAtMs = now
        updateCheckRunning = true
        if (showNoUpdate) showStatus("Checking for app update.")

        thread {
            try {
                val release = api.androidRelease()
                val latestVersionCode = release.versionCode
                if (release.available && latestVersionCode != null && latestVersionCode > currentVersionCode()) {
                    runOnUiThread {
                        renderUpdateBanner(UpdateConfig(latestVersionCode, release.apkUrl))
                        if (showNoUpdate) showStatus("Update available.")
                    }
                } else {
                    runOnUiThread {
                        renderUpdateBanner(null)
                        if (showNoUpdate) showStatus("VoiceStream app is up to date.")
                    }
                }
            } catch (error: Exception) {
                if (showNoUpdate) showStatus(error.message ?: "Update check failed")
            } finally {
                updateCheckRunning = false
            }
        }
    }

    private fun renderUpdateBanner(config: UpdateConfig?) {
        runOnUiThread {
            currentUpdateConfig = config
            if (!::updateBanner.isInitialized) return@runOnUiThread
            if (config == null) {
                updateBanner.visibility = View.GONE
                return@runOnUiThread
            }

            updateBannerTitle.text = "VoiceStream update available"
            updateBannerSubtitle.text = "Installed: ${currentVersionCode()}. Latest: ${config.versionCode}."
            updateBannerButton.isEnabled = !config.apkUrl.isNullOrBlank()
            updateBanner.visibility = View.VISIBLE
        }
    }

    private fun ensureMicThenStart(target: String = Constants.STREAM_TARGET_ASSISTANT, playCue: Boolean = true) {
        pendingStartAwake = false
        pendingStartTarget = target
        val missingPermissions = missingVoicePermissions()
        if (missingPermissions.isEmpty()) {
            startVoiceSession(target, playCue)
        } else {
            voicePermissions.launch(missingPermissions.toTypedArray())
        }
    }

    private fun ensureMicThenStartAwake() {
        pendingStartAwake = true
        pendingStartTarget = Constants.STREAM_TARGET_ASSISTANT
        val missingPermissions = missingVoicePermissions()
        if (missingPermissions.isEmpty()) {
            startAwakeService()
        } else {
            voicePermissions.launch(missingPermissions.toTypedArray())
        }
    }

    private fun missingVoicePermissions(): List<String> {
        return VoicePermissions.missingPermissions(Build.VERSION.SDK_INT) { permission ->
            checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun resyncServiceStatus() {
        runCatching {
            startService(Intent(this, VoiceSessionService::class.java).apply {
                action = Constants.ACTION_QUERY_STATUS
            })
        }.onFailure { error ->
            ClientLog.w("Activity", "Service status query failed", error)
        }
    }

    private fun startVoiceSession(target: String = Constants.STREAM_TARGET_ASSISTANT, playCue: Boolean = true) {
        val deviceId = api.pairedDeviceId()
        if (deviceId.isBlank()) {
            showStatus("Pair this device first.")
            return
        }
        wakeController.manualStartRecording()
        if (playCue) cuePlayer.play(LocalCue.START_BUTTON)
        ContextCompat.startForegroundService(
            this,
            Intent(this, VoiceSessionService::class.java).apply {
                action = Constants.ACTION_START_VOICE
                putExtra(Constants.EXTRA_STREAM_TARGET, target)
            }
        )
        showStatus("Foreground voice service started.")
    }

    private fun startAwakeService() {
        val deviceId = api.pairedDeviceId()
        if (deviceId.isBlank()) {
            showStatus("Pair this device first.")
            return
        }
        wakeController.startAwake()
        cuePlayer.play(LocalCue.WAKE)
        updateSessionUi(SessionMode.LOADING, "Waking local detector.")
        ContextCompat.startForegroundService(
            this,
            Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_START_AWAKE }
        )
        showStatus("Waking local detector.")
    }

    private fun stopRecording(playCue: Boolean = true) {
        startService(Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_STOP_RECORDING })
        wakeController.manualStopRecording(returnToAwake = true)
        if (playCue) cuePlayer.play(LocalCue.STOP_BUTTON)
        showStatus("Awake. Waiting for voice command.")
        updateSessionUi(SessionMode.AWAKE, "Awake. Waiting for voice command.")
    }

    private fun enterSleep() {
        AssistantAudioPlayer.stopAll()
        startService(Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_SLEEP })
        wakeController.toggleAwakeSleep()
        showStatus("Sleeping.")
        updateSessionUi(SessionMode.SLEEPING, "Sleeping.")
    }

    private fun turnOff() {
        AssistantAudioPlayer.stopAll()
        startService(Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_STOP_VOICE })
        wakeController.stopAll()
        cuePlayer.play(LocalCue.STOP_BUTTON)
        showStatus("Off.")
        updateSessionUi(SessionMode.OFF, "Off.")
    }

    private fun openWebDashboard() {
        saveConfigFromForm()
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(VoiceStreamWebUrls.dashboardUrl(serverInput.text.toString().ifBlank { Constants.DEFAULT_SERVER_URL }))))
    }

    private fun signInWithBrowser() {
        saveConfigFromForm()
        browserAuth.start(
            serverUrl = serverInput.text.toString().ifBlank { Constants.DEFAULT_SERVER_URL },
            deviceName = deviceNameInput.text.toString().ifBlank { Constants.DEFAULT_DEVICE_NAME },
        )
    }

    private fun signOut() {
        browserAuth.stop()
        turnOff()
        api.clearPairing()
        updatePairingMessage()
        renderAuthState()
        renderUpdateBanner(null)
        showStatus("Signed out.")
    }

    private fun browserAuthCallbacks(): BrowserAuthCoordinator.Callbacks {
        return object : BrowserAuthCoordinator.Callbacks {
            override fun onAuthStarting() {
                signInButton.isEnabled = false
                showStatus("Opening sign in.")
            }

            override fun openBrowser(uri: Uri) {
                startActivity(Intent(Intent.ACTION_VIEW, uri))
            }

            override fun onBrowserOpened() {
                showStatus("Finish sign in in your browser.")
                updatePairingMessage()
            }

            override fun onAuthWaiting() {
                showStatus("Waiting for browser sign in.")
            }

            override fun onAuthConnected() {
                signInButton.isEnabled = true
                loadConfigIntoForm()
                renderAuthState()
                showStatus("Signed in.")
                refreshDashboard()
                checkForAppUpdate(force = true)
            }

            override fun onAuthExpired() {
                signInButton.isEnabled = true
                showPairingMessage("Sign in expired. Try again.")
            }

            override fun onAuthError(message: String) {
                signInButton.isEnabled = true
                showPairingMessage(message)
            }
        }
    }

    private fun renderAuthState() {
        val connected = api.pairedDeviceId().isNotBlank() && api.pairedDeviceToken().isNotBlank()
        signedOutPanel.visibility = if (connected) View.GONE else View.VISIBLE
        voicePanel.visibility = if (connected) View.VISIBLE else View.GONE
        settingsButton.visibility = if (connected) View.VISIBLE else View.GONE
        microphoneText.visibility = if (connected) View.VISIBLE else View.GONE
        filesButton.visibility = if (connected) View.VISIBLE else View.GONE
        filesBadgeText.visibility = if (connected && (assistantThreadSummary?.artifactsCount ?: assistantArtifacts.size) > 0) View.VISIBLE else View.GONE
        signOutButton.visibility = if (connected) View.VISIBLE else View.GONE
        if (!connected) {
            settingsPanel.visibility = View.GONE
            settingsButton.text = "Settings"
            renderUpdateBanner(null)
            if (::filesPanel.isInitialized) filesPanel.visibility = View.GONE
            assistantThreadSummary = null
            assistantArtifacts = emptyList()
            selectedArtifactIndex = -1
        }
        if (!connected) {
            updateSessionUi(SessionMode.OFF, "Sign in to connect this phone.")
        } else if (sessionMode == SessionMode.OFF) {
            updateSessionUi(SessionMode.OFF, "Ready.")
        }
        updatePairingMessage()
        if (connected) refreshAssistantThreadSummary()
    }

    private fun updatePairingMessage() {
        val deviceId = api.pairedDeviceId()
        pairingMessageText.text = if (deviceId.isBlank()) {
            if (browserAuth.isPending) "Waiting for browser sign in." else "Not signed in."
        } else {
            "Paired device ${deviceId.take(14)}"
        }
    }

    private fun currentVersionCode(): Long {
        return runCatching {
            val packageInfo = packageManager.getPackageInfo(packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                packageInfo.versionCode.toLong()
            }
        }.getOrDefault(BuildConfig.VERSION_CODE.toLong())
    }

    private fun currentVersionLabel(): String {
        val versionName = runCatching {
            packageManager.getPackageInfo(packageName, 0).versionName?.takeIf { it.isNotBlank() }
        }.getOrNull() ?: BuildConfig.VERSION_NAME
        return "$versionName (versionCode ${currentVersionCode()})"
    }

    private fun runApi(workingStatus: String, block: () -> Unit) {
        showStatus(workingStatus)
        thread {
            try {
                block()
            } catch (error: Exception) {
                showStatus(error.message ?: "Request failed")
            }
        }
    }

    private fun showStatus(text: String) {
        runOnUiThread { statusText.text = text }
    }

    private fun showPairingMessage(message: String) {
        runOnUiThread {
            pairingMessageText.text = message
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        }
    }

    private fun card(title: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(COLOR_FLOATING, 8.dp(), COLOR_STROKE)
        setPadding(16.dp(), 14.dp(), 16.dp(), 16.dp())
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        params.setMargins(0, 0, 0, 14.dp())
        layoutParams = params
        addView(label(title, 18f, COLOR_TEXT, true))
    }

    private fun buildSpeechHistoryPanel(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(COLOR_FLOATING, 8.dp(), COLOR_STROKE)
        setPadding(14.dp(), 12.dp(), 14.dp(), 14.dp())

        speechHistoryTitle = label("Speech history", 15f, COLOR_TEXT, true)
        addView(speechHistoryTitle)

        speechHistorySubtitle = label("No saved speech yet.", 12f, COLOR_MUTED, false).apply {
            setPadding(0, 4.dp(), 0, 0)
            maxLines = 2
        }
        addView(speechHistorySubtitle)

        val controls = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 10.dp(), 0, 0)
        }
        speechHistoryPrevButton = historyButton("<") { moveSpeechHistory(-1) }
        speechHistoryPlayButton = historyButton("Play") { playSelectedSpeech() }
        speechHistoryStopButton = historyButton("Stop") { stopSpeechPlayback() }
        speechHistoryNextButton = historyButton(">") { moveSpeechHistory(1) }

        listOf(speechHistoryPrevButton, speechHistoryPlayButton, speechHistoryStopButton, speechHistoryNextButton).forEachIndexed { index, view ->
            controls.addView(view, LinearLayout.LayoutParams(0, 42.dp(), if (index == 0 || index == 3) 0.8f else 1.2f).apply {
                if (index < 3) rightMargin = 8.dp()
            })
        }
        addView(controls)
    }

    private fun buildUpdateBanner(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        visibility = View.GONE
        background = rounded(COLOR_UPDATE_SURFACE, 8.dp(), COLOR_YELLOW)
        setPadding(14.dp(), 12.dp(), 12.dp(), 12.dp())

        val textColumn = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            updateBannerTitle = label("", 15f, COLOR_TEXT, true)
            updateBannerSubtitle = label("", 12f, COLOR_MUTED, false).apply {
                setPadding(0, 3.dp(), 0, 0)
            }
            addView(updateBannerTitle)
            addView(updateBannerSubtitle)
        }
        addView(textColumn, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        updateBannerButton = button("Download") {
            openUpdateUrl(currentUpdateConfig?.apkUrl)
        }
        addView(updateBannerButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, 42.dp()).apply {
            leftMargin = 12.dp()
        })
    }

    private fun historyButton(textValue: String, onClick: () -> Unit): Button = button(textValue, onClick).apply {
        textSize = 12f
        background = rounded(COLOR_SURFACE, 6.dp(), COLOR_STROKE)
        setTextColor(COLOR_TEXT)
    }

    private fun row(vararg views: View): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, 8.dp(), 0, 0)
        views.forEachIndexed { index, view ->
            addView(view, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                if (index < views.lastIndex) rightMargin = 8.dp()
            })
        }
    }

    private fun field(hint: String): EditText = EditText(this).apply {
        setHint(hint)
        setSingleLine(true)
        textSize = 14f
        setTextColor(COLOR_TEXT)
        setHintTextColor(COLOR_MUTED)
        background = rounded(COLOR_INPUT, 6.dp(), COLOR_STROKE)
        setPadding(12.dp(), 0, 12.dp(), 0)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 44.dp()).apply {
            topMargin = 10.dp()
        }
    }

    private fun button(textValue: String, onClick: () -> Unit): Button = Button(this).apply {
        text = textValue
        isAllCaps = false
        setTextColor(COLOR_BUTTON_TEXT)
        textSize = 13f
        typeface = Typeface.DEFAULT_BOLD
        background = rounded(COLOR_ACCENT, 6.dp(), COLOR_ACCENT_MUTED)
        minHeight = 0
        minimumHeight = 0
        setOnClickListener { onClick() }
    }

    private fun label(textValue: String, size: Float, color: Int, bold: Boolean): TextView = TextView(this).apply {
        text = textValue
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        includeFontPadding = true
    }

    private fun Button.stylePrimaryButton(mode: SessionMode) {
        isAllCaps = false
        text = when (mode) {
            SessionMode.OFF -> "Start"
            SessionMode.SLEEPING -> "Wake"
            SessionMode.LOADING -> "Cancel"
            SessionMode.AWAKE -> "Sleep"
            SessionMode.RECORDING -> "Stop"
            SessionMode.ERROR -> "Retry"
        }
        gravity = Gravity.CENTER
        setTextColor(COLOR_TEXT)
        textSize = 22f
        typeface = Typeface.DEFAULT_BOLD
        background = actionBackground(mode)
        minHeight = 0
        minimumHeight = 0
        elevation = 12.dp().toFloat()
        translationZ = 3.dp().toFloat()
    }

    private fun Button.styleSecondaryButton() {
        setTextColor(COLOR_TEXT)
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        isAllCaps = false
        background = rounded(COLOR_FLOATING, 24.dp(), COLOR_STROKE)
        minHeight = 0
        minimumHeight = 0
    }

    private fun Button.styleFloatingButton() {
        setTextColor(COLOR_TEXT)
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        isAllCaps = false
        setPadding(18.dp(), 0, 18.dp(), 0)
        background = rounded(COLOR_FLOATING, 12.dp(), COLOR_STROKE)
        minHeight = 0
        minimumHeight = 0
        elevation = 6.dp().toFloat()
    }

    private fun rounded(fill: Int, radius: Int, stroke: Int): GradientDrawable = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = radius.toFloat()
        setStroke(1.dp(), stroke)
    }

    private fun actionBackground(mode: SessionMode): GradientDrawable {
        val colors = when (mode) {
            SessionMode.OFF -> intArrayOf(COLOR_FLOATING, COLOR_DARK)
            SessionMode.SLEEPING -> intArrayOf(0xff252b34.toInt(), COLOR_DARK)
            SessionMode.LOADING -> intArrayOf(0xff3a301d.toInt(), 0xff211c15.toInt())
            SessionMode.AWAKE -> intArrayOf(0xff163425.toInt(), 0xff11251c.toInt())
            SessionMode.RECORDING -> intArrayOf(0xff31234b.toInt(), 0xff201833.toInt())
            SessionMode.ERROR -> intArrayOf(0xff371c23.toInt(), 0xff23161a.toInt())
        }
        val stroke = when (mode) {
            SessionMode.OFF -> COLOR_STROKE
            SessionMode.SLEEPING -> COLOR_MUTED
            SessionMode.LOADING -> COLOR_YELLOW
            SessionMode.AWAKE -> COLOR_GREEN
            SessionMode.RECORDING -> COLOR_ACCENT
            SessionMode.ERROR -> COLOR_RED
        }
        return GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, colors).apply {
            shape = GradientDrawable.OVAL
            setStroke(2.dp(), stroke)
        }
    }

    private fun positionSystemBars(topInset: Int, bottomInset: Int) {
        val safeBottom = bottomInset + 26.dp()
        if (::settingsButton.isInitialized) settingsButton.updateFrameMargins(bottom = safeBottom)
        if (::microphoneText.isInitialized) microphoneText.updateFrameMargins(bottom = safeBottom)
        if (::settingsPanel.isInitialized) settingsPanel.updateFrameMargins(bottom = safeBottom + 74.dp())
        if (::root.isInitialized) root.setPadding(24.dp(), topInset + 28.dp(), 24.dp(), safeBottom + 94.dp())
        if (::filesPanel.isInitialized) filesPanel.setPadding(18.dp(), topInset + 20.dp(), 18.dp(), safeBottom)
    }

    private fun View.updateFrameMargins(top: Int? = null, bottom: Int? = null) {
        val params = layoutParams as? FrameLayout.LayoutParams ?: return
        if (top != null) params.topMargin = top
        if (bottom != null) params.bottomMargin = bottom
        layoutParams = params
    }

    private fun WindowInsets.topSystemInset(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getInsets(WindowInsets.Type.systemBars()).top
        } else {
            @Suppress("DEPRECATION")
            systemWindowInsetTop
        }
    }

    private fun WindowInsets.bottomSystemInset(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getInsets(WindowInsets.Type.systemBars()).bottom
        } else {
            @Suppress("DEPRECATION")
            systemWindowInsetBottom
        }
    }

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).roundToInt()

    private enum class SessionMode {
        OFF,
        LOADING,
        AWAKE,
        SLEEPING,
        RECORDING,
        ERROR;

        companion object {
            fun fromBroadcast(mode: String, status: String): SessionMode {
                return when (mode) {
                    Constants.MODE_LOADING -> LOADING
                    Constants.MODE_AWAKE -> if (status.contains("Waking", ignoreCase = true)) LOADING else AWAKE
                    Constants.MODE_SLEEPING -> SLEEPING
                    Constants.MODE_RECORDING -> RECORDING
                    Constants.MODE_ERROR -> ERROR
                    Constants.MODE_OFF -> OFF
                    else -> fromStatus(status)
                }
            }

            private fun fromStatus(status: String): SessionMode {
                val lower = status.lowercase()
                return when {
                    lower.isBlank() || lower == "off" || lower.contains("sign in") || lower.contains("pair this device") -> OFF
                    lower.contains("failed") || lower.contains("error") || lower.contains("missing") -> ERROR
                    lower.contains("waking") || lower.contains("starting") || lower.contains("reconnecting") || lower.contains("thinking") || lower.contains("queued") || lower.contains("waiting for approval") -> LOADING
                    lower.startsWith("sleep") || lower.startsWith("unlock") || lower.contains("sleeping") -> SLEEPING
                    lower.contains("waiting") || lower.contains("listening") || lower.contains("assistant replied") || lower.contains("transcript received") || lower.contains("audio received") -> AWAKE
                    lower.contains("assistant audio") -> AWAKE
                    else -> RECORDING
                }
            }
        }
    }

    private companion object {
        const val COLOR_BACKGROUND = 0xff101216.toInt()
        const val COLOR_SURFACE = 0xff171b21.toInt()
        const val COLOR_INPUT = 0xff151a20.toInt()
        const val COLOR_FLOATING = 0xff1e2329.toInt()
        const val COLOR_UPDATE_SURFACE = 0xff20242a.toInt()
        const val COLOR_TEXT = 0xffdfe3ea.toInt()
        const val COLOR_MUTED = 0xff8891a8.toInt()
        const val COLOR_ACCENT = 0xffa78bfa.toInt()
        const val COLOR_ACCENT_MUTED = 0xff8b5cf6.toInt()
        const val COLOR_BUTTON_TEXT = 0xff101216.toInt()
        const val COLOR_STROKE = 0xff2d3340.toInt()
        const val COLOR_DARK = 0xff151a20.toInt()
        const val COLOR_GREEN = 0xff4ade80.toInt()
        const val COLOR_YELLOW = 0xffffb224.toInt()
        const val COLOR_RED = 0xffff5a5a.toInt()
        const val UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L
        const val COLOR_SYSTEM_BAR = 0xcc101216.toInt()
        val SPEECH_TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d HH:mm")
    }
}
