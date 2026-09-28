# Palette Trigger Compatibility

This implementation uses passive Windows UI Automation only. A candidate selection is accepted only when both mouse endpoints resolve to the same enabled `Edit` element, its `ValuePattern` explicitly reports `IsReadOnly = false`, and its `TextPattern` returns the same non-empty selected text at both endpoints. The selected process name must also be available and must not match a known terminal host. Action-time checks additionally require the same focused Edit; paste checks foreground process, focused Edit identity, and selected text immediately before sending Ctrl+V.

## Capability-Based Support

The implementation can support a control/provider only when it exposes all required UIA patterns and stable identities. Native Win32 Edit/RichEdit, WinForms text boxes, WPF editors, and browser inputs are candidates, not experimentally confirmed support claims. Each provider must be verified in its actual application and Windows version.

Browser `contenteditable` is conditional. It is eligible only if UIA hit testing returns an `Edit` and the provider reports the required non-readonly value and non-empty TextPattern selection without side effects. A DOM text node, `Document`, `Text`, or missing/ambiguous provider evidence is denied. No browser DOM scripting or clipboard fallback is used.

## Fail-Closed Cases

Desktop and shell/file/object selection, menus, PDF/document body text, read-only page content, and any hit that does not resolve to the required UIA Edit evidence are denied. Known PDF viewer processes are denied even if a fillable form exposes an Edit control: Acrobat/AcroRd32, Foxit PDF, SumatraPDF, PDF-XChange, and Nitro PDF. Known terminal process names are denied in the gate, including Windows Terminal, command shells, ConHost, ConEmu, mintty, WSL/Linux shells, WezTerm, Alacritty, Hyper, Tabby, Kitty, PuTTY, Cmder, FluentTerminal, Terminus, Rio, and xterm.

The terminal list is not a universal classifier. Integrated terminals and custom applications may share a host process with editors; their exact UIA tree determines whether the strict Edit/TextPattern test rejects them. Such Windows/application combinations have not been exercised here and remain a targeted compatibility test requirement. Unknown/custom terminal hosts are not claimed as blocked solely by process name.

## Verification Status

Pure-JavaScript eligibility, parsing, async guard, and source invariants are covered by unit tests. Generated PowerShell probe and paste-guard scripts pass the local PowerShell parser. These checks do not exercise UIA provider behavior, actual text selection, foreground changes, or end-to-end paste delivery.

The palette window still uses Electron `focusable: false` and `showInactive()`. Runtime verification that clicking it preserves the original foreground/focus state is pending. If the original target is no longer active when processing or paste is attempted, the operation is canceled. A narrow race remains after the final focus/selection check and before `SendInput` takes effect.
