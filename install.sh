#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
POLICY_FILE="${PACKAGE_POLICY_FILE:-$SCRIPT_DIR/config/packages.json}"
GLOBAL_AGENTS_POLICY_FILE="${PACKAGE_GLOBAL_AGENTS_FILE:-$SCRIPT_DIR/config/global-agents.md}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SETTINGS_FILE="$AGENT_DIR/settings.json"
GLOBAL_AGENTS_FILE="$AGENT_DIR/AGENTS.md"
PI_BIN="${PI_BIN:-pi}"
RTK_COMMAND="${RTK_COMMAND:-rtk}"
RTK_INSTALL_URL="https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh"

PATH="$HOME/.local/bin:$PATH"
export PATH

fail() {
  printf 'my-pi-package: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "node is required"
if [[ "$PI_BIN" == */* ]]; then
  [[ -x "$PI_BIN" ]] || fail "pi executable not found"
else
  command -v "$PI_BIN" >/dev/null 2>&1 || fail "pi is required"
fi
[[ -f "$POLICY_FILE" ]] || fail "missing package policy"
[[ -f "$GLOBAL_AGENTS_POLICY_FILE" ]] || fail "missing global AGENTS policy"

POLICY_SOURCES=$(node -e '
  const fs = require("node:fs");
  const policy = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const globalAgentsPolicy = fs.readFileSync(process.argv[2], "utf8").trim();
  const globalAgentsMarkers = ["<!-- my-pi-package:global-agents:start -->", "<!-- my-pi-package:global-agents:end -->"];
  if (!globalAgentsPolicy || globalAgentsMarkers.some((marker) => globalAgentsPolicy.includes(marker))) {
    throw new Error("global-agents.md must be non-empty and must not contain management markers");
  }
  const matt = policy.mattPocockSkills;
  const npmSource = /^npm:(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
  if (!Array.isArray(policy.packages) || !policy.packages.every((source) => typeof source === "string" && npmSource.test(source))) {
    throw new Error("packages.json packages must contain only unpinned npm package sources");
  }
  if (new Set(policy.packages).size !== policy.packages.length) {
    throw new Error("packages.json packages must not contain duplicates");
  }
  if (!matt || matt.source !== "git:github.com/mattpocock/skills@release/v1.2" || !Array.isArray(matt.skills)) {
    throw new Error("packages.json must define the release/v1.2 Matt Pocock skill package and filter");
  }
  const skillPath = /^skills\/(?:engineering|productivity)\/[a-z0-9-]+\/SKILL\.md$/;
  if (matt.skills.length !== 15 || !matt.skills.every((skill) => typeof skill === "string" && skillPath.test(skill))) {
    throw new Error("packages.json must contain 15 exact Matt Pocock SKILL.md paths");
  }
  if (new Set(matt.skills).size !== matt.skills.length) {
    throw new Error("packages.json Matt Pocock skills must not contain duplicates");
  }
  for (const key of ["extensions", "prompts", "themes"]) {
    if (!Array.isArray(matt[key]) || matt[key].length !== 0) {
      throw new Error(`packages.json mattPocockSkills.${key} must be empty`);
    }
  }
  for (const source of policy.packages) console.log(source);
  console.log(matt.source);
' "$POLICY_FILE" "$GLOBAL_AGENTS_POLICY_FILE")

candidate="${MY_PI_PACKAGE_SOURCE:-}"
if [[ -z "$candidate" ]]; then
  command -v git >/dev/null 2>&1 || fail "git is required to discover the package source"
  candidate=$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null) || \
    fail "set MY_PI_PACKAGE_SOURCE or configure a GitHub origin remote"
fi

SELF_SOURCE=$(CANDIDATE="$candidate" node <<'NODE'
const raw = (process.env.CANDIDATE || "").trim();
function reject() {
  console.error("my-pi-package: package source must be an unpinned, credential-free GitHub my-pi-package repository");
  process.exit(1);
}
if (!raw || /[?#]/.test(raw)) reject();
let source = raw;
let owner;
let match;
if ((match = raw.match(/^git:github\.com\/([^/@]+)\/my-pi-package(?:\.git)?$/i))) {
  owner = match[1];
  source = `git:github.com/${owner}/my-pi-package`;
} else if ((match = raw.match(/^(?:git:)?git@github\.com:([^/@]+)\/my-pi-package(?:\.git)?$/i))) {
  owner = match[1];
  source = `git:git@github.com:${owner}/my-pi-package`;
} else if ((match = raw.match(/^ssh:\/\/git@github\.com\/([^/@]+)\/my-pi-package(?:\.git)?$/i))) {
  owner = match[1];
  source = `ssh://git@github.com/${owner}/my-pi-package`;
} else if (/^https:\/\//i.test(raw)) {
  let url;
  try { url = new URL(raw); } catch { reject(); }
  if (url.hostname.toLowerCase() !== "github.com" || url.username || url.password) reject();
  match = url.pathname.match(/^\/([^/@]+)\/my-pi-package(?:\.git)?$/i);
  if (!match) reject();
  owner = match[1];
  source = `https://github.com/${owner}/my-pi-package`;
} else {
  reject();
}
if (!owner) reject();
process.stdout.write(source);
NODE
) || exit $?

mapfile -t PACKAGE_SOURCES <<< "$POLICY_SOURCES"

if ! command -v "$RTK_COMMAND" >/dev/null 2>&1; then
  [[ "$(uname -s)" == "Linux" ]] || fail "automatic RTK installation is supported only on Linux"
  command -v curl >/dev/null 2>&1 || fail "curl is required to install RTK"
  printf 'Installing RTK...\n'
  curl -fsSL "$RTK_INSTALL_URL" | sh
  if ! command -v "$RTK_COMMAND" >/dev/null 2>&1 && [[ ! -x "$HOME/.local/bin/rtk" ]]; then
    fail "RTK installer completed but rtk was not found"
  fi
fi

printf 'Registering %s...\n' "$SELF_SOURCE"
"$PI_BIN" install "$SELF_SOURCE"
for source in "${PACKAGE_SOURCES[@]}"; do
  printf 'Installing %s...\n' "$source"
  "$PI_BIN" install "$source"
done

mkdir -p "$AGENT_DIR"
POLICY_FILE="$POLICY_FILE" SETTINGS_FILE="$SETTINGS_FILE" SELF_SOURCE="$SELF_SOURCE" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const settingsPath = process.env.SETTINGS_FILE;
const policy = JSON.parse(fs.readFileSync(process.env.POLICY_FILE, "utf8"));
const selfSource = process.env.SELF_SOURCE;
if (!settingsPath || !selfSource || !Array.isArray(policy.packages) || !policy.mattPocockSkills?.source) {
  throw new Error("Invalid installer policy");
}

function sourceOf(entry) {
  return typeof entry === "string" ? entry : entry && typeof entry === "object" ? entry.source : undefined;
}

function npmIdentity(source) {
  if (typeof source !== "string" || !source.startsWith("npm:")) return undefined;
  const body = source.slice(4);
  if (body.startsWith("@")) {
    const slash = body.indexOf("/");
    const version = body.lastIndexOf("@");
    return version > slash ? `npm:${body.slice(0, version)}` : `npm:${body}`;
  }
  return `npm:${body.split("@")[0]}`;
}

function gitIdentity(source) {
  if (typeof source !== "string") return undefined;
  let value = source.startsWith("git:") ? source.slice(4) : source;
  let host;
  let pathname;
  const scp = value.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  if (scp && !value.includes("://")) {
    host = scp[1];
    pathname = scp[2];
  } else if (/^[^/]+\/.+/.test(value) && !value.includes("://")) {
    const slash = value.indexOf("/");
    host = value.slice(0, slash);
    pathname = value.slice(slash + 1);
  } else {
    try {
      const url = new URL(value);
      host = url.hostname;
      pathname = url.pathname;
    } catch {
      return undefined;
    }
  }
  pathname = pathname.replace(/^\/+/, "").replace(/\.git(?:@.*)?$/i, "").replace(/@.*$/, "");
  if (!host || !pathname) return undefined;
  return `git:${host.toLowerCase()}/${pathname.toLowerCase()}`;
}

function identity(source) {
  return npmIdentity(source) || gitIdentity(source) || (typeof source === "string" ? `local:${source}` : undefined);
}

const matt = {
  source: policy.mattPocockSkills.source,
  extensions: [],
  skills: [...policy.mattPocockSkills.skills],
  prompts: [],
  themes: [],
};
const desired = [selfSource, ...policy.packages, matt];
const desiredByIdentity = new Map(desired.map((entry) => [identity(sourceOf(entry)), entry]));
if ([...desiredByIdentity.keys()].some((key) => !key)) throw new Error("Policy contains an invalid package source");

const lockPath = `${settingsPath}.lock`;
fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
let locked = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
    locked = true;
    break;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
if (!locked) throw new Error(`Timed out waiting for settings lock: ${lockPath}`);

try {
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("settings.json must contain a JSON object");
  }
  if (settings.packages !== undefined && !Array.isArray(settings.packages)) {
    throw new Error("settings.json packages must be an array");
  }

  const seen = new Set();
  const packages = [];
  for (const entry of settings.packages || []) {
    const key = identity(sourceOf(entry));
    if (key && desiredByIdentity.has(key)) {
      if (seen.has(key)) continue;
      packages.push(desiredByIdentity.get(key));
      seen.add(key);
    } else {
      packages.push(entry);
    }
  }
  for (const entry of desired) {
    const key = identity(sourceOf(entry));
    if (!seen.has(key)) {
      packages.push(entry);
      seen.add(key);
    }
  }

  if ((settings.packages || []).some((entry) => {
    const source = sourceOf(entry);
    return typeof source === "string" && /(?:^|[\\/])pikit-ui(?:\.git)?$/i.test(source);
  })) {
    console.error("my-pi-package: warning: legacy duplicate Pikit UI package remains registered; remove it manually after verification");
  }

  settings.packages = packages;
  settings.theme = "slop";
  const serialized = `${JSON.stringify(settings, null, 2)}\n`;
  const target = fs.existsSync(settingsPath) && fs.lstatSync(settingsPath).isSymbolicLink()
    ? fs.realpathSync(settingsPath)
    : settingsPath;
  const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o600;
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, serialized, { encoding: "utf8", mode });
  fs.renameSync(temporary, target);
} finally {
  fs.rmSync(lockPath, { recursive: true, force: true });
}
NODE

GLOBAL_AGENTS_POLICY_FILE="$GLOBAL_AGENTS_POLICY_FILE" GLOBAL_AGENTS_FILE="$GLOBAL_AGENTS_FILE" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const policyPath = process.env.GLOBAL_AGENTS_POLICY_FILE;
const agentsPath = process.env.GLOBAL_AGENTS_FILE;
const startMarker = "<!-- my-pi-package:global-agents:start -->";
const endMarker = "<!-- my-pi-package:global-agents:end -->";
if (!policyPath || !agentsPath) throw new Error("Invalid global AGENTS policy paths");

const policy = fs.readFileSync(policyPath, "utf8").trim();
if (!policy || policy.includes(startMarker) || policy.includes(endMarker)) {
  throw new Error("Global AGENTS policy must be non-empty and must not contain management markers");
}
const managed = `${startMarker}\n${policy}\n${endMarker}`;

fs.mkdirSync(path.dirname(agentsPath), { recursive: true, mode: 0o700 });
const lockPath = `${agentsPath}.lock`;
let locked = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
    locked = true;
    break;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
if (!locked) throw new Error(`Timed out waiting for AGENTS lock: ${lockPath}`);

try {
  const current = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") : "";
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  let next;

  if (start !== -1 || end !== -1) {
    if (start === -1 || end === -1 || end < start || current.indexOf(startMarker, start + 1) !== -1 || current.indexOf(endMarker, end + 1) !== -1) {
      throw new Error(`Refusing to modify malformed managed block in ${agentsPath}`);
    }
    next = `${current.slice(0, start)}${managed}${current.slice(end + endMarker.length)}`;
  } else {
    const unmanaged = current.indexOf(policy);
    if (unmanaged !== -1) {
      if (current.indexOf(policy, unmanaged + policy.length) !== -1) {
        throw new Error(`Refusing to migrate duplicate global AGENTS policies in ${agentsPath}`);
      }
      next = `${current.slice(0, unmanaged)}${managed}${current.slice(unmanaged + policy.length)}`;
    } else if (current.trim().length === 0) {
      next = `${managed}\n`;
    } else {
      const separator = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
      next = `${current}${separator}${managed}\n`;
    }
  }

  if (next !== current) {
    const target = fs.existsSync(agentsPath) && fs.lstatSync(agentsPath).isSymbolicLink()
      ? fs.realpathSync(agentsPath)
      : agentsPath;
    const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o600;
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, next, { encoding: "utf8", mode });
    fs.renameSync(temporary, target);
  }
} finally {
  fs.rmSync(lockPath, { recursive: true, force: true });
}
NODE

warn_path() {
  if [[ -e "$1" ]]; then
    printf 'my-pi-package: warning: legacy duplicate remains at %s; remove it manually after verification\n' "$1" >&2
  fi
}

warn_path "$AGENT_DIR/extensions/memory"
warn_path "$AGENT_DIR/extensions/openai-usage.ts"
warn_path "$AGENT_DIR/prompts/Get-Shit-Done.md"
warn_path "$AGENT_DIR/prompts/Neat-Freak.md"
warn_path "$AGENT_DIR/prompts/tidy-memory.md"

for skill in \
  ask-matt code-review diagnosing-bugs domain-modeling grill-with-docs implement \
  setup-matt-pocock-skills tdd to-spec to-tickets wayfinder grill-me grilling \
  handoff writing-for-agents; do
  warn_path "$HOME/.agents/skills/$skill"
done

printf '\nInstallation complete. Restart Pi to load the package and slop theme.\n'
printf 'Legacy resources were only reported; nothing was deleted or moved.\n'
