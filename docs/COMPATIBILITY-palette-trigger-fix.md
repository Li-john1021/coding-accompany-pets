# Palette Trigger Compatibility

Automatic selection currently supports only standard native Win32 `Edit` controls. Both points must hit the same enabled, writable HWND; bounded `EM_GETSEL` and Unicode `WM_GETTEXT` reads must confirm the same non-empty text and exact selection offsets. UIA providers are denied because this implementation has no proven non-text range identity that survives action-time revalidation; selected-text equality alone is not sufficient. The process name must be available and must not match a denied shell, terminal, or PDF process. Action-time checks retain HWND/PID/thread/parent/control-ID identity, exact selection offsets, foreground ownership, and focused HWND immediately before Ctrl+V.

## Capability-Based Support

The native Win32 `Edit` path was exercised on an isolated Windows fixture with a Unicode selection: endpoint HWNDs matched, selected-text hash and range matched, a guarded replacement succeeded, a changed focused target was canceled, and moving an identical string selection to different offsets canceled the stale write-back. This is evidence for the standard Win32 Edit class, not a compatibility claim for all applications or other native control classes. WinForms wrapper controls that do not expose a supported native Edit are denied.

WPF TextBox is explicitly unsupported on the tested Windows provider: `TextPatternRange.GetText` crashed its PowerShell child with `0xC0000005`. The production probe rejects WPF before making that call; all other UIA-only editable controls also fail closed until range identity is safely implemented. Browser inputs are therefore not currently eligible and browser cases remain untested.

Browser `contenteditable` is unsupported by the current automatic path. A DOM text node, `Document`, `Text`, or any UIA-only selection is denied. No browser DOM scripting or clipboard fallback is used.

## Fail-Closed Cases

Desktop and shell/file/object selection is denied by process name even if Explorer exposes an editable UIA element: Explorer, Progman, WorkerW, ShellExperienceHost, StartMenuExperienceHost, SearchHost/SearchApp, ApplicationFrameHost, ShellHost, Taskbar, and Dv2ControlHost. Menus, PDF/document body text, read-only page content, and any hit that does not resolve to the required UIA Edit evidence are also denied. Known PDF viewer processes are denied even if a fillable form exposes an Edit control: Acrobat/AcroRd32, Foxit PDF, SumatraPDF, PDF-XChange, and Nitro PDF. Known terminal process names are denied in the gate, including Windows Terminal, command shells, ConHost, ConEmu, mintty, WSL/Linux shells, WezTerm, Alacritty, Hyper, Tabby, Kitty, PuTTY, Cmder, FluentTerminal, Terminus, Rio, and xterm.

The terminal list is not a universal classifier. Integrated terminals and custom applications may share a host process with editors; their exact UIA tree determines whether the strict Edit/TextPattern test rejects them. Such Windows/application combinations have not been exercised here and remain a targeted compatibility test requirement. Unknown/custom terminal hosts are not claimed as blocked solely by process name.

## Verification Status

Pure-JavaScript eligibility and async guards are covered by unit tests. The Windows runtime fixture exercised native Edit selection, read-only/object/background/cross-control denials, guarded replacement, target-switch cancellation, equal-text/different-offset cancellation, and clipboard text restoration. Wrong expected owner PID is denied. WPF TextPattern crash and fail-closed behavior were also observed. Browser editable/read-only behavior, ordinary Ctrl+C, recording, IME-open restoration, and voice workflows remain unverified.

The native identity tuple reduces stale-target risk by checking HWND validity, owner PID, UI thread, parent HWND, control ID, foreground owner, and focused HWND. Win32 exposes no creation-generation token in this path: destruction and reuse with the same process/thread/parent/control ID cannot be distinguished if text and offsets also match. This residual HWND reuse case is not claimed as prevented.

The palette window still uses Electron `focusable: false` and `showInactive()`. Runtime verification that clicking it preserves the original foreground/focus state is pending. If the original target is no longer active when processing or paste is attempted, the operation is canceled. A narrow race remains after the final focus/selection check and before `SendInput` takes effect.
