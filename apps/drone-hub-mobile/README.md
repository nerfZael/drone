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

1. In the mobile **Settings** tab, choose either an OpenAI API key or a copied Codex subscription
   login and select a model. Credentials are kept in Android secure storage and are sent only to
   the selected OpenAI model service.
2. On a destination Hub, open **Settings → Device mesh → Workspaces**, choose one or more local
   folders, and grant this phone Read, Write, or Run commands access to each folder.
3. Create a phone thread and open **Access**. Expand a device and select any subset of the named
   workspaces and permissions it granted to the phone.
4. Apply the thread access changes. New threads start with no workspace access, and each thread can
   select multiple workspaces across multiple devices without copying IDs.

The destination's device-to-workspace grant is the maximum access. The phone narrows that grant for
each thread before exposing model tools. **Run commands** starts Bash in the workspace folder but is
host access and is not confined to that folder. Bash runs as an asynchronous destination-owned job:
the phone receives a job handle immediately, consumes output incrementally, and sends an explicit
cancel operation when a run is stopped. Commands default to a 30-minute timeout and are capped at
one hour. Phone conversations are bounded and stored in the
app's private local storage; provider credentials are stored separately in Secure Store.

Phone-hosted assistants use the browser-safe Blip workspace target catalog and the same
`list_targets`, `set_target`, per-call target, filesystem capability, and Bash target semantics as
Hub-hosted assistants. The complete `@blip/core` session runtime is not yet used on Android because
its current entry point depends on Node-only filesystem, process, child-process, and crypto modules.
The Android provider loop and persistence adapter therefore remain React Native implementations;
target selection and mesh workspace execution are shared. This boundary should remain explicit
until Blip exposes a fully platform-neutral agent/session core.

The phone commits complete model responses because streaming fetch behavior varies across React
Native versions. Codex SSE is buffered until the response completes. Stop cancels an active model
request immediately, but an already-sent mesh file operation may take until its normal timeout to
return.

Cross-device assistant thread lists refresh whenever their tab opens. While connected, authorized
thread-change notifications travel over the existing authenticated mesh WebSocket and trigger a
debounced refresh of the list and the open transcript.

Each assistant location opens its most recently updated thread. Tap the **Assistant** app header to
open the shared thread drawer. Phone and cross-device transcripts use the same compact message,
tool-call, image, attachment, composer, and model-selection presentation. Changing a model on a
remote thread additionally requires the `assistant-threads/thread.update` grant.

### Copying OpenAI or Codex credentials from another Hub

The phone can explicitly copy an OpenAI API key or a file-based Codex CLI login from a trusted Hub:

1. On the source Hub, open **Settings → Devices** and edit the phone.
2. Mark the phone as an administrator and grant `provider-credentials/openai.export`,
   `provider-credentials/codex.export`, or both.
3. On the phone, open **Settings → Assistant on this phone**, select the source, and copy the
   desired credential.
4. Select **OpenAI API** or **Codex subscription** as the phone assistant provider and save the
   assistant settings.

The source grant and the confirmation on the phone are both required. The key is encrypted for a
fresh, phone-owned transfer key before entering the mesh, so a forwarding bridge receives only
ciphertext. Imported credentials are stored in Android Secure Store. Copies are one-time snapshots,
not background synchronization. Copied Codex access tokens are refreshed on the phone with the
copied refresh token when they approach expiry.

Hub computers can use the matching **Provider credentials** panel to copy an OpenAI key or a
file-based Codex login from another Hub. Codex credentials held only in an operating-system
keychain cannot be exported by this prototype.

The private P-256 key is encrypted through Expo Secure Store. It is loaded into JavaScript memory for prototype signing, so a native non-exportable Android key implementation remains production hardening. Forwarded application payloads are signed but rely on TLS until destination-only encryption is implemented.
