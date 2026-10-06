# Pet Actions Plan

Status: approved-for-Windows-implementation; host compatibility claims remain gated on named runtime evidence.
Base: `codex/palette-input-sources` at `9d0f062`.
Scope: explicit desktop-pet actions for selected text: Structure, Optimize, and a disabled Image Recognition placeholder. This plan supersedes the pet-trigger interaction direction in earlier planning; frozen specifications and reports remain historical and unchanged.

## Product goal

Let a user deliberately invoke text structuring or prompt optimization from the desktop pet. An operation can begin only after clicking one of the two enabled buttons under the pet. If the app can prove a fresh, non-empty selection, it may proceed after that click. If it cannot prove selection semantics but the click caused a fresh, non-empty clipboard text value, it shows a short unverified preview; clicking the same action button again confirms that text for model processing. If no fresh clipboard text was produced, the action stops without a model call. The result is offered through the app's existing preview/copy path; it is also written to the system clipboard only when clipboard ownership has not changed since capture. The user decides where and when to paste it. No automatic replacement, insertion, or paste occurs.

The experience is an explicit capture-and-copy tool, not an automatic selection watcher. No model call may happen on selection, hover, pet movement, recording, ordinary clipboard changes, or a failed/ambiguous capture.

## Pet controls and states

The controls sit directly below the pet/status area in one row of three equal-width buttons. Their order and labels are:

| Position | Label | v3 behavior |
|---|---|---|
| 1 | 结构化 | Enabled; capture, validate, structure, copy result |
| 2 | 优化 | Enabled; capture, validate, optimize, copy result |
| 3 | 识图 | Disabled placeholder; no capture, model, or clipboard effects; reserved for a later part |

All three buttons have stable equal widths and remain below the pet. While Structure or Optimize is running, its own button is visibly highlighted and the other processing action is disabled to prevent concurrent captures. The Image Recognition placeholder remains disabled. The active state returns to idle after success or failure. Capture, model request, and clipboard-write failures use a concise visible error state; selection uncertainty must use a distinct short hint, not a model error.

The existing bubble/status area displays the short unverified capture preview and confirmation hint. The same action button is the confirmation control; switching modes, expiration, or clipboard change cancels the pending preview. On success, the existing preview/copy path retains the output even if a user clipboard change prevents clipboard write-back. Remove/disable the old automatic floating palette entry points as described below.

## Capture and processing sequence

1. User clicks Structure or Optimize. This is the sole entry point for the new text workflow.
2. The app records the foreground target and current clipboard ownership/version, then identifies the host. It must not infer host behavior from a shell executable name.
3. On ordinary non-terminal text hosts, request copy with Windows Ctrl+C. On Windows Terminal and conhost, use the documented host-specific chord only when the app can establish that it is safe; otherwise do not inject a key and ask the user to copy manually. VS Code integrated terminal and unknown terminals use manual copy.
4. Read clipboard immediately after the explicit capture request. A value is fresh only if the clipboard changed as a result of this request and contains non-empty text. Fresh clipboard text proves a new copy event, not that a real selection existed. Clipboard content by itself, prior clipboard text, and a copy chord with no clipboard change are never sufficient.
5. If a host API/native probe proves the fresh text corresponds to a current, non-empty selection, invoke the chosen model operation. Otherwise show the fresh text in the short capture preview, label selection as unverified, and wait for the same mode button to be clicked again. The user can inspect the text before this confirmation.
6. Cancel a pending preview on timeout, mode change, clipboard ownership/value change, target change, or voice recording/transcription. A canceled, stale, or empty capture makes no model call. An unverified but fresh non-empty capture proceeds only after the required same-button confirmation.
7. Invoke the model only with the authorized captured text. On model failure, leave the copied source text in the clipboard; do not restore arbitrary prior rich clipboard formats.
8. On a successful non-empty result, check clipboard ownership/version against the captured source. If it is unchanged and still owned by this operation, write the result to clipboard. If the user or another app has changed clipboard, do not overwrite it; retain the result in the existing app preview/copy path for explicit user copy. Never synthesize paste, change the source selection, or insert into a cursor.

### Resolved decision: selection proof and confirmation

DEC-001 is resolved by the user's choice of a two-path policy. Positive host/control evidence for a fresh, non-empty selection permits one-click processing. Otherwise, only a fresh non-empty clipboard text change caused by the explicit button click may be shown in an unverified preview, and a second click on the same action button is required before the model call. The UI must not describe this as a proven selection. The preview gives the user a chance to reject stale-looking or fallback text. A pre-existing clipboard value, equal-value copy without independently proven selection, empty result, or ambiguous ownership does not open a confirmation path.

