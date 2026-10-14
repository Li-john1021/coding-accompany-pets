# Palette Input Sources Plan

Status: product and architecture plan, v2; implementation is not authorized by this document.
Base: `codex/palette-input-sources` at `5f11cd1` (`codex/palette-trigger-fix`); the v1 plan/spec and its reports are historical artifacts and remain unchanged.

## Product goal and audience

Make Voice2Prompt useful wherever engineers and product practitioners compose, select, or collect text: terminals and coding harnesses, browser-based AI conversations, IDEs, office/document editors, and everyday text fields. Preserve the v1 safety rule: a passive trigger may act only on positively identified, user-selected editable text, without changing clipboard, focus, or selection. Where a host cannot provide trustworthy evidence, offer an explicit host-native command or remain unsupported; do not infer a universal desktop selection API.

Primary audience: engineers using shell/terminal agents, editors, IDE chat and browser AI products; product, design, operations, and research practitioners using web forms, documents, and reference material. Windows is the first implementation and validation platform. macOS/Linux are architectural targets, not currently validated platforms.

## Scenario priority matrix

Priority means product exploration order, not a promise of automatic support. Automatic eligibility always requires host-specific positive evidence and revalidation before write-back.

| Source / workflow | Examples | Preferred activation | Initial priority | Notes / boundary |
|---|---|---|---|---|
| Terminal: selected text as input | User highlights a prompt, error, command, or agent output | Explicit shortcut or terminal/harness command; optional auto trigger only after the terminal decision below | P0 discovery, P1 implementation candidate | Terminal buffers and selections vary; terminal output is not automatically an editable input. |
| Terminal: harness response/output | Claude Code, Codex CLI, Aider, shell output, logs | Explicit command / explicit selection action | P0 discovery | Do not watch or ingest terminal output continuously. Keep prompt input separate from response history. |
| Terminal: prompt being composed | Shell command line, REPL input, TUI chat composer | Harness integration or explicit hotkey; no global auto-trigger in first release | P0 discovery, decision pending | A shell's visible prompt may be a TUI, readline buffer, or remote session; screen text does not prove the actual input buffer. |
| Browser textarea / input | ChatGPT, Claude, Gemini, web issue forms | Browser extension action on user gesture; auto selection trigger only for positively identified editable DOM control | P1 | Content scripts can inspect page DOM under granted host permissions. Site-specific custom widgets and restricted pages may not be available. |
| Browser contenteditable / rich chat composer | AI chat composer, rich-text field | Browser extension command; optional contextual UI after explicit selection | P1 | DOM selection/range must be mapped to an editable host and checked for current value before insertion. No access to read-only conversation history. |
| IDE code editor | VS Code, JetBrains, Visual Studio editor | IDE command / context action; selection-aware command | P1 | Prefer official extension/editor API to OS probing. Preserve editor URI, selection range, and document version for write-back validation. |
| IDE integrated chat box | Copilot Chat, IDE agent panes, vendor chat extensions | Extension-specific API if published; otherwise explicit copy/command handoff | P2 | Do not assume editor selection APIs expose private chat view input controls or history. |
| IDE integrated terminal | VS Code terminal and comparable embedded terminals | Explicit terminal selection command or host extension | P1 discovery | Same distinction as standalone terminals: visible output versus live editable prompt. |
| Documents and reference reading | Word/Docs, PDF, browser articles, tickets, specs | Explicit “send selected text” command or supported add-in/extension | P2 | Read-only text is source material, not an editable write-back target. Never trigger from selecting arbitrary page/document content by default. |
| General editable text fields | Native apps, email, notes, forms | Host/platform adapter where positively supported; explicit hotkey fallback | P1 | Initial Windows support remains capability-based and limited to tested controls. |

## Automatic versus explicit trigger policy

Automatic trigger is appropriate only when the adapter can establish all of the following without side effects: the user selected text; the source is an editable input target; the selection belongs to that target; it is not a read-only transcript/output; and the target plus selection can be revalidated before any write-back. Automatic mode is opt-in per source family, off for uncertain integrations, and fails closed on missing permission, inaccessible UI, stale identity, provider errors, or unsupported surfaces.

Explicit activation is the default for terminal input, harness output, IDE chat boxes, read-only documents, and general reference material. “Explicit” means a dedicated hotkey, context menu, IDE/browser extension command, or harness command initiated by the user. It must not mean silently scraping recent output. Commands should use a host selection/input API where available; otherwise ask the user to paste or select the text into the app.

