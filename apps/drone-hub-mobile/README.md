# Drone Hub Mobile

Android-first React Native client for the Drone Hub device mesh. It is an Expo development-build project, not a WebView around Remote Hub.

From the monorepo root:

```sh
bun run drone:mobile:android:install
```

The command builds the shared device protocol, asks which connected Android device to use, then
builds, installs, and opens the development app. It requires the Android SDK, USB debugging, and a
phone visible to `adb devices`.

To pair:

1. Open **Settings → Devices** on an existing Drone Hub.
2. Enter its reachable HTTPS URL and create a pairing QR.
3. Scan the QR in this app.
4. Approve the pending phone on the existing Hub and select only the needed operations.
5. Configure any different permissions separately on every other destination Hub.

The private P-256 key is encrypted through Expo Secure Store. It is loaded into JavaScript memory for prototype signing, so a native non-exportable Android key implementation remains production hardening. Forwarded application payloads are signed but rely on TLS until destination-only encryption is implemented.
