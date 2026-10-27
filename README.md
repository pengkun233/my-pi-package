# my-pi-package

Private personal [Pi](https://pi.dev) package for reproducing this setup on another machine. It bundles an always-on TUI, isolated side chat, completion metadata, source-block copying, a session-scoped Loop scheduler, progressive memory, a prompt-snippet picker, Codex subscription usage, independent prompt/configuration audit skills, three user-invoked workflow skills, five prompt templates, eleven selectable themes, recommended global interaction preferences, and reference Herdr configuration. It contains no credentials, sessions, memory data, or other machine state.

## Install

Install the Pi package with Pi's own package manager:

```bash
pi install git:github.com/pengkun233/my-pi-package
```

For setup on another machine, package updates, or configuration sync, have the agent read [config/recommended.md](config/recommended.md). It covers Pi and Herdr preferences and links to the reference files. The agent decides which suggestions fit the target machine and merges only applicable, authorized changes. There is no repository installer or automatic preference overwrite. Reload or restart Pi to load installed resources.

## Bundled resources

### Skills

The model-invoked `loop` skill translates natural-language scheduling, status, and cancellation requests into the Loop tools. `/skill:loop` loads it explicitly when needed.

Two independent Chinese audit skills are also model-invoked or available explicitly:

- `/skill:prompt-audit [scope]` reviews instruction quality, conflicts, outdated facts, routing and workflow clarity. It reports source evidence, confidence, semantic risks and proposed changes only; it does not edit configuration automatically.
- `/skill:token-analyze [scope/window]` analyzes the **current project's effective configuration**, including global/project system instructions, AGENTS context, tool descriptions/schemas and permanent skill indexes. It separates on-demand skill bodies and dynamic injection from permanent cost, and reports observed project tool/skill frequencies, session coverage and last-seen dates over the last 30 days. It is not a current-conversation usage report or a subscription-quota query.

There is no doctor skill or command. Audits keep configuration unchanged unless you separately authorize an implementation.

Three other bundled skills are user-invoked only:

- `/skill:project-init` initializes a target directory as a Git repository with concise `AGENTS.md`, `README.md`, and `ai_docs/` documentation, plus a `CLAUDE.md` symlink.
- `/skill:wait-what-cn` re-pitches the previous response in concise technical Chinese, adds missing context, and preserves the current project's domain language.
- `/skill:tidy-memory` periodically audits project memory and `ai_docs/engineering.md`, using repository evidence to resolve conflicts and remove duplicate or stale knowledge. `/Neat-Freak` updates development experience in `ai_docs/engineering.md`, affected references in `ai_docs/reference.md`, and newly learned memory without duplicating content. `README.md` is generated or updated only after a human explicitly declares a project or milestone complete; repository `CLAUDE.md` and `AGENTS.md` files remain human-maintained and read-only to both workflows.

The optional `frontend-design` skill stays subscribed directly to `anthropics/skills`; it is not vendored here. See `frontendDesignSkills` in [config/packages.json](config/packages.json) and the merge instructions in [config/recommended.md](config/recommended.md). Installing this package alone does not register that upstream subscription.

### UI

`extensions/ui/index.ts` installs one TUI lifecycle with:

- custom footer and startup header; at 80 columns or wider, the footer preserves every standard `setStatus()` contribution, sorts statuses by ID, and wraps overflow onto additional rows;
- boxed native editor with the companion enabled by default;
- clear-draft recovery: clear nonempty text with the configured `app.clear` binding (normally Ctrl+C), then press the configured cursor-Up binding while empty to restore it once; subsequent history/cursor navigation stays native. Typing or host-driven draft/session replacement discards the saved draft. Multiline, Chinese, bash text and expanded paste contents are preserved as plain text. Attachment objects, cursor position and editor undo/paste-marker state are not exposed by the host and are not restored; fullscreen selection, application shortcuts, empty-editor exit and higher-priority extension shortcuts remain native;
- active-theme-aware message/tool rendering and subagent styling;
- working spinner and terminal-tab status;
- `/ack` to return a settled terminal status to idle.

There is no Plan Mode, `/pikit-ui` toggle, persisted UI enable state, or runtime theme switching. The UI follows whichever Pi theme is active and disposes its editor, footer, header, timers, title status, and adapters on reload or session shutdown.

Optional machine-local overrides:

- `~/.pi/agent/configs/chat-input.json`
- `~/.pi/agent/configs/ui-footer.json`
- `~/.pi/agent/configs/styled-outputs.json` (or `$PI_CODING_AGENT_DIR/configs/styled-outputs.json`)

The package defaults remain authoritative when those files are absent or invalid.

Message-style overrides use the following local schema (all fields are optional):

```json
{
  "assistantMessage": { "prefix": "●", "prefixColor": "text" },
  "thinkingMessage": { "prefix": "✽", "prefixColor": "accent" },
  "userMessage": {
    "prefix": "❯",
    "prefixColor": "accent",
    "isThemeBackgroundVisible": true
  }
}
```

`prefixColor` is a foreground token from the active Pi theme, such as `accent`, `text`, `success`, or `warning`; unknown tokens fall back to the default prefix color. An empty `prefix` disables that marker **and its extra spacing**, leaving native output padding intact. Set `userMessage.isThemeBackgroundVisible` to `false` to remove the theme background while retaining native user text styling. Controls/oversized prefixes and wrongly typed fields fall back independently; a missing, unreadable or malformed file uses defaults. These overrides only configure the three message markers and user background, not the full upstream Pikit configuration schema or tool layout.

The file is read when the UI is activated. Reload or restart Pi yourself after editing it; the package does not create the file or reload the session automatically. When upgrading from the previous message renderer, restart Pi once: `/reload` cannot replace old prototype wrappers already installed by that implementation. Styling decorates existing native Markdown rather than recreating it, preserving Markdown options/transformers, output padding, and Pi 1.1.0's clickable thinking regions.

The footer adapts on every render, including terminal resize, using fixed 80/40-column breakpoints:

- **80 columns or wider:** full layout with divider, configured rows, extension statuses, path/session, token counts and cost, without a leading blank line. The existing `contextBar.responsive` setting still controls the context bar only.
- **40–79 columns:** exactly one line with the model name (or ID, without a provider prefix), full uppercase thinking level (such as `HIGH`), and actual context token usage plus percentage (`ctx 32.1k 25.1%`).
- **Below 40 columns:** the same single line, with thinking short codes: `O` (off), `MI` (minimal), `L` (low), `M` (medium), `H` (high), `XH` (xhigh), `MX` (max).

Narrow layouts hide all extension statuses, path/session, cumulative input/output token counts and cost, with no top blank line, divider or second row, regardless of configured wide-screen segments. Model text is clipped first to preserve thinking/context; at extremely small widths even those fields may be clipped. Unknown model/thinking use `?`, and unavailable context is `ctx ?`, never a fabricated `0%`. No model aliases are inferred.

### Loop

`extensions/loop/` provides one in-memory background patrol for the current interactive session:

- natural-language requests are the primary interface, for example: “Check the deploy every 5 minutes and stop when it succeeds” or “Stop the current Loop”;
- the `loop` skill supplies a self-contained check: what to inspect, where to find it, and when it is complete or needs attention;
- each check starts a fresh Pi subprocess with `read`, `grep`, `find`, and `ls`, without the main conversation, extensions, skills, templates, or context files;
- the patrol model decides `continue`, `complete`, or `alert`. Continuing checks stay silent; completion, alerts, configured limits, and errors stop the Loop and send a result to the main conversation, triggering a reply (queued as a follow-up when busy);
- `loop_start` optionally accepts `maxRuns`, `timeoutMinutes`, model/thinking overrides, and a `probeCommand`: a read-only shell command whose stdout, stderr, and exit code are supplied to the checker. Nonzero exit codes are observations for the model to interpret;
- `/loop 5m check the deploy`, `/loop status`, and `/loop stop` remain available;
- status shows the prompt, model, interval, check count, creation time, next run, and configured bounds;
- the footer shows `↻ 5m · 09:30` while waiting and `↻ 5m · checking` during a check; next-day runs include the date;
- all displayed times use Beijing time (`UTC+8`), independent of the machine's local timezone;
- checks run even when the main agent is busy. The next interval starts after the previous check finishes, so checks never overlap. Each check (including its probe) has a two-minute timeout, shortened by the Loop's remaining time limit;
- explicit stop cancels the current checker and future runs. Reload and session shutdown also cancel and discard the Loop; they do not resume it or send an extra completion notification.

Configure defaults in `~/.pi/agent/loop.json` (or `$PI_CODING_AGENT_DIR/loop.json`):

```json
{
  "patrolModel": "openai-codex/gpt-5.6-luna",
  "patrolThinking": "medium"
}
```

Both fields are optional. `loop_start` parameters of the same names override the file, which is read when a Loop starts. Use a thinking level supported by the model (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`). The subprocess uses existing Pi credentials and built-in or `models.json` providers; extension-registered providers are not loaded. Background checks consume provider quota separately from the main turn. Probe commands are trusted shell commands, not sandboxed or automatically checked for read-only behavior.

Loop publishes background activity through the terminal-status plugin's generic event contract. The terminal-tab title shows `🟣 等待中` whenever a Loop is active or a foreground/background `pi-subagents` run is detected. Input-required and error states retain higher priority.

### Memory

`extensions/memory/` provides progressive-disclosure global/project memory indexes, the `memory` tool, `/memory`, and `/remember`. Runtime data remains under `~/.pi/agent/memory/` (or `PI_MEMORY_DIR`) and is never part of this repository.

### Prompt snippets

`extensions/prompt-snippets/` provides `Alt+Shift+S` and `/snippets` for toggling small prepend/append rules on the next message. It merges package defaults from its adjacent `snippets/` directory with machine-local files under `~/.pi/agent/snippets/`; a local file overrides a packaged snippet with the same filename. Package updates synchronize defaults, while private or machine-specific snippets remain outside Git and must be synchronized separately when desired.

### Isolated side conversation

`extensions/btw/` provides `/btw QUESTION` in the interactive TUI. Each invocation with a question starts a new side conversation using the current model and the completed main-context snapshot at that moment. `/btw` without arguments reopens the current side conversation without another request.

- Enter submits a side follow-up; Ctrl+N **New** discards that thread and takes a fresh main snapshot/current model. PgUp/PgDn scroll the side answer.
- Esc **Close** removes only the overlay: a pending answer continues, and the thread/draft survives for reopening. Ctrl+K **Cancel** aborts only the side request, retaining the conversation. Neither action aborts or steers the main task, which continues underneath.
- Side requests have a short side-question instruction and **no tools or execution path**. The snapshot is reference data, not an instruction to carry out the main task. Side text never enters main assistant messages, context, history or built-in `/copy`.
- One thread plus session-wide side usage lives in memory. New questions replace the thread but not session usage. Tree navigation closes/cancels the overlay request while retaining the thread and its original snapshot; New refreshes it. Session replacement, reload or shutdown discards everything. No side transcripts are written to disk.
- Usage shown in the overlay and `btw-usage` footer status is provider-reported side usage, separate from main usage; cancelled/failed requests may report no usage. Side requests consume the same account's quota.

The snapshot respects branch/compaction and includes finalized text, tool inputs/results and summaries, excluding reasoning, images, system instructions and context-excluded shell executions. It does not include currently streaming text or unpersisted extension context transformations. An existing thread keeps its selected model/snapshot until New. Very large main/side history can exceed the model's context limit (no automatic side compaction); errors are shown in the overlay. Tiny terminals may clip the editor/controls. RPC/print modes have no side overlay.

### Completion metadata

`extensions/completion/` appends muted, right-aligned metadata such as `finished · 14:32:18 · 1m24s` only at `agent_settled`, after automatic retries, compaction and queued continuations. `stopped` and `error` reflect cancellation/final failure, not success. This measures a complete settled run, not each model request or proof that a task's result is correct.

The local-clock end time and monotonic elapsed time are custom session entries, replayable after resume and independent of assistant Markdown, model context and copy commands. Ephemeral sessions do not survive exit; a process crash cannot produce a settled completion entry. Hosts without a final abort flag use their exposed run signal/last assistant stop reason. Pi 0.82.1 can lose cancellation evidence while waiting between retries/compaction; exact final-abort classification requires the newer host flag (verified at Pi 1.1.0).

### Source-block copying

`/copy-block` opens one keyboard-driven overlay in the interactive TUI, showing the message role/history position, block list and selected block's **original source preview**. It snapshots the current branch's persisted user and successfully completed assistant text, defaulting to the latest assistant message (or latest user message when there is no assistant). Tool/thinking/image content, failed or aborted responses, currently streaming text, side chat, summaries and completion metadata are excluded. User messages can be previewed and copied as **whole text only**; assistant messages offer whole Markdown, heading sections, consecutive blockquotes and fenced code interiors. Multiple text parts are joined with a newline.

- **↑/↓** select a block; **Home/End** select the first/last block of the current message.
- **←/→** browse earlier/later messages, including user context; **PgUp/PgDn** scroll the source preview.
- **Enter** submits a clipboard request and keeps the panel open for further browsing/copying. Repeated Enter is ignored while that request is pending; errors appear in the panel and can be retried.
- **Esc** closes without submitting a new copy request. An already submitted clipboard operation cannot be undone, but its late completion/error will not reopen or update a closed panel. Tree navigation, session replacement, reload and shutdown also close it; reopening takes a fresh branch snapshot.

Whole/section/quote selections preserve source Markdown. Code copies **only the interior**, without fences/language labels, preserving indentation and original line endings (including CRLF). The raw preview wraps to fit; tabs are displayed as spaces and terminal controls as visible text, without changing the copied source. Wide screens use block/preview columns; narrow screens stack them, with reduced detail on very small terminals. Only visited messages are scanned and the selected preview layout is cached. Built-in `/copy` and its shortcut are unchanged; opening, copying and closing never modify the main editor draft. RPC/print modes have no copy overlay.

The lightweight scanner supports top-level ATX/setext headings and backtick/tilde fences (including unclosed fences). It is not a complete CommonMark parser and does not add paragraph selections: nested list/quote fences, lazy quote continuations and indented-code blocks are not separate selections; whole-response copying preserves those sources. Clipboard requests use Pi's native helper; SSH/OSC52 success cannot be acknowledged, so the notification says a copy was requested, not guaranteed.

### Codex subscription usage

`extensions/openai-usage.ts` provides `/codex-plan-usage` for a logged-in `openai-codex` account; `/codex-plan-usage json` shows a sanitized response. The former command has no alias. It reads credentials through Pi at runtime and does not store or package them. This queries OpenAI's internal subscription-quota endpoint, not project token efficiency; the endpoint can change.

### Token-analysis evidence and limits

`extensions/token-analyze/` is a small local metadata collector supporting the independent `token-analyze` skill, not a new model-facing tool or prompt injection. After reload, make a main request to capture effective runtime configuration. For a deterministic local JSON report without calling a model, run from the package root:

```bash
node skills/token-analyze/scripts/report.mjs --cwd /path/to/project --days 30
```

The skill resolves this helper relative to its installed skill directory. `--agent-dir PATH` and `--session-dir PATH` support alternative storage. The default project boundary is the Git root and its subdirectories (otherwise the requested cwd). Historical JSONL sessions are the primary evidence; minimal skill-read/explicit-invocation entries supplement them. Other historical custom session directories need an explicit override.

Snapshots are saved atomically under `$PI_CODING_AGENT_DIR/token-analyze/<cwd-hash>/latest.json` (default `~/.pi/agent/`), with directory/file modes 0700/0600. They contain lengths, heuristic estimates, hashes, tool/skill names, source paths, timestamps and session/model identifiers—not prompt bodies, tool arguments/results, schema bodies or credentials. Skill observations are non-context custom session entries. Historical analysis reads only these snapshots, session JSONL and identified skill bodies; it does not read auth files, secret environment variables or remote token APIs. Normal session logs may themselves contain sensitive material; the report does not reproduce their content.

Estimates use CJK characters plus other UTF-16 characters/4, **not a tokenizer or billing total**. Component estimates overlap and must not be added as exact buckets; on-demand bodies are potential disk costs, not permanent injection. Active registered tools may differ from actual declarations after codemode/loadout/provider transforms. Known outgoing tool/instruction fields get an additional metadata-only wire estimate when exposed; later handlers, hidden/server prompts and unsupported provider payload shapes remain unknown.

A snapshot is the latest observed project request, possibly stale or from another session/subdirectory—not a promise about the next request after disk changes. Its `baseSystem` was observed at the collector's `before_agent_start` handler, possibly after earlier extension changes; zero difference does not prove no dynamic injection. Missing snapshots mean effective configuration is unknown. Historical coverage is a lower bound: old nested/codemode calls, other readers/bash, deleted sessions, missing timestamps and incomplete nested records cannot be reconstructed. Explicit invocation evidence is paired approximately by name/time and does not prove workflow success; forks/clones may duplicate ancestral activity. Failed/unfinished reads are not successful skill use. Low observed frequency alone never authorizes disabling a capability or global configuration changes.

### Global voice-input preference

`config/global-agents.md` is an optional reference for global interaction preferences, not an automatically loaded Pi resource. See [config/recommended.md](config/recommended.md) for selective adoption and handling blocks left by the former installer.

### Automatic session names

`extensions/session-name/` names interactive Pi sessions independently of Herdr:

- A separate asynchronous request (default: `openai-codex / gpt-5.6-luna`, `low` reasoning) runs on the first nonempty interactive message, then messages 11, 21, and so on. Empty, extension-generated, and headless/RPC inputs do not count.
- Requests use the configured provider's existing Pi credentials, the previous title, and at most 6,000 characters of recent user/assistant text. Tools, reasoning, images and system prompts are excluded. Issue numbers are preserved when available; this extension does not fetch GitLab issues itself.
- Generated titles target 16 display columns (8 Chinese characters): Chinese characters/full-width punctuation count as 2 columns; ASCII letters, digits, spaces and punctuation count as 1. Mixed titles use the summed width; shorter is still preferred. The entire title, including descriptions and issue numbers, is measured with Pi's display-width helper. Over-budget output gets one model rewrite, never blind truncation; if it still exceeds the budget, the rewritten title is accepted without a width warning. The prompt still encourages concise titles and shortening over-budget previous names.
- No naming tools or instructions are added to the main conversation. Background requests consume their own provider quota and are not included in the main turn's usage totals.
- Titles and counters persist with the session. `/name` (or another explicit rename) immediately disables automatic overwrites for that session, including after reload/resume. Existing named sessions are preserved.
- Only one request runs at a time; overlapping scheduled updates coalesce. Requests have a 45-second deadline, are cancelled on shutdown/tree navigation, and cannot overwrite a manual rename or a replacement session. Failures keep the current title and wait for the next scheduled interval; warnings are shown at most once per load.
- No polling, watcher, permanent timer, or additional local process is used. The first naming attempt happens on the next eligible message, not during startup.

Configure the background model in `~/.pi/agent/session-name.json` (or `$PI_CODING_AGENT_DIR/session-name.json` when overridden):

```json
{
  "provider": "openai-codex",
  "model": "gpt-5.6-luna",
  "reasoning": "low"
}
```

All fields are optional and default to the values above. `reasoning` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; choose a level supported by the model. The model must be registered in Pi and its provider authenticated. Settings are read at each naming attempt, without `/reload`; they do not follow the main conversation's `/model`. Missing files use defaults; malformed settings fail the naming attempt rather than silently selecting another model. Do not put API keys in this file.

### Herdr sidebar status

`extensions/herdr-status/` adds compact, independent task marks to the second line of Herdr's Agents sidebar:

```text
🚀 #123 修复登录超时
✅ #123 修复登录超时
💤 #123 修复登录超时
📖 #123 修复登录超时
🤖 #123 修复登录超时
```

- The purple title mirrors Pi's session name on startup and every rename, including manual `/name`; unnamed sessions hide the title. Herdr never generates or independently stores a task name.
- Sending a message switches to `🚀`; when the main agent fully settles (after retries and queued follow-ups), `🚀` automatically becomes `✅`. This means the run has ended, not that its result was verified successful. Automatic continuations change `✅` back to `🚀`. Manually selected `📖` / `💤` marks are preserved.
- `Alt+M` switches `🚀` / `✅ → 📖`, then cycles `📖 ↔ 💤`.
- `📖` is a manual bookmark for a valuable conversation to revisit, not an unread-result notification. Viewing the agent does not clear it.
- Marks and counts live only in memory. Initialization (including reload/resume) starts at `💤` with zero subagents; previous marks and running counts are not restored or written to session history.
- Any running ordinary subagent temporarily replaces the task mark with `🤖`; no count or suffix is displayed. Otherwise, an active Loop displays `🔄` throughout waiting and checking. Loop patrols do not count as ordinary subagents. Priority is `🤖` > `🔄` > the underlying task mark.
- Loop activity only overlays the task mark: stopping or completing the Loop restores the underlying mark. `Alt+M` still changes that mark while either overlay is visible.
- Counting uses `@tintinweb/pi-subagents`'s `subagents:started/completed/failed` events (verified with `0.19.0`), covering top-level foreground/background agents, failure, cancellation, and resume. Queued agents are not counted until they start. That version does **not** expose workflow/nested child lifecycles or a numeric registry API, so those children cannot be counted. The older unscoped `pi-subagents` package in the optional package reference uses a different contract and does not provide this counter; it is not replaced automatically.
- This changes display metadata only: it never pauses a task or overrides Herdr's actual lifecycle indicator on the first line.
- Only interactive Pi inside Herdr enables this extension. Reports are scoped to the calling pane and sent on initialization and mark/count/name/Loop activity changes, with fields cleared on normal shutdown. There is no heartbeat or TTL, so a crash may leave stale display metadata.
- Reports call `pane.report_metadata` directly over the local Herdr socket, without spawning the CLI. Each request has a timeout and increasing sequence number; failures are reported without retries, warning deduplication, or a coalescing queue.

Requires Herdr's `pane.report_metadata` socket support (verified with `0.9.0`). The bundled Herdr config renders `$pi_task_mark` and `$pi_session_name` on Pi's second line, with fixed blue/yellow/purple text colors. Other agents retain their agent label. For selective adoption after updates, follow [config/recommended.md](config/recommended.md). The Herdr-managed `herdr-agent-state.ts` integration is left untouched.

### Herdr configuration

`config/herdr/config.toml` is a reference Herdr preference file, not an automatically installed configuration. It includes the Dracula theme, direct workspace/tab/agent navigation keys, the `prefix+a` Pi-agent launcher command, expanded agent-row formatting, and disabled persisted pane history. The launcher binding expects `~/.local/bin/herdr-new-pi` to exist on the target machine; that machine-local helper is not bundled.

The first agent row shows the state icon, a cyan bold machine label, workspace, and tab; Pi's second row keeps its task mark and session name. Herdr 0.9.0 omits the `machine` token for a single local machine. Separators are controlled by Herdr, not this config. Both the default `rows` and `rows_by_agent.pi` include the machine token.

For selective sidebar sync, compatibility checks, and reload instructions, read [config/recommended.md](config/recommended.md). Saved machine profiles and SSH credentials are not included.

### Prompts and theme

Prompt templates:

- `/Get-Shit-Done`
- `/Neat-Freak`
- `/aye`
- `/frontend-humanize`
- `/frontend-refine`

Bundled themes:

- `slop` (recommended)
- `flexoki-dark`
- `everforest-dark-hard`
- `gruvbox-dark`
- `kanagawa-wave`
- `dracula`
- `ayu-dark`
- `ayu-mirage`
- `ayu-light`
- `vesper`
- `poimandres`

They are ordinary package themes discovered from `themes/`. Select a theme through `/settings`; installing or updating the package does not change the selected theme.

## Updates

Pi manages all registered unpinned packages:

```bash
pi update --extensions
```

After updating, ask the agent to review [config/recommended.md](config/recommended.md) against this machine's setup and adopt only relevant changes. Updating resources does not apply reference configuration.

## Development

```bash
npm ci
npm run check
npm test
npm run pack:check
npm pack --json --dry-run
```

The main typecheck and test suite use pinned Pi `0.82.1` dependencies. Message-style regression tests also exercise real Pi `1.1.0` components in isolated Node processes, including user background/markers, Markdown transforms/output padding, and thinking click toggles. Isolated enhancement smoke tests additionally load side-chat snapshot/overlay APIs, the authenticated-stream facade path, completion metadata and clear-draft recovery against both Pi versions, using mock model streams (no account/network calls). Host-version tests run when Pi is available at `~/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent`, or at the explicit `PI_STYLED_TEST_PI_ROOT` / `PI_ENHANCEMENTS_TEST_PI_ROOT` overrides respectively; otherwise they are skipped. They do not replace a full bundled-CLI or live fullscreen terminal/mouse integration test. Renderer prototype styling remains best-effort because these internals are not a stable extension API.

## Attribution

The chat-input renderer and companion animation are adapted from Adrian Apan's MIT-licensed Pikit project. See `THIRD_PARTY_NOTICES.md`.
