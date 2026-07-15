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
one hour. The bounded conversation projection used by the UI remains in AsyncStorage; the complete
Blip transcript is stored as append-only chunks in the app's private document directory so it is not
subject to AsyncStorage's database ceiling. Provider credentials are stored separately in Secure
Store.

Phone-hosted assistants run the same portable `@blip/core` session lifecycle as Hub-hosted
assistants, including tool turns, progress events, cancellation, and workspace target semantics.
`@blip/workspace` supplies the shared browser-safe target catalog. Android injects a React Native
session repository plus OpenAI and Codex HTTP/SSE transports; Node storage, local filesystem tools,
Git/process diagnostics, and CLI prompt policy are not bundled.

The React Native repository persists session metadata, runtime events, messages, and compaction
checkpoints per thread. Writes add immutable transcript chunks and atomically replace only the small
state file. Existing threads without a Blip snapshot migrate their saved UI history on the next
prompt. Automatic compaction uses the same injected model transport as normal assistant turns and
restores its latest summary and retained-message boundary after an app restart.

Codex response text streams through the React Native transport into Blip session events. The OpenAI
Chat Completions transport currently commits each model response as a unit. Stop aborts the Blip
session, its model request, and active cancellable mesh command jobs.

Cross-device assistant thread lists refresh whenever their tab opens. While connected, authorized
thread-change notifications travel over the existing authenticated mesh WebSocket and trigger a
debounced refresh of the list and the open transcript.

Drone chat messages detect linked GitHub pull requests and can show their state, checks, review,
conflicts, and full branch names. The destination Hub supplies GitHub status using its existing
credentials; the phone does not store another GitHub token. Grant
`drone-control/repo.pull-requests.read` to show live status. Grant
`drone-control/repo.pull-requests.merge` or `drone-control/repo.pull-requests.close` only when that
phone should be allowed to change pull requests. The title opens the pull request in the Android
browser. Open requests refresh while the chat is visible (more often while checks are pending), and
actions refresh the native attachment immediately.

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
