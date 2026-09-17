# Companion screenshots

In the desktop Hub, open Settings → Shortcuts and assign keys to **Snip image for Companion** and **Capture screen for Companion**. Enable **Global** on each binding to capture while another application is focused. They start unbound to avoid taking existing OS shortcuts.

Both actions target the monitor under the cursor. Snip freezes that screen: drag an area, then choose **Capture selection**, or choose **Capture full screen**. Escape or Cancel discards the capture. The direct screen action skips the selection window.

Images appear as removable previews in Companion and accompany the next text, transcribed voice, or live-voice backend instruction. They are not sent merely by taking the screenshot. A failed or cancelled instruction restores its pending images; resetting Companion clears pending captures. Pending previews are held in memory until submission.

Submitted images are stored under the Hub data directory in `companion/attachments/<session-hash>/capture-*/`. Each image is delivered to the model with its absolute and relative paths. The read-only `companion-attachments` workspace target supports copying originals with `transfer_files` to a selected workspace with Write access. A `send_message` proposal may use `attachmentPaths: ["<absolute capture path>"]`; proposal review displays those paths, and execution attaches the original bytes through the regular chat attachment pipeline. Stored files remain available after a turn or conversation reset.

The existing image policy applies: up to eight images, 6 MB each, 20 MB total. Unsupported capture or missing screen-recording permission produces an error. Platforms that do not expose a matching display ID cannot reliably implement cursor-monitor capture; the action reports this instead of silently capturing a different screen. Browser-only Hub windows cannot use native capture.
