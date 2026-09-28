# Palette Trigger Compatibility

Selection probing has two passive Windows paths. Standard native Win32 controls are accepted only when both points hit the same enabled, writable class `Edit` HWND and `EM_GETSEL` plus bounded Unicode `WM_GETTEXT` reads the same non-empty selected text. Other providers must expose a UIA `Edit`, writable `ValuePattern`, and `TextPattern` selection; the same element identity and text must match at both endpoints. The process name must be available and must not match a denied shell, terminal, or PDF process. Action-time checks retain the foreground/focused target and selected text immediately before Ctrl+V.

## Capability-Based Support

The native Win32 `Edit` path was exercised on an isolated Windows fixture with a Unicode selection: endpoint HWNDs matched, selected-text hash matched, a guarded replacement succeeded, and a changed focused target was canceled without writing into the newly focused Edit. This is evidence for the standard Win32 Edit class, not a compatibility claim for all applications or other native control classes. WinForms wrapper controls that do not expose UIA `Edit` are denied.

WPF TextBox is explicitly unsupported on the tested Windows provider: `TextPatternRange.GetText` crashed its PowerShell child with `0xC0000005`. The production probe recognizes WPF and fails closed before making that call. Browser editable inputs remain candidates only when UIA safely exposes the required patterns; browser cases were not tested.

Browser `contenteditable` is conditional. It is eligible only if UIA hit testing returns an `Edit` and the provider reports the required non-readonly value and non-empty TextPattern selection without side effects. A DOM text node, `Document`, `Text`, or missing/ambiguous provider evidence is denied. No browser DOM scripting or clipboard fallback is used.

## Fail-Closed Cases

Desktop and shell/file/object selection is denied by process name even if Explorer exposes an editable UIA element: Explorer, Progman, WorkerW, ShellExperienceHost, StartMenuExperienceHost, SearchHost/SearchApp, ApplicationFrameHost, ShellHost, Taskbar, and Dv2ControlHost. Menus, PDF/document body text, read-only page content, and any hit that does not resolve to the required UIA Edit evidence are also denied. Known PDF viewer processes are denied even if a fillable form exposes an Edit control: Acrobat/AcroRd32, Foxit PDF, SumatraPDF, PDF-XChange, and Nitro PDF. Known terminal process names are denied in the gate, including Windows Terminal, command shells, ConHost, ConEmu, mintty, WSL/Linux shells, WezTerm, Alacritty, Hyper, Tabby, Kitty, PuTTY, Cmder, FluentTerminal, Terminus, Rio, and xterm.

The terminal list is not a universal classifier. Integrated terminals and custom applications may share a host process with editors; their exact UIA tree determines whether the strict Edit/TextPattern test rejects them. Such Windows/application combinations have not been exercised here and remain a targeted compatibility test requirement. Unknown/custom terminal hosts are not claimed as blocked solely by process name.

## Verification Status

Pure-JavaScript eligibility and async guards are covered by unit tests. The Windows runtime fixture exercised native Edit selection, read-only/object/background/cross-control denials, guarded replacement, target-switch cancellation, and clipboard text restoration. The WPF TextPattern crash and fail-closed behavior were also observed. Browser editable/read-only behavior, ordinary Ctrl+C, recording, IME-open restoration, and voice workflows remain unverified.

The palette window still uses Electron `focusable: false` and `showInactive()`. Runtime verification that clicking it preserves the original foreground/focus state is pending. If the original target is no longer active when processing or paste is attempted, the operation is canceled. A narrow race remains after the final focus/selection check and before `SendInput` takes effect.
