# Agent Note: Mobile keyboard layout viewport

Status: implemented

English | [中文](2026-11-16-mobile-keyboard-layout-viewport.zh.md)

## Problem

The Web GUI sizes itself to the layout viewport (`html`, `body`, and `#root` are `height: 100%`) and docks the composer as a sticky seat at the floor of the conversation column. That floor clears an on-screen keyboard only while the browser shrinks the layout viewport for it. Chrome 108 changed Android's default to `resizes-visual`: the visual viewport shrinks while the layout viewport keeps its height, so the composer's draft, its control row, and Send stay behind the keyboard, and the page has no scrollable overflow a pan could reveal them with.

## Decision

`apps/web/index.html` declares `interactive-widget=resizes-content` in the viewport meta. Android Chromium then resizes the layout viewport for the keyboard, so the shell's `height: 100%`, the AppFrame columns, the conversation scrollport, and the composer's sticky floor all end above the keyboard, and every fixed surface (drawer, menus, dialogs) is laid out inside the shortened viewport instead of behind the keyboard.

The keyboard lifts the composer and nothing else. Chat treats a scrollport that changed height while the composer's text field holds focus as a keyboard transition (`ViewportResize` in `use-chat-viewport.ts`): the viewport restores the transcript's acknowledged scroll position, clamped to the shortened range, and `ChatReading.onResize` skips the tail follow it applies to an ordinary layout resize. The shorter port then paints the same content at the same screen offset while the composer's sticky floor moves up. A keyboard keeps changing the port while it stays up (a candidate bar appears or goes), and each of those changes holds as well, until the port returns to its pre-keyboard height or the field loses focus. Content growth is not a keyboard change, so streamed output still follows the tail.

## Alternatives considered

- **A visual-viewport follower in the shell.** The shell would publish `visualViewport.height` and `offsetTop` and fix the app mount to that box while a keyboard is open. Rejected for this change: it moves the mount while WebKit pans the visual viewport, changes the layout height that `sidebar-drawer.e2e.ts` pins for a simulated keyboard, and puts body-portalled overlays in a different frame of reference. It is the only route for WebKit, so the gap recorded below stays open by decision rather than by omission.
- **`interactive-widget=overlays-content` with `env(keyboard-inset-*)`.** Rejected: it opts out of every resize and then requires the composer floor, the transcript padding, and every fixed overlay to subtract the keyboard individually. It is Chromium-only and larger than the behavior it buys.
- **Lifting the composer by a keyboard inset on the unchanged layout height.** Rejected: the seat is sticky inside the scrollport, so it would be painted over transcript rows that no padding reserved room for, and the end of the scrollable range would stay behind the keyboard. Resizing the layout viewport gives the same visible result with the composer's own floor instead of a transform.
- **Following the tail after the keyboard shortens the port.** Rejected: it scrolls the transcript by the keyboard's height, so the text a reader is looking at jumps away the moment they tap the draft. The keyboard changes where the composer sits, not where the reader is.

## Consequences

- On Android Chromium the composer, its draft, and Send end above the keyboard without a page-level pan, and the transcript keeps the screen position it had when the keyboard opened. Rows under the composer stay behind the keyboard until the reader scrolls or new output follows the tail.
- A reader at the tail is no longer re-pinned by the keyboard. Layout resizes that are not keyboard transitions — window, sidebar — still follow the tail for a reader who owns it.
- WebKit — iOS Safari, every iOS browser, and in-app WKWebView — ignores the key and keeps the reported defect: the visual viewport shrinks, Safari pans to the caret, and the composer can sit partly or wholly behind the keyboard. The visual-viewport follower above is the route to close that gap.
- The declaration governs the whole document, so a keyboard-opened drawer, menu, or dialog is measured against the shortened viewport. A surface that deliberately keeps part of itself below the keyboard can no longer rely on the layout viewport staying tall.
- Verification needs a real Android device, because the key is a browser contract and no headless engine raises a virtual keyboard. `mobile-keyboard.e2e.ts` pins both halves at 390×508: the composer card stays fully inside the shortened viewport with no page overflow, and a seeded transcript row keeps its screen offset and scroll position across the shrink, while the same shrink without composer focus still lands a following reader at the tail. `pwa-manifest.e2e.ts` pins the shipped declaration.
