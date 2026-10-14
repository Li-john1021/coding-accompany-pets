# Browser and IDE Capture Capability Spike

## Outcome

This spike did not establish live browser or IDE compatibility. The `@oai/sky` runtime initialized, but its Windows app inventory returned no native applications and only the Codex in-app browser and MCP Apps providers. Those providers are out of scope for this probe. No browser or VS Code window was opened, no existing window was controlled, and no Ctrl+C chord was sent. The requested accessibility comparison therefore remains unrun on this host.

The planning gap remains real: [pet-actions-capture-review-1.md](audits/pet-actions-capture-review-1.md) records that the approved Plan names webpages and IDE editors as ordinary Ctrl+C candidates, while the implementation classifies Chrome as unknown and Code as VS Code/manual. Current snapshots contain foreground HWND, process/window class, focused HWND/class, and clipboard sequence; they do not expose a browser DOM active element or a VS Code editor selection capability.

## Environment and evidence

- Workspace revision: `d3dd9492740edb85c19f1d2affdfdcf21973f1ac` (`codex/palette-input-sources`).
- Windows UI automation: bundled `@oai/sky` initialized successfully. `cua.getState()` returned `apps: []`; browser providers were Codex In-app Browser and Codex MCP Apps, with no tabs. These were deliberately not used because the test must not automate Codex.
- No preinstalled browser or VS Code instance was exposed by the permitted app inventory. A dedicated test window could not be safely selected without an app entry; no launch was attempted.
- Repository evidence: `app/main/pet-action-capture.js` classifies only a fixed native-app list as ordinary. `app/main/pet-action-capture.unit.test.js` asserts Chrome becomes unknown and Code becomes VS Code. The capture path consequently requests manual copy for both.
- Runtime compatibility level: **not tested**. This spike does not claim a browser/IDE host or control is supported.

## Candidate distinguishing signals

| Surface | Potential signal | Evidence level and limit |
|---|---|---|
| Ordinary browser `textarea` / `input` | A browser extension content script can inspect the page DOM and focused element, including editable element type and selection range. | Official Chrome documentation says content scripts can access page DOM and message the extension. This establishes an implementation route, not that the app has an extension, that permissions are acceptable, or that a runtime probe works. |
| Browser `contenteditable` | DOM `activeElement`, `isContentEditable`, and Selection/Range endpoints can identify a web editing surface; editable descendants can be distinguished from ordinary page text. | Requires page-context code in a paired browser extension. Generic process/window identity cannot make this distinction. Embedded terminal widgets, canvas editors, iframes, shadow DOM, and custom keybindings need explicit policy and named tests. |
| VS Code text editor | A VS Code extension can inspect `window.activeTextEditor`, its document, and selection(s), and issue a command in that editor context. | Official VS Code API documents `activeTextEditor` and editor selection APIs. This requires an installed/authorized extension bridge; the external pet process cannot infer this capability from `Code.exe` alone. |
| VS Code integrated terminal | VS Code extension APIs expose terminal objects separately from `activeTextEditor`; active editor context can avoid treating terminal focus as a text editor. | API route is plausible, but focus transitions, terminal tabs, custom editors, notebooks, diff editors, and extension failure behavior remain runtime cases. Do not send Ctrl+C unless a positive editor capability is returned. |
| UI Automation only | Focused control type/class, patterns, and selected ranges may help for some providers. | Microsoft UI Automation TextPattern supports text selection/range operations when a provider implements them. Provider support is optional/variable; a generic focused text node or selected-text string does not prove ordinary editor semantics or distinguish embedded terminals. Existing compatibility evidence already shows provider-specific failure and fail-closed handling. |

## Risk and recommendation

For the current Windows implementation, keep browser/IDE targets manual-copy plus fresh-clipboard preview/confirmation unless a capability source positively identifies an ordinary editable surface. Do not broaden the process allowlist or infer support from `Chrome_WidgetWin_1`, `Code.exe`, UIA `Edit` labels, or clipboard changes alone. If automatic Ctrl+C on these targets remains a product requirement, use an explicit paired integration: a browser extension for page DOM controls and a VS Code extension for `activeTextEditor`/selection. The pet should request a narrowly typed capability result tied to the foreground target, and fail closed when focus is terminal, a custom surface, stale, or unsupported. Then validate each named browser/control and VS Code editor/terminal pairing in a dedicated test profile before making a compatibility claim.

The smallest test matrix should create disposable test content containing a unique non-sensitive sentinel and compare, for each ordinary textarea, contenteditable element, VS Code editor, and VS Code integrated terminal: focused element/control identity, selection presence/range, selected text, and clipboard sequence before/after a manual copy. Never inspect or copy a user's existing document. This run could not reach that matrix because no eligible browser/IDE window was available.

## Official references

- [Chrome extensions: Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts): content scripts use the DOM to read and modify web pages and can communicate with the extension.
- [VS Code Extension API](https://code.visualstudio.com/api/references/vscode-api): includes `window.activeTextEditor`, editor selection APIs, and terminal APIs.
- [Microsoft UI Automation TextPattern overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-textpattern-overview): TextPattern exposes text ranges and selection when supported by the provider; support is provider-dependent.
