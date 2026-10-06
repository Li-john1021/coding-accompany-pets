# Pet Actions Plan

Status: product plan, v3; implementation is not authorized until the blocking selection-capture decision is resolved.
Base: `codex/palette-input-sources` at `9d0f062`.
Scope: explicit desktop-pet actions for selected text: Structure, Optimize, and a disabled Image Recognition placeholder. This plan supersedes the pet-trigger interaction direction in earlier planning; frozen specifications and reports remain historical and unchanged.

## Product goal

Let a user deliberately invoke text structuring or prompt optimization from the desktop pet. An operation can begin only after clicking one of the two enabled buttons under the pet. The click requests capture of the current non-empty text selection, validates that the capture is trustworthy, and only then invokes the configured text model. The result is written to the system clipboard; the user decides where and when to paste it. No automatic replacement, insertion, or paste occurs.

The experience is an explicit capture-and-copy tool, not an automatic selection watcher. No model call may happen on selection, hover, pet movement, recording, ordinary clipboard changes, or a failed/ambiguous capture.

## Pet controls and states

The controls sit directly below the pet/status area in one row of three equal-width buttons. Their order and labels are:

| Position | Label | v3 behavior |
|---|---|---|
| 1 | 结构化 | Enabled; capture, validate, structure, copy result |
| 2 | 优化 | Enabled; capture, validate, optimize, copy result |
| 3 | 识图 | Disabled placeholder; no capture, model, or clipboard effects; reserved for a later part |

All three buttons have stable equal widths and remain below the pet. While Structure or Optimize is running, its own button is visibly highlighted and the other processing action is disabled to prevent concurrent captures. The Image Recognition placeholder remains disabled. The active state returns to idle after success or failure. Capture, model request, and clipboard-write failures use a concise visible error state; selection uncertainty must use a distinct short hint, not a model error.

The existing bottom status area may display short operation state and outcome, but it must not become an automatic action trigger. Remove/disable the old automatic floating palette entry points as described below. Result previews or long text bubbles are not required; the output resides in clipboard for user-directed paste.

## Capture and processing sequence

1. User clicks Structure or Optimize. This is the sole entry point for the new text workflow.
2. The app identifies the foreground host and classifies it as a supported ordinary editor or a named terminal host. It selects that host's documented copy chord; it must not infer behavior from a shell executable name.
3. The app obtains a fresh non-empty selection snapshot and evidence that it came from an actual selection. Clipboard content alone is not proof of a selection. A clipboard value can be stale, and some hosts copy a line when no text is selected.
4. If target type, host behavior, selected text, or selection evidence is missing or ambiguous, do not call the model. Show a concise hint and stop. Do not proceed from a prior clipboard value.
5. Only after confirmed capture, call the selected model operation with the captured text. Do not include unrelated clipboard contents or other host text.
6. On a successful non-empty result, write the result to clipboard and report that it is ready to paste. Do not synthesize paste, change the target selection, or insert into a cursor.
7. On capture/model/clipboard failure, report failure and do not claim success. A failed model request must not overwrite clipboard. Clipboard snapshot/restore behavior must be explicitly designed and tested before implementation; restoring can race with user clipboard changes and is not assumed safe by default.

### Blocking product decision: proving selection exists

The capture chord is a request to the host, not proof that selected text was copied. Clipboard-before/after equality cannot establish that a selection exists: the selection may equal prior clipboard data, a clipboard manager may intervene, and a host may copy a line or another fallback. In particular, VS Code editor `Ctrl+C` can copy the current line when no selection exists, and Windows Terminal may forward a no-selection copy key into its terminal input. A non-empty clipboard therefore cannot authorize model invocation.

Before implementation, choose one capture policy:

