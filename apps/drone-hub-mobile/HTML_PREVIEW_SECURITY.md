# Rendered HTML preview security

Rendered HTML previews are for static visual inspection of untrusted files. They are not a browser
or an application runtime.

The mobile preview uses these deliberate restrictions:

- User markup runs in a dedicated, ephemeral native WebView.
- JavaScript is disabled in the WebView and denied again by Content Security Policy.
- External subresources, connections, forms, objects, workers, popups, downloads, and navigation
  outside the preview document are blocked.
- File URL access, DOM storage, cookies, caching, geolocation, media capture, payment APIs, and
  automatic media playback are disabled.
- External links are not opened from rendered previews. To inspect a URL, switch to Source mode.
- Inline CSS and embedded `data:`/`blob:` images, fonts, and media are allowed so self-contained
  static reports can render. Remote assets and JavaScript-driven pages will therefore look
  incomplete.

`originWhitelist` is intentionally broad because `react-native-webview` otherwise sends rejected
origins to React Native's external-link handler. The preview's own navigation callback then permits
only its reserved `.invalid` document URL, same-document fragments, and the WebView's inert
`about:blank` bootstrap page.

User markup intentionally stays in the top WebView document. Android does not report inner-frame
navigation to the React Native navigation callback, so a nested `srcdoc` sandbox would leave an
external-navigation gap. Top-document requests are denied by the navigation callback, with
`onLoadStart` stopping any denied request that still begins.

Android is the app's current native target. The renderer also uses supported iOS WebView controls,
but any other platform receives a clear Source-only fallback. If the native render process fails,
the modal remains open and Source mode stays available.