### Product decision gate: terminal behavior and companion extensions

Pending user research: acceptance of (a) a global explicit terminal shortcut and (b) installing a browser/IDE companion extension. Do not resolve these choices in implementation or the final Spec. The next approval checkpoint must record the user's preference for each, plus whether auto-trigger in terminal prompts is acceptable. Until then, preserve both as options and keep terminal automation and extension distribution outside the committed release scope.

## Cross-platform architecture proposal

Use a common source contract with distinct adapters. The shared core receives an immutable input snapshot and returns transformed text; a separate target adapter validates and applies it. A proposed snapshot includes source kind, host/app identity, document/control identity, selected text, selection/range identity, revision/version token, capabilities, and an expiry/cancellation token. Avoid storing input text in diagnostics; local processing history, if any, needs a separate user-controlled policy.

1. **Shared core and policy:** source-neutral transformations, explicit/automatic activation policy, minimum length, cancellation, privacy limits, and adapter capability checks. Unknown source kinds are denied for automatic activation.
2. **Browser adapter:** Chromium/Firefox WebExtension content script detects the current editable element and selection on a user selection event or command, then sends a minimal message to its background context. Background communicates with the desktop app through an authenticated, local-only bridge or browser native messaging. Native messaging is more secure and avoids an open localhost listener, but requires installer registration, extension ID/origin allowlisting, and OS-specific packaging. A localhost bridge is an alternative only with loopback binding, per-install secret/nonce, origin checks, strict message schema/size limits, and explicit pairing. This is a design comparison, not a selected implementation.
3. **IDE adapter:** a VS Code extension is the first candidate because its official API exposes active text editor selections and document operations. Commands should run on an explicit command or selection context. The public API describes chat participants and chat history, but does not establish a generic API to read or alter every extension's chat composer. Other IDEs require their own public API and compatibility review; no UI scraping fallback is assumed.
4. **Terminal/harness adapter:** begin with documented harness/plugin/command APIs or an explicit user-invoked bridge. Distinguish prompt buffer, selected terminal text, completed command output, and agent response as separate source kinds. Never infer prompt contents from screen capture. A platform global hotkey can be considered as an explicit fallback after the product decision gate.
5. **Platform adapter:** Windows can retain the current Win32/UIA capability-probe design and add independently tested provider adapters. macOS may use Accessibility APIs such as `kAXSelectedTextAttribute` where the app exposes it and the user grants Accessibility permission; attribute existence does not establish reliable support for every app/control. Linux may use AT-SPI Text selection APIs when exposed. Under Wayland, clients cannot inspect other clients' surfaces through the core protocol, so cross-app automatic selection cannot be promised; compositor-specific portals/extensions or explicit in-app adapters would be needed. X11 is a distinct environment and requires separate permission/security review and tests.
6. **Write-back adapter:** write only into the source that initiated the operation, after rechecking app/window, control/document identity, selection or range, and revision. If host APIs cannot perform guarded replacement, present the result for explicit copy instead of attempting a guessed paste.

## Installation, permissions, and privacy

- Desktop stays local-first. A browser/IDE adapter receives only the selected text and the minimum identity needed for the requested operation; it does not receive page history, full documents, or terminal scrollback by default.
- Browser extension permissions should be optional and narrowly scoped where the platform allows. Prefer user-invoked `activeTab`-style access or per-site grants over broad all-site host access. Explain separately that browser native messaging requires a registered native host and an allowlisted extension identity.
- macOS accessibility access is a sensitive system permission. Request it only when the user enables the platform adapter and explain that inaccessible controls will remain unsupported.
- Linux accessibility bus access and desktop/compositor differences must be documented. Do not claim Wayland-wide cross-window support based on X11 results.
- Keep transport on loopback or native messaging; authenticate the desktop endpoint, validate sender/origin and message schemas, cap payload sizes, and reject replay/stale request IDs. Never expose a LAN listener.
- Do not persist raw selected text in logs, telemetry, debug reports, or adapter crash dumps. Provide a per-source enable/disable switch and a clear way to revoke/uninstall companion integrations.

## Explicit non-goals and unsupported cases

- No universal OS API can be assumed to enumerate and safely read editable selection across all apps and display servers.
- No automatic reading of browser conversation history, IDE chat history, PDFs, document reading selections, terminal scrollback, shell history, or agent output.
- No clipboard copy simulation as a passive probe; no focus stealing or selection mutation to discover text.
- No DOM/renderer scraping of arbitrary IDE chat implementations, terminal screen OCR, or silent terminal buffer inspection.
- No guaranteed write-back for custom editors, elevated/remote controls, inaccessible UI, browser restricted pages, ungranted sites, or hosts without a stable identity/revision API.
- macOS support is unvalidated: there is no macOS test machine in this project. Linux is also unvalidated; Wayland and X11 must be treated as separate targets. Platform APIs cited here establish available interfaces or protocol boundaries, not product-level compatibility.

