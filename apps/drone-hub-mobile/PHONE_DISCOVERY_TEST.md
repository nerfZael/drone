# Nearby pairing: Android test

Opening **Devices → Add device → Nearby** on Android starts a two-minute discovery window automatically. Changing methods stops discovery. It does not add an account, hosted directory, persistent phone server, or new content-storage format. iOS has no native discovery/listener implementation in this change and shows an explicit unsupported message; QR/address pairing still works there.

## Install and try

From the repository root, use the existing development-build command:

```sh
bun run drone:mobile:android:install
```

This rebuild is required: reloading JavaScript cannot add the native module. Install over the existing app using the same signing key. **Do not uninstall or clear storage** if Android reports a signing mismatch; resolve the signing configuration instead. The debug app uses the usual Expo/Metro development workflow.

1. Run the updated desktop Hub and enable its Tailscale HTTPS access.
2. Keep Tailscale connected on the phone, with incoming connections allowed. Tailnet rules must allow desktop-to-phone TCP 8792 and phone-to-desktop HTTPS.
3. Open **Devices → Add device → Nearby** on the phone. Keep it foregrounded. After two minutes, tap **Start discovery** to try again.
4. In desktop **Devices → Add device**, click **Find phones**, select the phone with **Connect**, and compare the four-group verification code with the phone.
5. Only if the codes match, tap **Codes match — connect** on the phone. Approve the request at the top of desktop Add device. Expand **Permissions** to choose access; permissions still default to none.
6. The temporary listener closes on phone confirmation. Normal HTTPS/SSE connections take over.

Repeat with the phone on cellular and the desktop on its usual network. That is the important real-Tailscale validation; a same-Wi-Fi success alone is not enough.

Also check that Stop discovery, backgrounding the app, leaving the pairing screen, and the two-minute deadline make the phone stop answering fresh probes. A desktop's old result row is not proof that the listener remains open: pressing Pair phone must fail once its session is closed/expired.

## Same-Wi-Fi automatic discovery

1. Run the updated desktop and rebuilt Android app on the same local network. Leave Tailscale connected on both and enable desktop HTTPS access.
2. Open **Devices → Add device** on both devices; leave mobile on **Nearby**. Do not enter addresses or scan a QR code.
3. Select **Connect** beside the discovered desktop, then approve its request on the desktop. The advertised identity is checked against a fresh signed HTTPS descriptor before any request is sent.
4. Alternatively, wait up to about 15 seconds for the phone to appear automatically on the desktop, choose **Connect**, and compare/confirm the codes as above. **Find phones** additionally scans Tailscale peers when the devices are on different networks.
5. Check Stop/Start on both screens. Leaving the desktop pairing section withdraws its advertisement; backgrounding the desktop window pauses it. If the browser crashes, its lease expires within about 45 seconds. Leaving or backgrounding mobile Pairing closes its browser, advertisement, and listener. Returning to foreground resumes a fresh window unless you explicitly pressed Stop.
6. Test with no desktop Add device screen open: after eight seconds mobile should show “No devices found yet”. Switching to **Scan QR**, **Address**, or **Code** must close nearby discovery; returning to **Nearby** starts a fresh window.

Wi-Fi discovery uses mDNS/DNS-SD (`_dronehub._tcp`, UDP 5353). Guest-network isolation, blocked multicast, or a host firewall can prevent discovery even when HTTPS/Tailscale works. This is local-network discovery, not tailnet enumeration. LAN offers to the temporary phone listener use TCP 8792. Normal pairing requests, files, chats, and transcripts still use the advertised HTTPS/Tailscale address; this does not add an unencrypted LAN data plane or remove the Tailscale requirement. The current Android target is SDK 36; future target-SDK upgrades must revisit Android's local-network runtime permission requirements.

## Security and limits

- The native listener binds TCP 8792 on wildcard interfaces so mobile VPN loopback forwarding can work. It may also be reachable on the LAN during the pairing window. It exposes only public signed identity/session metadata and accepts signed Hub offers for local confirmation—never files, chats, commands, or credentials.
- HTTP on this bootstrap port is a deliberate exception to the normal HTTPS device protocol. Desktop probes use Tailscale IPv4 peer addresses (100.64.0.0/10) or mDNS-advertised private LAN IPv4 addresses on fixed port 8792. LAN bootstrap metadata is public, not encrypted; signatures and code comparison protect the pairing decision. There is no Tailscale Serve or public Funnel configured on the phone.
- Signatures, short-lived session identifiers, and comparison of the code on both screens bind discovery to the intended devices. A received offer does not grant permissions. Never approve a mismatching code.
- The comparison code uses 64 bits of the signed offer's digest, not a six-digit PIN: offers are public, so short codes would permit practical offline attempts to imitate an observed code.
- Native requests are bounded to 8 KiB headers / 8 KiB bodies, short read deadlines, one handled connection at a time, and 64 requests per window. JavaScript verifies at most 16 received offers and presents the first valid offer. To choose another desktop, reject and start a fresh window.
- Desktop scans are bounded: local scans run while Add device is visible; broad Tailscale phone scans require Find phones. Offers can only target a phone from a recent verified scan, not an arbitrary user-provided URL. Retries within a session retain the same verification code.
- The listener closes after two minutes, cancellation, backgrounding, or module destruction. It starts on entering Pairing, not in Devices or at general app startup. Existing phone identities, chats, grants, files, and transcripts are not reset.

Automated checks cover signature tampering, expired sessions, wrong recipients, revocations, restricted probe addresses, confirmation-code agreement, retry stability, and the existing phone approval flow. Native compilation / APK assembly do not prove that the separate Tailscale Android app forwards inbound connections on your phone; that remains the purpose of this test.
