# Drone Hub Mobile

Android-first React Native client for the Drone Hub device mesh. It is an Expo development-build project, not a WebView around Remote Hub.

From the monorepo root:

```sh
bun run --filter @drone/device-protocol build
bun run --filter drone-hub-mobile typecheck
bun run --filter drone-hub-mobile android:native
```

The native command requires the normal Android SDK/emulator or a connected Android device.

To pair:

1. Open **Settings → Devices** on an existing Drone Hub.
2. Enter its reachable HTTPS URL and create a pairing QR.
3. Scan the QR in this app.
4. Approve the pending phone on the existing Hub and select only the needed operations.
5. Configure any different permissions separately on every other destination Hub.

The private P-256 key is encrypted through Expo Secure Store. It is loaded into JavaScript memory for prototype signing, so a native non-exportable Android key implementation remains production hardening. Forwarded application payloads are signed but rely on TLS until destination-only encryption is implemented.