## Staged delivery and acceptance

| Stage | Work | Exit evidence |
|---|---|---|
| S0: Product decisions | Collect terminal shortcut, terminal auto-trigger, and companion extension acceptance; decide first browser/IDE hosts and target audiences. | Recorded decisions and explicit release boundary; terminal and extension decisions are not silently inferred. |
| S1: Source contract | Define source kinds, immutable snapshot, capability model, expiry/revalidation, privacy behavior, and shared deny-by-default policy. | Contract reviewed; tests cover missing capabilities, stale identity/version, cancellation, and no raw text in logs. |
| S2: Windows native adapter | Retain current tested Win32 Edit path; inventory high-value Windows editable controls and expose per-adapter support status. | Existing supported fixture remains passing; each newly claimed control has positive and negative compatibility evidence; unsupported stays denied. |
| S3: First host adapter | Implement the approved browser or VS Code adapter, based on S0. Keep it explicit by default; use a secure, packaged transport to the desktop app. | Install/uninstall and permission revocation work; selected input only is transmitted; target identity/version is revalidated; history/read-only surfaces are denied. |
| S4: Terminal/harness spike | After S0 approval, prototype one named terminal or harness integration, separating prompt input, selected output, and response text. | User invocation is visible; no scrollback scraping; wrong/stale target is canceled; measured workflow benefit and false-trigger rate meet the thresholds below. |
| S5: Cross-platform feasibility | On actual macOS and Linux test systems, implement/reject platform adapters independently. Test macOS permission paths, Linux AT-SPI and Wayland/X11 separately. | Platform-specific support matrix with machine/OS/app versions and repeatable results; no compatibility claim without a test machine. |
| S6: Independent review and release | Review security/privacy, host API use, packaging, upgrade/revocation, regression to voice/palette, and clean-context install. | Independent review has no unresolved high-severity findings; release notes match the verified support matrix. |

### Proposed measurable acceptance targets

- **False automatic activations:** zero in the agreed negative scenario suite per supported adapter; any ambiguous or failed probe is denied.
- **Source identification:** 100% of accepted cases in the adapter contract tests include a source, target identity, selection/range, and revision token sufficient for revalidation; unsupported hosts never return an “eligible” result.
- **Stale write-back:** zero writes after target, selection, document revision, or request expiry changes in deterministic race tests.
- **Privacy:** zero raw selected-text occurrences in production logs/telemetry and zero transmission of unrelated page/history/scrollback data in transport inspection.
- **Windows validation:** all advertised Windows app/control combinations tested on named OS/app builds, with at least 30 repeated trigger attempts per positive and negative scenario and no misdirected writes.
- **User workflow:** after the first adapter is chosen, compare task completion time and abandonment against manual copy/paste with at least five target users; report results before enabling automatic activation by default.
- **Platform claims:** macOS/Linux pass criteria cannot be considered met until exercised on their respective real systems. CI or protocol documentation alone is not platform validation.

## Primary documentation references

- Chrome content scripts and DOM/message boundaries: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome native messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Mozilla WebExtension content scripts and host permission restrictions: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
- Mozilla native messaging permission, host manifest, and background relay requirements: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
- VS Code extension API, including `TextEditor.selections`, selection change events, chat participant APIs, and terminal APIs: https://code.visualstudio.com/api/references/vscode-api
- Apple `kAXSelectedTextAttribute` requirement on editable text accessibility objects: https://developer.apple.com/documentation/applicationservices/kaxselectedtextattribute
- Apple AppKit `accessibilitySelectedText()`: https://developer.apple.com/documentation/appkit/nsaccessibilityprotocol/accessibilityselectedtext()
- GNOME AT-SPI Text selection methods and selectable-text state: https://gnome.pages.gitlab.gnome.org/gtk/atspi2/iface.Text.html and https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/enum.StateType.html
- Wayland protocol: clients cannot access other clients' surfaces; selection data is mediated through focused clients: https://wayland.freedesktop.org/docs/book/Protocol.html

These references document API/protocol capabilities and restrictions. They do not prove support or stability in every browser, IDE, terminal, compositor, or app.
