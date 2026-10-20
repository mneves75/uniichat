# ADR 0001 — the iOS app stays a shell, and what that decides

**Status:** accepted (2026-10-19). **Context:** `ios/` is a 243-line SwiftUI app
around one `WKWebView` (`ios/App/Unii.swift`): it loads the site, keeps the
session for requests and the share extension, asks for push and hands the
token to the server, sells credit through StoreKit, and opens the mic and the
export's download. Everything else is the web app.

## Decision

Keep it a shell. It buys the things a web page cannot: notifications when the
app is closed, the share extension, App Store billing (the only payment Apple
accepts in an app), dictation, and an icon on the home screen. It does not
duplicate the chat.

## What follows, and what to watch

- **The web app is the product, per platform.** A change to the chat's layout
  reaches iOS the moment the site does; there is no second renderer to keep
  in step. This is a deliberate saving, and it is why the site's pass matters
  more than native polish.
- **App Store review risk (guideline 4.2, minimum functionality).** The shell
  must keep doing something the web cannot. Today that is push + StoreKit +
  share. If any of those is removed, the risk becomes real and this ADR should
  be revisited rather than argued at review time.
- **No offline chat.** A webview with no network shows the last DOM it had and
  nothing else. "Offline read of the last view" is the one native feature
  worth adding if it is ever asked for: it means caching the rendered log, not
  reimplementing the memory.
- **The terminal (`unii`) is the second client, not iOS.** Both read the same
  server; neither is the reference implementation. `View.ts` is.

## Rejected

- **Rewrite the app in SwiftUI against the server's WebSocket.** It doubles
  the renderers (`View.ts` → HTML, ANSI, and SwiftUI) and triples the surface
  a message kind must be drawn on. Not worth it while the site is the product.
- **Ship only a PWA.** Loses push on iOS, the share target, and billing.