This explicit second confirmation is the user's authorization to process the displayed captured text when the app cannot establish selection semantics. It does not upgrade clipboard evidence into proof that a selection existed. For known terminal hazards, avoid injecting the copy chord when safe selection cannot be independently established; let the user copy manually and confirm only a fresh clipboard change.

## Host behavior and key matrix

The host/application owns copy semantics. The app must identify the actual host window/control with a reliable capability or an explicit, user-selected host profile. It must not pick a shortcut based on `cmd.exe`, PowerShell, bash, zsh, or another shell process name. Unknown host identity or unknown custom key bindings are unsupported for one-click capture.

| Host | Candidate copy chord | Documented no-selection concern | v3 boundary |
|---|---|---|---|
| Ordinary non-terminal text host, including webpages and IDE editors | Windows Ctrl+C | Host can copy a whole line or other fallback when no selection exists; web/IDE custom controls vary | Request Ctrl+C after an action click. Proven selection is one-click; otherwise require fresh clipboard change plus same-button preview confirmation. Each host/control remains unclaimed until tested. |
| Windows Terminal | Ctrl+Shift+C | With no selection, chord is sent directly to terminal | Use only after host identity. If selection cannot be confirmed safely, do not inject the chord; ask for manual copy, then require fresh clipboard preview confirmation. |
| Classic Windows Console / conhost | Ctrl+Insert | Ctrl+C with no selection sends BREAK; Ctrl+Insert is the documented copy key | Use Ctrl+Insert only after host identity and a capture policy can establish safety. Otherwise ask for manual copy and require fresh clipboard preview confirmation. |
| VS Code integrated terminal | Candidate defaults: Windows Ctrl+C; Linux Ctrl+Shift+C; macOS Cmd+C | Configurable bindings, terminal focus/mouse modes; Ctrl+C may act as interrupt | Windows initial candidate uses manual copy to avoid interrupt ambiguity. Other platforms remain untested. |
| GNOME Terminal | Ctrl+Shift+C | Ctrl+C is not the copy command | Architecture candidate only; no Linux compatibility claim before real tests. |
| Konsole | Ctrl+Shift+C | Key bindings may be configured | Architecture candidate only; verify official binding/version and runtime before claim. |
| macOS Terminal | Cmd+C | Host-specific; app settings/selection behavior can vary | Architecture candidate only; requires real macOS validation. |
| Unknown/custom terminal | None | Key bindings and no-selection behavior vary | Manual copy only; require fresh preview confirmation; no guessed chord. |

References are official vendor documentation, checked for this plan:

- [Windows Terminal actions](https://learn.microsoft.com/en-us/windows/terminal/customize-settings/actions): copy action defaults include Ctrl+C, Ctrl+Shift+C, and Ctrl+Insert; with no selection, the key chord is sent to the terminal.
- [Windows Console changes](https://learn.microsoft.com/en-us/windows-server/administration/windows-console-changes): Ctrl+C without selection sends BREAK; Ctrl+Insert copies selected text.
- [VS Code terminal basics](https://code.visualstudio.com/docs/terminal/basics): terminal copy/paste keys differ by platform; selection-copy and mouse behavior are configurable; no selected editor text for Run Selected Text runs the current line.
- [VS Code default keybindings](https://code.visualstudio.com/docs/reference/default-keybindings): default bindings are discoverable/configurable and are not a universal immutable contract.
- [GNOME Terminal copy and paste](https://help.gnome.org/gnome-terminal/txt-copy-paste.html): copy uses Shift+Ctrl+C and Ctrl+C is not its copy shortcut.
- [Apple Terminal keyboard shortcuts](https://support.apple.com/en-ng/guide/terminal/trmlshtcts): copy uses Command+C; Command-period sends Control-C to the command line.

These references establish documented defaults and hazards, not compatibility in every version, custom keymap, shell, remote session, or accessibility configuration. The Windows Console page distinguishes the classic console host; its behavior must not be generalized to Windows Terminal. The listed host matrix is a discovery and validation target, not an implementation claim.

## Migration and trigger isolation

- On entering the new pet-action mode, old users with `config.paletteEnabled=true` must no longer get the old global selection drag/double-click palette. Migration must explicitly disable the old automatic trigger regardless of this persisted value; it must not leave the old listener active behind a new UI toggle.
- Retain the mouse side-button recording hook and its existing enable/disable configuration. Migration of palette behavior must not unregister or repurpose that hook.
- Remove/disable old selection watchers and automatic floating-palette presentation for the active app path. Do not emit a legacy action as a fallback if new capture fails.
- Keep pet recording gestures on the pet body/stage only. Button clicks must not start/stop recording. Pet dragging, click-to-settings, right-click behavior, and scroll scaling must not be triggered by button events; conversely pet drag/record gestures must never click an action button.
- While recording or transcribing voice, text-action buttons are disabled or ignored with no capture/model/clipboard side effects. A text action must not mutate audio state, and voice submission must retain its current explicit gesture/hotkey semantics.
- Preserve global hotkey and mouse side-button recording routes unless a separate requirement changes them. Verify all config upgrade/default paths, including legacy configs missing the new mode fields.

## Permissions, focus, and clipboard risks

- Capture requires a platform/host capability to identify the foreground target, request its copy action, and read clipboard state. macOS may require Accessibility permissions for cross-app identity/selection probes. Windows integrity level, remote desktop, secure desktop, protected controls, Linux AT-SPI availability, Wayland boundaries, and compositor policy can prevent reliable capture.
- The action window must avoid stealing target keyboard focus before the host copy chord is dispatched. If the pet button click necessarily foregrounds the pet, the capture adapter must restore/target the originating host safely or fail closed. Do not guess which app now owns focus.
- Sending a copy chord can have effects beyond copying. Treat host-specific no-selection hazards as correctness and data-integrity risks. Unsupported/uncertain hosts must not receive a chord.
- Clipboard read/write is user data access. Keep captured text in memory only for the active operation; do not log raw content, clipboard text, or model request bodies. Do not poll clipboard continuously. Never send the pre-existing clipboard value to the model.
- Copying source text after an explicit action click is an intentional clipboard change. Do not promise lossless restoration of arbitrary prior clipboard formats. On model failure, the newly copied source text remains on clipboard.
- Before writing model output, compare clipboard ownership/version and captured text identity with the state established by this operation. If a user or another app copied something after capture, do not overwrite it; retain the model result in the existing app preview/copy path for explicit copy. This ownership guard is a correctness requirement and must be race-tested.
- API/model failure, empty result, timeout, cancellation, stale target, lost focus, permission denial, clipboard read/write failure, and a user clipboard change must all fail without unintended paste or source mutation.

## Platform scope

Windows is the first implementation and validation platform. The Windows target still requires per-host evidence and tests; it is not a blanket claim for desktop apps or all terminals. macOS and Linux are architectural targets only because no test environments are available in this project. macOS Terminal and Linux GNOME/Konsole key references do not establish selection-capture support. Browser pages, IDE editors/chat, web apps, office documents, remote sessions, and arbitrary terminal hosts are not claimed supported by this pet-action part.

## Staged work and commits

Each implementation stage is a separate commit, with an independent review before advancing. Do not rewrite historical specs or reports.

| Stage | Work | Exit evidence |
|---|---|---|
| P0: Decide capture authorization | Select strict-evidence plus same-button preview confirmation; define intentional source-copy behavior, guarded result clipboard write, and initial Windows host policies | Decisions recorded in approval evidence; P0 complete; support remains limited to individually tested hosts |
| P1: Pet controls and migration | Add equal-width three-button row, active/error states, disable image placeholder, isolate pointer handlers, disable old palette activation for existing/new configs while preserving side-button recording | UI state review; migration tests prove `paletteEnabled=true` cannot trigger old UI and side-button hook remains registered |
| P2: Host identification and capture contract | Add explicit host policies and typed capture result with host identity, text, positive-selection evidence or fresh-copy marker, confirmation token, expiry/cancellation, and no-content diagnostics | Unit/fixture coverage for stale/equal/empty clipboard, fallback line preview, timeout, mode/clipboard/target changes, denied terminal chords and valid capture; denied cases make zero model calls |
| P3: Structure and Optimize actions | Connect buttons to existing transformation pipeline after one-click evidence or same-button preview confirmation; guarded clipboard write with app preview fallback | Both actions produce correct mode output; model effects asserted; source mutation/paste absent; user clipboard changes are preserved and result remains explicitly copyable |
| P4: Windows host validation | Validate native text control, ordinary browser/IDE text controls, Windows Terminal, conhost, and VS Code integrated terminal according to their distinct policies | Named Windows/app versions, positive/negative and fallback runs, clipboard/focus/target integrity evidence; only passing host/control pairs may be claimed supported |
| P5: Independent review and clean-context run | Review interaction, migration, security/privacy, host matrix, and install/runtime behavior from a fresh context | No unresolved high-severity findings; clean install/run evidence matches claims; each unit delivered in its own commit |
| P6: macOS/Linux feasibility | On real machines, implement/reject host adapters and permission paths separately | Platform-specific evidence before any support claim; no inferred support from Windows or documentation |

P0 decisions are resolved and Windows implementation is authorized by the user. Host support is still not granted by this authorization: only named host/control pairs that pass the implementation validation matrix may be documented as supported. Unit tests and host fixtures belong to the implementation stage; this document update does not change production code.

## Acceptance matrix

| Scenario | Expected result |
|---|---|
| Click Structure with a proven fresh non-empty selection | Exactly one structure-model operation; output copied only if clipboard ownership remains unchanged; otherwise output remains in app preview/copy path; no paste or source replacement |
| Click Optimize with a proven fresh non-empty selection | Exactly one optimize-model operation; output copied only if clipboard ownership remains unchanged; otherwise output remains in app preview/copy path; no paste or source replacement |
| Ordinary Windows text host copies non-empty text but selection cannot be proven | Short preview labels selection unverified; no model call until same Structure/Optimize button is clicked again |
| Pending preview expires, user changes clipboard, changes mode, changes target, or voice starts | Pending authorization is canceled; no model call |
| Model fails after source text was copied | Source text from this explicit capture remains on clipboard; no attempt to restore arbitrary previous clipboard formats |
| User copies another value while model is running | Do not overwrite that newer clipboard value; retain model result in existing app preview/copy path |
| Hover, selection change, clipboard change, pet movement, voice recording, or app launch without action click | No copy chord, capture request, or model call |
| Empty selection, stale clipboard, equal-to-clipboard text without independent selection evidence, inaccessible control, unknown host, or failed identity | No model call; no success message; short uncertainty/unsupported hint |
| VS Code editor Ctrl+C yields a fallback line without a provable selection | Show only as fresh, unverified preview; require second click; never silently treat it as a proven selection |
| Windows Terminal selection cannot be safely confirmed | Do not inject Ctrl+Shift+C; ask user to copy manually, then require fresh clipboard preview and second click |
| conhost selection cannot be safely confirmed | Do not inject Ctrl+C; only use Ctrl+Insert when adapter can safely confirm; else manual copy and fresh preview confirmation |
| VS Code integrated terminal or unknown terminal | Manual copy only on Windows v1; require fresh preview confirmation unless a named adapter proves selection |
| GNOME Terminal, Konsole, macOS Terminal | Candidate keys are architecture notes only; no support claim before real platform tests |
| Model error, timeout, cancellation, or empty output | No output clipboard write and no source mutation; error is visible; active highlight clears |
| Clipboard write denied or clipboard changes during operation | Do not overwrite newer user data; keep successful result in the existing app preview/copy path and report clipboard copy was unavailable |
| Image Recognition clicked/keyboard activated | Remains disabled and has no effects |
| Voice active while an action button is clicked | No text capture/model/clipboard effects; voice flow remains intact |
| Old configuration contains `paletteEnabled=true` | Old drag/double-click selection palette does not appear; side-button recording hook remains available according to existing config |
| Pet body drag/record/click/scroll and action-button clicks | Each gesture affects only its intended control; no cross-trigger |

## Decisions and deferred scope

- DEC-001 resolved: one-click processing requires positive selection evidence; otherwise fresh non-empty copied text requires an unverified short preview and a second click on the same mode button. User choice recorded in the approval ledger.
- DEC-002 resolved: explicit source capture intentionally changes clipboard; model failure leaves that source text there. Do not promise arbitrary rich-format restoration. Before result write-back, detect clipboard ownership/change; preserve newer user clipboard content and keep the result in the app preview/copy path.
- DEC-003 resolved for implementation policy, not support claims: Windows v1 candidates are ordinary non-terminal text hosts (including webpages/IDE editors) using Ctrl+C then proof-or-preview, Windows Terminal and conhost using host-specific keys only when safe else manual copy, and VS Code integrated/unknown terminals manual-copy first. Each exact host/control requires runtime tests before it is declared supported.
- Deferred: macOS/Linux are architecture targets with candidate chords only; no compatibility claims without real platform validation. Browser/IDE adapters beyond the specified ordinary text capture workflow and image recognition behavior remain future scope.
