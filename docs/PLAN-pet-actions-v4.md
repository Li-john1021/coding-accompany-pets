# Pet Actions v4 Plan

Status: approved for Windows implementation.
Base: `codex/palette-input-sources` at `ed53cf25e67f817494c36653d8420f784539c6e6`.
Scope: correct the pet-action capture and result-publication flow. This plan supersedes v3 interaction rules for this cycle; v3 Plans, Specs, ledgers, and audits remain historical records.

## Approval evidence

The user authorized this correction in the current task thread, confirming the stated interaction as correct and asking for the documents to be corrected. The confirmed requirements are recorded below as the approval evidence for this v4 Plan and its compiled Spec. Approval covers Windows implementation. macOS/Linux shortcut behavior is design context only and is not a platform compatibility claim.

## Product goal

Make Structure and Optimize direct, deliberate actions on text the user has selected. The user selects text and clicks one action once. The application then actively requests a copy from the selected host, obtains the resulting non-empty source text, runs the chosen operation, and writes any non-empty returned text directly to the system clipboard. The user chooses when and where to paste.

Selection alone has no side effect. It does not trigger a copy, prompt, preview, or model call. A missing, empty, or stale source copy fails visibly and makes no model call; the application never substitutes old clipboard content. A true operation exception or empty model response also fails visibly and does not fabricate a result. Any non-empty model return, including raw or degraded output, is written to the clipboard and accompanied by an appropriate status note. An actual operating-system clipboard write failure is reported as failure.

## Interaction and capture contract

1. The user selects text and clicks Structure or Optimize once. The click is the user's authorization; no second click, preview approval, or manual Ctrl+C step is required.
2. The app requests copy from the current selected-text host and obtains the non-empty copied source text for this operation. It does not decide eligibility from editability, read-only state, message history, or application category. Browser and IDE ordinary interfaces are included; no extension or host allowlist is required.
3. If no new, non-empty source text can be acquired for the active request, show a concise capture failure and stop before the model call. Never fall back to pre-existing clipboard text. A native selection read may be used to handle an equal-value clipboard case, but it is optional and is not a universal host admission requirement.
4. Run the selected operation on the captured source. A genuine exception or empty return shows failure. For every non-empty return, attempt a direct system clipboard write regardless of whether the return is normal, raw, or degraded. Show the relevant note with the result state. If the OS rejects the write, report that failure.
5. The user pastes manually. Never auto-paste, replace the source selection, or insert text into the target. A later user copy while processing does not invalidate or redirect the operation's result; the operation still writes its non-empty return when it completes.

## Host copy behavior

The application uses the actual host/platform copy instruction. It does not infer the host from a shell executable, and it does not inject terminal Ctrl+C.

| Host | Copy request |
|---|---|
| Ordinary Windows interface, including browser and IDE interfaces | Ctrl+C |
| Windows Terminal | Ctrl+Insert |
| Classic Windows console host (conhost) | Ctrl+Insert |
| Common Linux terminal | Ctrl+Shift+C (design reference; not runtime-verified) |
| macOS Terminal | Cmd+C (design reference; not runtime-verified) |

Windows Terminal's documented actions and classic Windows console behavior are distinct. The Windows implementation must use the host-specific Windows key above. Linux/macOS entries do not authorize or claim implementation support in this Windows cycle. No manual-copy fallback or confirmation preview is part of the approved flow.

## Pet controls and preserved behavior

Keep the existing three-button row and labels: enabled Structure and Optimize, disabled Image Recognition placeholder. Preserve busy-state handling, concurrent-operation isolation, voice-busy guards, and the disabled image placeholder. Text actions remain unavailable during voice recording/transcription. Do not change the voice workflow. Retain no-auto-paste behavior.

## Privacy and failure behavior

Capture text only for a user-triggered active operation. Do not continuously monitor selection or clipboard, and do not log captured text or model bodies. A capture failure causes zero model calls. Empty returns and true exceptions never become fabricated text. Clipboard publication errors are visible failures. Do not reject a non-empty result merely because clipboard contents changed during processing.

## Implementation units and risk boundaries

| Unit | Objective | Risk boundary / evidence |
|---|---|---|
| WU-1 | Replace the v3 capture gate with a one-click active-copy contract, including platform/host copy routing and no stale clipboard fallback. | High: prove request-to-capture binding, empty/stale rejection, equal-value handling where available, zero model calls on capture failure, and terminal chord routing. |
| WU-2 | Publish every non-empty operation return directly to system clipboard; handle raw/degraded notes, empty/error states, and real OS write failure. | High: prove all non-empty result classes attempt write, failures are surfaced, and no preview/ownership-change gate blocks publication. |
| WU-3 | Preserve pet UI, voice exclusion, concurrency isolation, and manual paste semantics across the revised workflow. | Medium: prove one-click interaction, busy/concurrent behavior, voice isolation, no auto-paste, and three-button layout. |
| WU-4 | Validate Windows behavior and hand off the implemented capability. | High: record named Windows host/control runs, source/result clipboard outcomes, and release limitations. |

## Final acceptance and release boundary

The implementation is accepted when every Spec acceptance check passes on the Windows implementation, all three controls and voice invariants remain intact, and no forbidden effects occur. Windows runtime evidence must name tested host/control pairs. Linux/macOS behavior remains unverified design context. This approval authorizes implementation and its required validation; it does not claim release or support on untested platforms or hosts.
