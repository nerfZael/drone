# Companion as Android's phone assistant

Companion can be selected as the default digital assistant on Android 12 and later. In mobile Settings → Assistant → Companion Live voice, use **Use Companion as phone assistant**, grant audio permissions, and choose Drone Hub Mobile / Companion in Android's picker. On Samsung, the side button's long-press action may also need to be set to Digital assistant. The saved Hub must be reachable with Live voice enabled.

The assistant screen starts or resumes Live, offers Pause, End, and Open Drone Hub, and can be used above the keyguard. Open Drone Hub requests the device's unlock authentication before revealing the regular app. It uses the existing Companion session, selected Hub, workspace context, tool handlers, audio routing, and microphone coordinator. Selecting the default assistant does not itself start recording. The setup text explains that Companion can hear and act on requests while the phone is locked.

## Native integration

- `CompanionAssistantService` and `CompanionAssistantSessionService` are registered with `BIND_VOICE_INTERACTION` and voice-interaction metadata. Both standard assistant invocation and `onLaunchVoiceAssistFromKeyguard` hand off to the single existing React activity. No second React root or microphone owner is created.
- Only those system-bound services mint in-process launch tokens. An arbitrary external intent cannot create a microphone-start request. Launch state is retrieved on cold start and delivered by event on warm start, with the initial-read/event race handled in React.
- Android stops React rendering when an activity is hidden behind keyguard. Before allowing the activity above keyguard, native code hides its existing content and dialog windows and installs a loading cover. Companion's native `onLayout` acknowledges that the restricted surface has mounted; only then is the content revealed. DronesScreen retains its workspace hooks but renders no UI, and the regular Companion overlay and shell dialogs are unmounted.
- The assistant window excludes its contents from screenshots/task previews. Leaving assistant mode clears the lock-screen flags. End returns to the previous screen without dismissing keyguard.
- The assistant disables Android's foreground-app assist data and screenshot collection. It does not implement a hotword listener or a replacement system speech recognizer. Android 12+ permits an empty, explicitly present recognition-service field; older Android versions are excluded using versioned service-enabled resources. The emulator retained its existing speech-recognition service after Companion was selected.
- `with-phone-assistant` preserves the MainActivity lifecycle handoff during Expo prebuild.

## Launch lifecycle

Each request waits for the workspace to hydrate and connect, then validates native focus and audio permissions before starting. Startup has a 30-second deadline. Dismissing or backgrounding a pending invocation aborts startup, including during an asynchronous Hub preference request. Returning to the foreground does not automatically revive a cancelled press; Retry or another assistant invocation is required. Already established Live conversations retain their existing background behavior.

Review fixes: native request consumption survives activity/React recreation, preventing a handled press from replaying microphone startup. Explicit Retry rearms an active request. Dismissal and unlock callbacks carry their request ID, so an old callback cannot affect a newer press. A recreated activity restores the protected surface; the loading cover can be tapped to cancel. Native event-listener cleanup only removes the listener owned by that module instance.

Audio cancellation belongs to the provider operation that starts or resumes audio, rather than the presentation hook. Attaching a new surface to established Live cannot inadvertently stop that conversation. Repeated presses wait for cancelled startup to settle before opening another audio session. The voice screen scrolls to keep controls reachable with large text or long error messages. Native launch events can recover an initial bridge-read failure without revealing the regular app.

Changing away from Companion opens Android settings without requesting audio permissions. When Companion is selected, a separate Set up voice access button remains available. Phone-only use does not require Bluetooth permission; a connected classic Bluetooth headset does. Status refreshes do not erase permission-denial feedback.

The assistant requires the Hub's Live preference and never falls back to dictation. Repeated invocations preserve an active session and resume a paused one. Missing setup, permissions, or connectivity produces actionable screen feedback.

## Verification

- Android Kotlin compilation and release APK build for arm64-v8a and x86_64.
- Mobile TypeScript check.
- Launch hook tests: cold hydration, one start per request across remounts, repeated presses, cancellation during hydration/connection/native handoff, foreground restoration, established background sessions, stale native requests, and missing permissions with explicit retry.
- Native request-state regressions cover token rejection, consumption, explicit retry, stale dismissal/unlock IDs, and ended requests. Run with `python3 apps/drone-hub-mobile/scripts/test-phone-assistant.py`.
- Settings tests cover changing assistants without audio permission, separate voice setup, and permission feedback after foregrounding. Provider-entry tests cover initial read failure recovery and the initial-snapshot/event race.
- Companion provider tests verify Live preference enforcement, no dictation fallback, resuming paused Live, and cancelled invocations. Prebuild tests verify cold/warm hooks and idempotence.
- Android 14 emulator: role registration and metadata accepted; actual system assistant key launches the app; a cold invocation renders Companion while PIN keyguard remains showing and occluded; End returns to keyguard; Open Drone Hub shows the PIN prompt and reveals the app only after authentication; warm invocation with the regular model-picker dialog open hides that dialog and shows only Companion. Launch also succeeds with SYSTEM_ALERT_WINDOW denied.
- The reviewed release also passed activity recreation (font-scale configuration change) while PIN-locked, followed by authenticated navigation back to the full app. Final checks: 40 relevant TypeScript tests, the Kotlin request-state regressions, mobile typecheck, and the Android release build passed.

The physical Samsung phone was disconnected. Samsung's exact side-button mapping and a paired-Hub conversation from that phone's lock screen still require a device check. The emulator had no paired Hub, so audio/network startup is covered by the existing Live implementation and automated lifecycle/provider tests, not claimed as an emulator end-to-end voice test. Android may reset the assistant role after force-stopping its package; ordinary process recreation and installing an update are distinct from force-stop.

## Platform references

- [VoiceInteractionService and keyguard callback](https://developer.android.com/reference/android/service/voice/VoiceInteractionService#onLaunchVoiceAssistFromKeyguard())
- [Android assistant role](https://developer.android.com/reference/android/app/role/RoleManager#ROLE_ASSISTANT)
- [Voice interaction metadata parser](https://github.com/aosp-mirror/platform_frameworks_base/blob/master/core/java/android/service/voice/VoiceInteractionServiceInfo.java)
- [Android voice interaction manager](https://github.com/aosp-mirror/platform_frameworks_base/blob/master/services/voiceinteraction/java/com/android/server/voiceinteraction/VoiceInteractionManagerService.java)
- [Samsung side-button customization](https://www.samsung.com/au/support/mobile-devices/how-to-customise-the-side-button-with-new-features-on-your-galaxy-phone-and-tablet/)
