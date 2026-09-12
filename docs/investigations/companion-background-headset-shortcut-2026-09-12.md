# Optional background headset shortcut on Android

The phone's Companion Live settings now include **Start Companion with headset button**, off by default and persisted locally. Enabling it arms the existing foreground service and a paused media session while an activity is visible. No AudioRecord, Bluetooth voice route, audio focus, or remote Live connection opens until Play is requested. Microphone, notification, and Bluetooth permissions are obtained up front, including Bluetooth permission when no headset is connected yet.

A headset press can open a closed Companion directly in Live using the Hub currently selected in Drone Hub. The Hub must be reachable and have Live voice enabled. The shortcut does not change the Hub's shared preference or fall back to dictation. It uses the same workspace validation and backend delegation path as the app microphone. Existing microphone ownership is respected.

Closing Companion releases its Live audio and session but retains the armed controls when opted in. Pause still leaves Companion and backend work intact. Turning the setting off while idle releases the service; turning it off during active/paused Live preserves that conversation's usual controls until it is closed. Notification End voice explicitly turns the shortcut off. Startup and permission races share one controls registration and cancel late microphone startup.

The foreground service remains START_NOT_STICKY. After force-stop, reboot, or process death, reopen Drone to rearm the saved preference. Android selects the recipient of media buttons, so another active media app can receive them. This implementation does not claim to override music apps, calls, or Android's stopped-app restrictions. It adds no iOS background-launch toggle.

Android references:
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/media/legacy/media-buttons

Validation before deployment:
- 14 Live lifecycle tests, including idle arming, closed/locked startup, retained controls after close, disable during Live, concurrent arming/startup in either order, immediate cancellation after closing, and disabling during permission requests.
- 17 Companion context tests, including direct Live startup without changing shared preferences and microphone contention.
- 3 local preference tests: default off, persistence/notification End, foreground-only restoration, and permission failure.
- 3 controls registration tests; 5 permission tests; 7 audio lifecycle tests; 12 Live connection/startup buffering tests.
- Native playback, media control, and Bluetooth route test suites; the standby test verifies no initial audio-focus request and one Play on the first physical button event.
- Mobile TypeScript check and Android Kotlin compilation passed.

Physical headset/lock-screen behavior still needs confirmation on the installed build; automated tests exercise the same media callback and background lifecycle paths but cannot emulate Bluetooth firmware or Android's choice among other media apps.