- **Strict evidence gate:** invoke the model only when a supported host API or native control probe proves a current, non-empty selection and ties the captured text to it. Unknown or unsupported hosts stop with a short hint. This gives one-click processing only on individually verified hosts.
- **User-confirmed capture preview:** when the app can capture text but cannot prove selection semantics, show a preview marked as unverified and require an explicit confirmation before model invocation. The preview must make clear that the text may be stale or host-fallback content. This adds a second action and still cannot label clipboard contents as a proven selection.

This choice blocks the full spec from approval and implementation. Do not silently treat copy success, non-empty clipboard, changed clipboard, or a terminal name as reliable selection evidence. Until the decision is recorded, only the already agreed UI and fail-closed boundary are settled.

## Host behavior and key matrix

The host/application owns copy semantics. The app must identify the actual host window/control with a reliable capability or an explicit, user-selected host profile. It must not pick a shortcut based on `cmd.exe`, PowerShell, bash, zsh, or another shell process name. Unknown host identity or unknown custom key bindings are unsupported for one-click capture.

| Host | Candidate copy chord | Documented no-selection concern | v3 boundary |
|---|---|---|---|
| Ordinary non-terminal app | Windows/Linux: Ctrl+C; macOS: Cmd+C | App-specific behavior; copy may leave clipboard unchanged or act on another UI concept | Only supported when a reliable selection source/evidence is available; ordinary app classification alone is insufficient |
| Windows Terminal | Ctrl+Shift+C (Ctrl+C and Ctrl+Insert are also configurable defaults) | If no selection exists, key chord is sent directly to terminal | Must use host-specific chord only after positive Windows Terminal identity; no model call from clipboard alone |
| Classic Windows Console / conhost | Ctrl+Insert | Ctrl+C with no selection sends BREAK; with selection, first Ctrl+C copies and clears selection, second sends BREAK | Prefer Ctrl+Insert; verify host and selection without relying on clipboard alone |
| VS Code integrated terminal | Windows Ctrl+C; Linux Ctrl+Shift+C; macOS Cmd+C | Copy behavior follows platform standards; terminal focus/mouse modes and custom keybindings affect behavior | Identify VS Code terminal host, not shell; validate active terminal and a non-empty selected range or use the blocking preview policy |
| GNOME Terminal | Ctrl+Shift+C | Ctrl+C is not the copy command | Host-specific adapter/profile; not claimed implemented or tested |
| Konsole | Ctrl+Shift+C | Key bindings may be configured | Candidate only; official source and tested version must be recorded before claiming support |
| macOS Terminal | Cmd+C | Host-specific; app settings/selection behavior can vary | Candidate only; requires real macOS verification and accessibility/selection evidence |
| Unknown/custom terminal | None | Key bindings and no-selection behavior vary | Unsupported; do not send a guessed chord or call the model |

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
- Output is the only intended clipboard write. Before overwriting, determine whether to preserve prior clipboard contents and which formats are supported; compare ownership before restoration so the app does not erase a newer user copy. This policy is unresolved until designed and tested.
- API/model failure, empty result, timeout, cancellation, stale target, lost focus, permission denial, clipboard read/write failure, and a user clipboard change must all fail without unintended paste or source mutation.

## Platform scope

Windows is the first implementation and validation platform. The Windows target still requires per-host evidence and tests; it is not a blanket claim for desktop apps or all terminals. macOS and Linux are architectural targets only because no test environments are available in this project. macOS Terminal and Linux GNOME/Konsole key references do not establish selection-capture support. Browser pages, IDE editors/chat, web apps, office documents, remote sessions, and arbitrary terminal hosts are not claimed supported by this pet-action part.

## Staged work and commits

Each implementation stage is a separate commit, with an independent review before advancing. Do not rewrite historical specs or reports.

