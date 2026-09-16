# my-pi-package

Private personal [Pi](https://pi.dev) package for reproducing this setup on another machine. It bundles an always-on TUI, a session-scoped Loop scheduler with a model-invoked skill, progressive memory, a prompt-snippet picker, OpenAI usage, three user-invoked skills, three prompt templates, eleven selectable themes, recommended global interaction preferences, and reference Herdr configuration. It contains no credentials, sessions, memory data, or other machine state.

## Install

Install the Pi package with Pi's own package manager:

```bash
pi install git:github.com/pengkun233/my-pi-package
```

For setup on another machine, package updates, or configuration sync, have the agent read [config/recommended.md](config/recommended.md). It covers Pi and Herdr preferences and links to the reference files. The agent decides which suggestions fit the target machine and merges only applicable, authorized changes. There is no repository installer or automatic preference overwrite. Reload or restart Pi to load installed resources.

## Bundled resources

### Skills

The model-invoked `loop` skill translates natural-language scheduling, status, and cancellation requests into the Loop tools. `/skill:loop` loads it explicitly when needed.

Three other bundled skills are user-invoked only:

- `/skill:project-init` initializes a target directory as a Git repository with concise `AGENTS.md`, `README.md`, and `ai_docs/` documentation, plus a `CLAUDE.md` symlink.
- `/skill:wait-what-cn` re-pitches the previous response in concise technical Chinese, adds missing context, and preserves the current project's domain language.
- `/skill:tidy-memory` periodically audits project memory and `ai_docs/engineering.md`, using repository evidence to resolve conflicts and remove duplicate or stale knowledge. `/Neat-Freak` updates development experience in `ai_docs/engineering.md`, affected references in `ai_docs/reference.md`, and newly learned memory without duplicating content. `README.md` is generated or updated only after a human explicitly declares a project or milestone complete; repository `CLAUDE.md` and `AGENTS.md` files remain human-maintained and read-only to both workflows.

### UI

`extensions/ui/index.ts` installs one TUI lifecycle with:

- custom footer and startup header; the footer preserves every standard `setStatus()` contribution, sorts statuses by ID, and wraps overflow onto additional rows;
- boxed native editor with the companion enabled by default;
- active-theme-aware message/tool rendering and subagent styling;
- working spinner and terminal-tab status;
- `/ack` to return a settled terminal status to idle.

There is no Plan Mode, `/pikit-ui` toggle, persisted UI enable state, or runtime theme switching. The UI follows whichever Pi theme is active and disposes its editor, footer, header, timers, title status, and adapters on reload or session shutdown.

Optional machine-local overrides:

- `~/.pi/agent/configs/chat-input.json`
- `~/.pi/agent/configs/ui-footer.json`

The package defaults remain authoritative when those files are absent or invalid.

### Loop

`extensions/loop/` provides one in-memory repeating prompt for the current interactive session:

- natural-language requests are the primary interface, for example: “Check the deploy every 5 minutes and stop when it succeeds” or “Stop the current Loop”;
- the `loop` skill creates a self-contained check with an observable completion condition, and the agent calls `loop_stop` as soon as that condition is met;
- requests may optionally limit the Loop by successful check count or elapsed time;
- `/loop 5m check the deploy`, `/loop status`, and `/loop stop` remain available as the original direct interface;
- status shows the prompt, interval, dispatched check count, creation time, next run, and configured bounds;
- the footer shows a compact text status such as `↻ 5m · 09:30`; next-day runs include the date, for example `↻ 5m · 08-05 09:30`;
- all displayed creation, next-run, and expiry times use Beijing time (`UTC+8`), independent of the machine's local timezone;
- a tick is skipped when the main agent is busy, and all Loop state and footer status are discarded on reload or session shutdown;
- stopping cancels future runs without aborting work already in progress.

Loop publishes background activity through the terminal-status plugin's generic event contract. The terminal-tab title shows `🟣 等待中` whenever a Loop is active or a foreground/background `pi-subagents` run is detected. Input-required and error states retain higher priority.

### Memory

`extensions/memory/` provides progressive-disclosure global/project memory indexes, the `memory` tool, `/memory`, and `/remember`. Runtime data remains under `~/.pi/agent/memory/` (or `PI_MEMORY_DIR`) and is never part of this repository.

### Prompt snippets

`extensions/prompt-snippets/` provides `Alt+Shift+S` and `/snippets` for toggling small prepend/append rules on the next message. It merges package defaults from its adjacent `snippets/` directory with machine-local files under `~/.pi/agent/snippets/`; a local file overrides a packaged snippet with the same filename. Package updates synchronize defaults, while private or machine-specific snippets remain outside Git and must be synchronized separately when desired.

### OpenAI usage

`extensions/openai-usage.ts` provides `/usage` for a logged-in `openai-codex` account. It reads credentials through Pi at runtime and does not store or package them.

### Global voice-input preference

`config/global-agents.md` is an optional reference for global interaction preferences, not an automatically loaded Pi resource. See [config/recommended.md](config/recommended.md) for selective adoption and handling blocks left by the former installer.

### Automatic session names

`extensions/session-name/` names interactive Pi sessions independently of Herdr:

- A separate asynchronous request (default: `openai-codex / gpt-5.6-luna`, `low` reasoning) runs on the first nonempty interactive message, then messages 11, 21, and so on. Empty, extension-generated, and headless/RPC inputs do not count.
- Requests use the configured provider's existing Pi credentials, the previous title, and at most 6,000 characters of recent user/assistant text. Tools, reasoning, images and system prompts are excluded. Issue numbers are preserved when available; this extension does not fetch GitLab issues itself.
- Generated titles must fit within 16 display columns (8 Chinese characters): Chinese characters/full-width punctuation count as 2 columns; ASCII letters, digits, spaces and punctuation count as 1. Mixed titles use the summed width; shorter is still preferred. The entire title, including descriptions and issue numbers, is validated with Pi's display-width helper. Over-budget output gets one model rewrite, never blind truncation; if it still exceeds the budget, naming fails and the current name is kept. Unchanged tasks keep their previous title only if it already meets these brevity rules.
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
💤 #123 修复登录超时
📖 #123 修复登录超时
🤖 #123 修复登录超时
```

- The purple title mirrors Pi's session name on startup and every rename, including manual `/name`; unnamed sessions hide the title. Herdr never generates or independently stores a task name.
- Sending a message switches to `🚀`; finishing a response does not change the mark.
- `Alt+M` switches `🚀 → 📖`, then cycles `📖 ↔ 💤`.
- `📖` is a manual bookmark for a valuable conversation to revisit, not an unread-result notification. Viewing the agent does not clear it.
- Marks and counts live only in memory. Initialization (including reload/resume) starts at `💤` with zero subagents; previous marks and running counts are not restored or written to session history.
- Any running subagent temporarily replaces the task mark with `🤖`; no count or suffix is displayed. When all subagents finish, the original mark returns. `Alt+M` still changes the underlying mark while the robot is visible.
- Counting uses `@tintinweb/pi-subagents`'s `subagents:started/completed/failed` events (verified with `0.19.0`), covering top-level foreground/background agents, failure, cancellation, and resume. Queued agents are not counted until they start. That version does **not** expose workflow/nested child lifecycles or a numeric registry API, so those children cannot be counted. The older unscoped `pi-subagents` package in the optional package reference uses a different contract and does not provide this counter; it is not replaced automatically.
- This changes display metadata only: it never pauses a task or overrides Herdr's actual lifecycle indicator on the first line.
- Only interactive Pi inside Herdr enables this extension. Reports are scoped to the calling pane and sent on initialization and mark/count/name changes, with fields cleared on normal shutdown. There is no heartbeat or TTL, so a crash may leave stale display metadata.
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

Built and tested against Pi `0.82.1`. Renderer prototype styling is best-effort because those internals are not a stable extension API.

## Attribution

The chat-input renderer and companion animation are adapted from Adrian Apan's MIT-licensed Pikit project. See `THIRD_PARTY_NOTICES.md`.
