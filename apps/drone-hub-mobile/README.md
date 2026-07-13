# Drone Hub Mobile

Android-first React Native client for the Drone Hub device mesh. It is an Expo development-build project, not a WebView around Remote Hub.

From the monorepo root:

```sh
bun run drone:mobile:android:install
```

The command builds the shared device protocol and assistant chat model, asks which connected
Android device to use, then builds, installs, and opens the development app. It requires the Android
SDK, USB debugging, and a phone visible to `adb devices`.

To pair:

1. Open **Settings → Devices** on an existing Drone Hub.
2. Enter its reachable HTTPS URL and create a pairing QR.
3. Scan the QR in this app.
4. Approve the pending phone on the existing Hub and select only the needed operations.
5. Configure any different permissions separately on every other destination Hub.

## Assistant on the phone

The **Assistant → On this phone** view runs a small assistant loop directly in the React Native
process. It does not ask another Hub to host the thread.

1. In the mobile **Settings** tab, save an OpenAI API key and model. The key is kept in Android
   secure storage and is sent only to OpenAI.
2. Create a phone thread and open **Access**.
3. Select a connected device that advertises the `workspace` capability, enter a root ID, and
   choose read or write access.
4. On that destination Hub, grant this phone the matching workspace operations. In its
   cross-device assistant policy, add the displayed phone device ID, mobile thread ID, root ID,
   and the same read/write level.

Both checks are required. A generic device grant cannot bypass the exact thread rule on the
workspace device. Phone conversations are bounded and stored in the app's private local storage;
the API key is stored separately in Secure Store.

The first phone runtime deliberately uses non-streaming model responses because streaming fetch
behavior varies across React Native versions. Stop cancels an active model request immediately,
but an already-sent mesh file operation may take until its normal timeout to return.

### Copying an OpenAI key from another Hub

The phone can explicitly copy an OpenAI API key from a trusted Hub instead of requiring manual
entry:

1. On the source Hub, open **Settings → Devices** and edit the phone.
2. Mark the phone as an administrator and grant `provider-credentials/openai.export`.
3. On the phone, open **Settings → Assistant on this phone**, select the source, and confirm the
   copy.

The source grant and the confirmation on the phone are both required. The key is encrypted for a
fresh, phone-owned transfer key before entering the mesh, so a forwarding bridge receives only
ciphertext. The imported key is stored in Android Secure Store. Copies are one-time snapshots, not
background synchronization.

Hub computers can use the matching **Provider credentials** panel to copy an OpenAI key or a
file-based Codex login from another Hub. Codex credentials held only in an operating-system
keychain cannot be exported by this prototype. Copying a Codex login does not yet enable Codex as a
provider for phone-local assistants.

The private P-256 key is encrypted through Expo Secure Store. It is loaded into JavaScript memory for prototype signing, so a native non-exportable Android key implementation remains production hardening. Forwarded application payloads are signed but rely on TLS until destination-only encryption is implemented.