| Stage | Work | Exit evidence |
|---|---|---|
| P0: Decide capture authorization | Select strict-evidence or user-confirmed preview policy; define clipboard replacement/restoration semantics and supported initial Windows host/control pairs | Decisions recorded; blocking items below resolved; spec status may then move from blocked to approved |
| P1: Pet controls and migration | Add equal-width three-button row, active/error states, disable image placeholder, isolate pointer handlers, disable old palette activation for existing/new configs while preserving side-button recording | UI state review; migration tests prove `paletteEnabled=true` cannot trigger old UI and side-button hook remains registered |
| P2: Host identification and capture contract | Add explicit host adapters and typed capture result with host identity, non-empty text, evidence, freshness, cancellation, and no-content diagnostics | Unit/fixture coverage for missing, stale, mismatched, empty, unsupported and valid capture; no model request in denied cases |
| P3: Structure and Optimize actions | Connect buttons to existing transformation pipeline only after capture authorization; return result to clipboard with guarded ownership behavior | Both actions produce correct mode output; model call counts/effects asserted; no paste or source replacement |
| P4: Windows host validation | Validate ordinary native editor, Windows Terminal, conhost, and VS Code integrated terminal individually where capability is available | Named Windows/app versions, repeated positive and no-selection runs, clipboard/focus/target integrity evidence; unsupported rows explicitly denied |
| P5: Independent review and clean-context run | Review interaction, migration, security/privacy, host matrix, and install/runtime behavior from a fresh context | No unresolved high-severity findings; clean install/run evidence matches claims; each unit delivered in its own commit |
| P6: macOS/Linux feasibility | On real machines, implement/reject host adapters and permission paths separately | Platform-specific evidence before any support claim; no inferred support from Windows or documentation |

Do not begin P1 implementation until P0 resolves the blocking capture and clipboard decisions. Unit tests and host fixtures belong to the implementation stage; the current documentation task does not authorize production edits or test changes.

## Acceptance matrix

| Scenario | Expected result |
|---|---|
| Click Structure with supported, positively confirmed non-empty selection | Exactly one structure-model operation; successful output copied; no paste or source replacement; Structure highlighted while running |
| Click Optimize with supported, positively confirmed non-empty selection | Exactly one optimize-model operation; successful output copied; no paste or source replacement; Optimize highlighted while running |
| Hover, selection change, clipboard change, pet movement, voice recording, or app launch without action click | No copy chord, capture request, or model call |
| Empty selection, stale clipboard, equal-to-clipboard selection, inaccessible control, unknown host, failed identity, or uncertain selection | No model call; no success message; short uncertainty/unsupported hint |
| VS Code editor no-selection fallback would copy current line | Reject unless chosen preview policy explicitly obtains user confirmation; never silently call model as though it were a selection |
| Windows Terminal has no selection | Do not send Ctrl+Shift+C because the host forwards the key chord to terminal input; fail closed or request decision-approved preview path |
| conhost has no selection | Do not send Ctrl+C; use Ctrl+Insert only with host-specific capture authorization; otherwise fail closed |
| GNOME Terminal, Konsole, macOS Terminal | Use documented host chord only after host identity and capture policy pass; remain unclaimed until tested on that platform |
| Model error, timeout, cancellation, or empty output | No output clipboard write and no source mutation; error is visible; active highlight clears |
| Clipboard write denied or clipboard changes during operation | Do not report copied; do not overwrite newer user data; surface failure |
| Image Recognition clicked/keyboard activated | Remains disabled and has no effects |
| Voice active while an action button is clicked | No text capture/model/clipboard effects; voice flow remains intact |
| Old configuration contains `paletteEnabled=true` | Old drag/double-click selection palette does not appear; side-button recording hook remains available according to existing config |
| Pet body drag/record/click/scroll and action-button clicks | Each gesture affects only its intended control; no cross-trigger |

## Open decisions

1. Blocking: choose strict evidence gate or user-confirmed unverified capture preview for hosts without reliable selection APIs.
2. Blocking: specify clipboard replacement policy, including whether/how prior clipboard content and rich formats may be restored without clobbering later user changes.
3. Blocking for support claims: name the initial Windows host/control adapters and the evidence each can provide. The host matrix above is not approval of support.
4. Deferred: whether a future browser/IDE adapter or image recognition part should be included in subsequent work.
