# 09 — Cluster E: Harness

**R10 loop runtime · R11 Agent Skills spec conformance · R12 Ralph implementations**

Researched 11 Aug 2026. All version numbers and flag names below were read from
primary sources on that date (docs.claude.com / code.claude.com, agentskills.io,
npm + PyPI registries, and the plugin cache on this machine). Secondary sources
are marked.

**Verification legend**

- Unmarked claims = read directly from a primary source listed in §Sources.
- **[inference]** = my reasoning, not stated by any source.
- **[unverified]** = I could not confirm this still holds in Aug 2026; treat as
  a lead, not a fact.

---

## Part 0 — TL;DR

| Question | Answer |
|---|---|
| R10 — what runs the loop? | **Claude Agent SDK (TypeScript, `@anthropic-ai/claude-agent-sdk@0.3.228`)**, one `query()` call per migration unit, no `resume`. Not headless, not bash. |
| R11 — are we spec-conformant? | Spec is small and stable. Six frontmatter fields, only two required. `skills/` in this repo is currently **empty** — nothing to fix yet, and a conformance checklist is in §R11.7. |
| R12 — what do we fork? | **Nothing wholesale.** Fork *ideas* from three places: the promise-tag completion protocol (official `ralph-loop` plugin), the `prd.json`/`progress.txt` state split (snarktank/ralph), and the circuit breaker (frankbria). Write ~200 lines of our own driver. |

The single most important finding for us: **the fresh-context-per-iteration
property that makes Ralph work is free in the Agent SDK.** Every `query()` call
without `resume` or `continue` is a brand-new session with a brand-new context
window. The whole reason Ralph is a bash loop in Huntley's original — that the
CLI had no other way to force a context reset — does not apply to us.

---

## R10 — Loop runtime: Agent SDK vs Claude Code headless vs shell `while`

### R10.1 The three candidates, precisely

**(a) Claude Agent SDK.** A library that runs Claude Code's agent loop in your
own process. Two packages:

| | Package | Version on 11 Aug 2026 | Notes |
|---|---|---|---|
| TypeScript | `@anthropic-ai/claude-agent-sdk` | **0.3.228** (registry `modified: 2026-08-11T19:55Z`, 262 published versions) | |
| Python | `claude-agent-sdk` | **0.2.136** | requires Python ≥3.10; deps `anyio>=4`, `mcp>=1.23,<2`, `sniffio`; optional extra `otel` pulls `opentelemetry-api>=1.20` |

Both SDKs **bundle a native Claude Code binary**, so most installs need no
separate Claude Code install. The SDK is Python/TypeScript only — the docs
explicitly say that to drive the same loop from another language you should run
the CLI as a subprocess with `-p --output-format json`.

Note the licensing line in the docs: SDK use is governed by Anthropic's
Commercial Terms, and **third-party developers are not permitted to offer
claude.ai login or subscription rate limits through SDK-built products without
prior approval** — use API-key auth. For an internal migration tool this is
moot, but it matters if the migration agent ever ships to a customer.

**(b) Claude Code headless (`claude -p`).** Same binary, non-interactive. The
docs now frame `claude -p` as *"the Agent SDK via the CLI"* — it is not a
separate product, it is the same agent loop with a process boundary and JSON on
stdout instead of typed objects in memory.

**(c) Plain shell `while` loop.** `while :; do cat PROMPT.md | claude; done`.
This is Huntley's original formulation and what claytonfarr's playbook still
recommends. It is (b) with a bash wrapper you write yourself.

### R10.2 Comparison across the eight axes

#### Session / context control

| | Agent SDK | `claude -p` | shell `while` |
|---|---|---|---|
| New context per iteration | Default. Each `query()` with no `resume`/`continue` is a fresh session. | Default. Each process invocation is a fresh session. | Default (it's (b)). |
| Suppress transcript writes | `persistSession: false` (TS only); Python uses `CLAUDE_CODE_SKIP_PROMPT_HISTORY` in `env` | no documented equivalent **[unverified]** | same as (b) |
| Deliberate context accumulation | `continue: true` / `resume: <id>` / `forkSession: true` | `--continue`, `--resume`, `--fork-session`, `--session-id <uuid>` | same as (b) |
| Compaction visibility | `compact_boundary` system message in the stream; `PreCompact` hook | `compact_boundary` in `stream-json` | must parse `stream-json` yourself |
| Control what survives compaction | CLAUDE.md is re-injected every request (compaction summary can drop prompt instructions) | same | same |

All three get fresh context per iteration for free. This is worth stating
plainly because the Ralph literature treats it as the hard-won prize.

Nuance that will bite us: the docs say persistent rules belong in **CLAUDE.md,
not the initial prompt**, because CLAUDE.md is re-injected on every request
while early prompt content can be summarized away by compaction. For a
migration agent that must never violate a shim contract, the contract belongs
in CLAUDE.md (or a skill), not in the loop prompt.

#### Resumability

- **SDK:** `resume=<session_id>` restores full prior context; `fork_session=True`
  branches. Session IDs come off `ResultMessage.session_id`, present on *every*
  result including errors. `listSessions()` / `getSessionMessages()` /
  `getSessionInfo()` / `renameSession()` / `tagSession()` (and Python snake_case
  equivalents) let you build your own session index.
- **`claude -p`:** `--resume <id>`, `--continue`, `--fork-session`,
  `--session-id <uuid>` (pre-assign a UUID — useful for correlating with your
  own job table).
- **Storage:** `~/.claude/projects/<encoded-cwd>/*.jsonl`, where `<encoded-cwd>`
  is the absolute cwd with every non-alphanumeric char replaced by `-`.
  Overridable via `CLAUDE_CONFIG_DIR`. Since **v2.1.223** resume searches beyond
  the current project dir; older bundled CLIs are scoped to the project dir and
  its worktrees.
- **Cross-host:** session files are machine-local. Either ship the `.jsonl`, or
  use a `sessionStore` / `session_store` adapter to mirror transcripts to your
  own backend. The docs' own recommendation — and mine — is the third option:
  **don't rely on resume; capture the results you need as application state and
  feed them into a fresh session.** That is exactly the Ralph model.

#### Hooks

Both SDK and CLI expose the same hook events. The SDK's decisive advantage is
*where the hook runs*: **hooks run in your application process, not in the
agent's context window, so they cost zero tokens.**

| Hook | Fires | Our likely use |
|---|---|---|
| `PreToolUse` | before a tool executes | block edits outside `react/`; block `git push` |
| `PostToolUse` | after a tool returns | run the oracle diff after every `Write` to a component |
| `UserPromptSubmit` | on prompt send | inject the current census row |
| `Stop` | agent finishes | **this is where the official Ralph plugin lives** — see R12.2 |
| `SubagentStart` / `SubagentStop` | subagent lifecycle | per-component cost attribution |
| `PreCompact` | before compaction | archive transcript; should not fire if iterations stay short |

The TypeScript SDK supports strictly more hook events than Python. That is one
of two reasons I recommend TS over Python below.

#### Cost controls and spend caps

This is where the three options genuinely diverge, and it is the deciding axis.

**Agent SDK** (fields on `ClaudeAgentOptions` / `Options`):

| Option | Effect | Default |
|---|---|---|
| `max_turns` / `maxTurns` | cap tool-use round trips | no limit |
| `max_budget_usd` / `maxBudgetUsd` | cap spend, then stop | no limit |
| `effort` | `low` / `medium` / `high` / `xhigh` / `max` | model default |

Hitting a cap yields a `ResultMessage` with subtype `error_max_turns` or
`error_max_budget_usd`. **Subagent spend counts toward `maxBudgetUsd`**; once
the cap is hit, spawning another subagent fails with `Budget limit reached` and
background subagents are stopped. That enforcement requires **Claude Code
v2.1.217+**.

**`claude -p`** has the same two caps as flags: `--max-turns N` and
`--max-budget-usd 5.00` (both print-mode only; subagent spend counts toward the
latter). So headless is *not* worse than the SDK on per-invocation caps.

**Where they diverge is the global cap.** Neither gives you a cross-iteration
budget. You must accumulate it yourself:

- SDK: read `message.total_cost_usd` off each result, sum in a variable, stop
  the loop. One process, one number, trivially correct.
- Headless: `--output-format json | jq -r '.total_cost_usd'`, sum in bash across
  processes. Works, but bash float arithmetic requires `bc`/`awk` and the
  failure mode is silent.
- Shell `while`: same as headless with more of your own code.

**Critical caveat, stated in the docs as a warning:** `total_cost_usd` and
`costUSD` are **client-side estimates** computed from a price table bundled at
SDK build time. They drift when pricing changes or when the installed SDK
doesn't recognize a model. The docs say explicitly: do not bill end users or
trigger financial decisions from these fields; use the Usage and Cost API or
the Console for authoritative numbers.

→ **[inference]** For a migration run we should treat the estimate as a
*governor*, not an *accountant*: set the loop's hard stop at ~70% of the real
budget so estimate drift can't overrun, and reconcile against the Usage and Cost
API after each batch.

Per-model breakdown: `modelUsage` / `model_usage` on the result message includes
subagent spend; the plain `usage` field **excludes subagents and will undercount
as soon as we use them.** Use `modelUsage` for whole-tree accounting. Also
deduplicate assistant messages by `message.message.id` before summing per-step
tokens — parallel tool calls emit multiple messages sharing one id with
identical usage.

Prompt caching: automatic, 5-minute TTL by default on API-key auth. Because our
loop runs many short sessions against the same system prompt and CLAUDE.md,
gaps >5 min between iterations mean each iteration pays full input price. Set
`ENABLE_PROMPT_CACHING_1H=1` to request a 1-hour TTL (1h cache *writes* cost
more, so it's a trade — worth it only if iterations are spaced out).

**[unverified]** A secondary blog (totalum.app) claims that from 15 June 2026,
Agent SDK and `claude -p` usage on Claude *subscription* plans draws from a
separate monthly "Agent SDK credit" pool. I could not confirm this on any
Anthropic primary source and I am not treating it as fact. If we plan to run on
a subscription rather than an API key, verify this before budgeting. The SDK
overview's note that third parties may not offer claude.ai login/rate limits
through SDK products is a *related* but distinct restriction, and that one is
confirmed.

#### Concurrency

| | Approach | Isolation |
|---|---|---|
| SDK | N concurrent `query()` calls in one async process; or `Agent` tool subagents inside one query | Same process. Needs per-worker `cwd` (git worktrees) to avoid file collisions. |
| `claude -p` | N OS processes | Process-level. Natural fit for worktrees. |
| shell | `xargs -P` / `&` | Same as headless, no supervision. |

Read-only tools (`Read`, `Glob`, `Grep`, read-only MCP tools) already run
concurrently *within* a turn; state-mutating tools (`Edit`, `Write`, `Bash`) are
serialized. Custom tools default to sequential unless annotated with
`readOnlyHint`.

**[inference]** For a per-component migration, the natural unit of parallelism
is one component per git worktree. All three runtimes support this equally
(`--add-dir` / `cwd`), so concurrency is *not* a differentiating axis. The SDK
wins only slightly, by letting a single supervisor process hold the global
budget counter that all workers decrement.

#### Observability and tracing

OpenTelemetry is a property of the **Claude Code binary**, so it works
identically for SDK and headless:

```
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp        # otlp | prometheus | console | none
OTEL_LOGS_EXPORTER=otlp           # otlp | console | none
OTEL_TRACES_EXPORTER=otlp         # beta; also needs CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

Metrics: `claude_code.session.count`, `.cost.usage`, `.token.usage`,
`.lines_of_code.count`, `.commit.count`, `.pull_request.count`,
`.code_edit_tool.decision`, `.active_time.total`.
Events: `user_prompt`, `assistant_response`, `api_request`, `api_error`,
`tool_result`, `tool_decision`, `mcp_server_connection`, `plugin_loaded`.
Every metric/event carries `session.id`, `app.version`, `user.id`, and
`prompt.id` — **`prompt.id` correlates every API call and tool execution back
to the prompt that triggered them**, which is exactly the join key we want for
per-component cost attribution.

Beta trace span hierarchy: `claude_code.interaction` → `claude_code.llm_request`
and `claude_code.tool` → `.tool.blocked_on_user` / `.tool.execution`.

Content logging is off by default; `OTEL_LOG_USER_PROMPTS`,
`OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT`,
`OTEL_LOG_RAW_API_BODIES` opt in. Team tagging via
`OTEL_RESOURCE_ATTRIBUTES="team.id=migration,cost_center=..."`.

Where the SDK pulls ahead: **the message stream itself is the trace.** In-process
you get typed `SystemMessage` / `AssistantMessage` / `UserMessage` / `StreamEvent`
/ `ResultMessage` objects with no JSON parsing, no `jq`, and no risk of a
truncated stdout. Headless gives you the same information but as newline-delimited
JSON you must parse and reassemble. Also useful in both: `system/api_retry`
events (`attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`
category) let us distinguish "rate limited" from "genuinely failing" — important
for the drift detection in R12.

#### MCP tool wiring

| | SDK | `claude -p` |
|---|---|---|
| Configure | `mcpServers` in options; in-process SDK MCP servers | `--mcp-config <file-or-json>` (space-separated), `--strict-mcp-config` |
| Startup gating | waits for pending servers up to `MCP_TIMEOUT` (30s default) | same; requires v2.1.221+ |
| Failure detection | `mcp_servers` and `mcp_server_errors` on the `system/init` message | same fields in `stream-json` |
| Schema context cost | MCP tool search defers MCP schemas by default, loads on demand | same |

`mcp_server_errors` entries have `name`, `type` (`unknown_type`,
`url_missing_type`, `invalid_config`, `reserved_name`), and `message`; the key is
**omitted** when there are no errors — so a CI gate is "fail if this key exists
and is non-empty." Note the silent-failure trap: an invalid `--mcp-config` entry
is *skipped*, the run *continues*, and it *exits cleanly*. If our oracle or
census is exposed over MCP, a config typo produces a full migration run that
silently skipped verification. Gate on `mcp_server_errors` and on
`plugin_errors` at iteration 1.

#### Fresh-context-per-iteration model

| | How you get it | Cost |
|---|---|---|
| SDK | just call `query()` again without `resume` | one in-process call; binary stays warm |
| `claude -p` | just invoke again | full process spawn per iteration |
| shell | same | same, plus you own the wrapper |

Process-spawn cost is the reason `--bare` exists: it skips auto-discovery of
hooks, skills, plugins, MCP servers, auto memory, and CLAUDE.md. The docs say
`--bare` is *recommended for scripted and SDK calls and will become the default
for `-p`*. But note the trap for us: **`--bare` also skips skills and CLAUDE.md**,
which are precisely the mechanisms we plan to use to carry migration rules
across fresh contexts. If we go headless, we must NOT use `--bare` — or we must
re-supply everything via `--append-system-prompt-file`, `--settings`,
`--mcp-config`, `--plugin-dir`.

Two more headless-only footguns worth recording:

- Background Bash tasks are killed ~5s after the final result. Background
  *subagents* are waited on, capped at 10 min by default
  (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`).
- SIGTERM aborts the turn, kills the Bash process tree, runs `SessionEnd` hooks,
  exits **143**. Useful for a supervisor's hard timeout.
- Piped stdin caps at 10MB. A large census or diff must be a file path in the
  prompt, not a pipe.

### R10.3 Recommendation

**Use the Claude Agent SDK (TypeScript, `@anthropic-ai/claude-agent-sdk@0.3.228`)
as the loop runtime. Write our own ~200-line driver. Do not use `claude -p` as
the loop primitive, and do not use a bash `while` loop.**

Pin the version. At 262 published versions and a release the same day I looked,
this package moves fast; an unpinned `^0.3` will drift under us mid-migration.

Shape:

```ts
for (const unit of censusUnits) {
  for (let i = 0; i < MAX_ITERS && !unit.done; i++) {
    if (spentUsd > GLOBAL_CAP) throw new BudgetExhausted();
    for await (const m of query({
      prompt: renderPrompt(unit, i),          // fresh context: no resume
      options: {
        settingSources: ["project"],           // CLAUDE.md + .claude/skills
        allowedTools: [...],
        permissionMode: "acceptEdits",
        maxTurns: 40,
        maxBudgetUsd: 3.00,                    // per-iteration governor
        hooks: { PostToolUse: [runOracle], PreToolUse: [guardPaths] },
        mcpServers: { oracle, census },
        cwd: unit.worktree,
      },
    })) {
      if (m.type === "result") {
        spentUsd += m.total_cost_usd;          // client-side estimate
        unit.done = detectCompletion(m);       // see R12.5
      }
    }
  }
}
```

**Trade-offs, stated as trade-offs:**

*Choosing the SDK costs us:*

1. **Language lock-in.** Node or Python only. If the migration tooling were Go
   or Rust, headless would be the only option. Our repo already has
   `package.json`, `jest.config.cjs`, and a `node_modules/` — so Node is not a
   new dependency. This cost is near zero for us specifically.
2. **Version churn.** 262 versions and daily releases. Headless via a pinned
   `claude` binary has a slower-moving surface. Mitigation: pin exactly, upgrade
   deliberately, keep the driver's use of the API narrow (`query`, `Options`,
   `ResultMessage`, hooks).
3. **Experimental-API risk.** The V2 session API (`createSession()`) was
   *removed* in TS SDK 0.3.142. That is a real precedent for breaking changes.
   Mitigation: use only `query()` + options, which is the documented stable path.
4. **A process boundary is a real safety feature we give up.** A `claude -p`
   worker that wedges can be `kill -TERM`'d, exits 143, and the supervisor moves
   on. An in-process `query()` that wedges takes the supervisor with it.
   **[inference]** Mitigation: run the supervisor as a thin parent that forks
   one Node child per worktree, each child running one SDK loop. That recovers
   process isolation without giving up typed messages or in-process hooks.

*Choosing the SDK buys us:*

1. **Zero-token hooks at the exact points our oracle needs them.** `PostToolUse`
   running the render-diff oracle after each `Write` is the single highest-value
   thing in this design, and it costs no context. Doing the equivalent headless
   means either a filesystem hook (fine) or post-hoc parsing of `stream-json`
   (fragile).
2. **The budget counter and the loop live in the same process.** One float, no
   `bc`, no lost-output race. Given that the estimate is already lossy, adding
   bash arithmetic on top is compounding avoidable error.
3. **Typed result handling.** `subtype` is an enum, not a grep. Distinguishing
   `success` / `error_max_turns` / `error_max_budget_usd` / `error_during_execution`
   drives completely different retry policies, and getting that wrong is how
   drift becomes an overnight burn.
4. **`--bare` doesn't apply.** We never face the "fast startup vs. loses skills
   and CLAUDE.md" dilemma, because there is no per-iteration process spawn.

*Why not plain bash:* it is strictly dominated. It is headless mode with the
supervision, cost accounting, error classification, and structured logging
deleted — every one of which we would immediately re-implement in a language
less suited to it. The historical reason Ralph is a bash loop is that when
Huntley wrote it, `claude` had no other interface. That is no longer true.

*When I would change this answer:* if the migration driver needed to run
somewhere with no Node runtime, or if we wanted the loop orchestrated by an
existing CI system (GitHub Actions matrix, Nomad, k8s Jobs) rather than by our
own supervisor. In that world `claude -p --max-turns N --max-budget-usd X
--output-format json` per job, with the CI system as the loop, is the better
answer — the scheduler already provides the supervision the SDK would otherwise
give us.

---

## R11 — Agent Skills spec conformance

### R11.1 Provenance and current status

Format originally developed by Anthropic, released as an open standard.
Specification lives at **agentskills.io/specification**; repo at
**github.com/agentskills/agentskills** (code Apache-2.0, docs CC-BY-4.0).

The standard is real and broadly adopted as of Aug 2026 — the client showcase
lists Claude Code, Claude, ChatGPT/Codex, Cursor, VS Code / GitHub Copilot,
Gemini CLI, OpenCode, OpenHands, Goose, Amp, Kiro, Factory, Roo Code, Letta,
Snowflake Cortex Code, Databricks Genie Code, Spring AI, Laravel Boost, and
~25 more. **[unverified]** The task brief's "announced Oct 2025, open-sourced
Dec 2025" dates are plausible and consistent with what I read, but neither date
appears on the spec site or the repo landing page I fetched, so I am not
asserting them.

**Current state of this repo:** `C:\Users\shikh\LWCTOReactConversion\skills\`
exists and is **empty**. There is nothing to bring into conformance yet, which
is the good case — we get to be conformant by construction.

### R11.2 Directory layout (normative)

```
skill-name/
├── SKILL.md          # REQUIRED: YAML frontmatter + Markdown body
├── scripts/          # optional: executable code
├── references/       # optional: docs loaded on demand
├── assets/           # optional: templates, images, data files
└── ...               # any additional files or directories
```

Only `SKILL.md` is required. The three subdirectory names are **conventions, not
requirements** — the spec says a skill directory "may contain any files and
directories beyond the required `SKILL.md`."

### R11.3 Frontmatter — the exact fields

The spec defines **exactly six** fields. Two required, four optional.

| Field | Required | Constraints |
|---|---|---|
| `name` | **Yes** | 1–64 chars. Lowercase alphanumeric (`a-z`, `0-9`) and hyphens only. Must not start or end with `-`. Must not contain `--`. **Must match the parent directory name.** |
| `description` | **Yes** | 1–1024 chars, non-empty. Should state *what it does* **and** *when to use it*, with keywords that help matching. |
| `license` | No | License name, or reference to a bundled license file. Keep short. |
| `compatibility` | No | 1–500 chars. Environment requirements (target product, system packages, network access). Most skills don't need it. |
| `metadata` | No | Map of string keys → string values. For client-specific properties outside the spec. Use namespaced keys to avoid collisions. |
| `allowed-tools` | No | Space-separated string of pre-approved tools. **Experimental — support varies between implementations.** |

Minimal conformant skill:

```markdown
---
name: skill-name
description: A description of what this skill does and when to use it.
---
```

With options:

```markdown
---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
license: Apache-2.0
compatibility: Requires Python 3.14+ and uv
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Bash(jq:*) Read
---
```

Invalid `name` examples from the spec: `PDF-Processing` (uppercase), `-pdf`
(leading hyphen), `pdf--processing` (consecutive hyphens).

### R11.4 The three-tier progressive-disclosure model

| Tier | What loads | When | Budget |
|---|---|---|---|
| 1. **Metadata** | `name` + `description` only | at startup, for *every* available skill | **~100 tokens** per skill |
| 2. **Instructions** | the full `SKILL.md` body | on activation (description matched, or user invoked) | **< 5000 tokens recommended** |
| 3. **Resources** | files under `scripts/`, `references/`, `assets/` | only when the body tells the agent to read/run them | unbounded, pay-per-use |

Hard guidance from the spec: **keep `SKILL.md` under 500 lines**; move detail to
separate files. File references use **relative paths from the skill root**
(`references/REFERENCE.md`, `scripts/extract.py`) and should stay **one level
deep** — avoid nested reference chains.

### R11.5 Discovery and loading — Claude Code specifics

The spec covers the *format*; Claude Code adds discovery rules and extra
frontmatter. Both matter to us because Claude Code is our runtime.

**Where skills live:**

| Level | Path | Scope |
|---|---|---|
| Personal | `~/.claude/skills/<name>/SKILL.md` | all your projects |
| Project | `.claude/skills/<name>/SKILL.md` | this project |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | where the plugin is enabled |

**Precedence: enterprise > personal > project.** (Note the direction — personal
overrides project, which is the opposite of most tools' intuition.) Any of these
overrides a bundled skill of the same name. Plugin skills are namespaced
`plugin-name:skill-name` and cannot conflict.

Other loading rules that affect our layout:

- **Custom commands merged into skills.** `.claude/commands/deploy.md` and
  `.claude/skills/deploy/SKILL.md` both produce `/deploy`. Skills additionally
  get a directory, invocation-control frontmatter, and model auto-invocation.
- Project skills load from `.claude/skills/` in the start directory **and every
  parent up to the repo root**.
- **Nested** `.claude/skills/` below the start directory do *not* load at
  startup; they load the first time Claude reads or edits a file in that
  subtree, then stay for the session. Name clashes resolve to a path-qualified
  command (`/apps/web:deploy`).
- `--add-dir` loads `.claude/skills/` from the added directory (an explicit
  exception — `permissions.additionalDirectories` does **not**).
- **Live change detection**: edits to `SKILL.md` under `~/.claude/skills/`, the
  project `.claude/skills/`, or an `--add-dir` dir are picked up mid-session.
  New *top-level* skills directories need a restart. Changes to a skill-folder
  plugin's `hooks/`, `.mcp.json`, `agents/` need `/reload-plugins`.
- The folder name **`synced` is reserved** at enterprise/personal/project level
  (any capitalization) — it's where `CLAUDE_CODE_SYNC_SKILLS` writes claude.ai
  skills. Don't author a skill named `synced`.
- `<skill-name>` may be a symlink to a directory elsewhere; Claude follows it and
  de-duplicates if reachable from two locations.

**Content lifecycle — the part most likely to surprise us:** when a skill is
invoked, the rendered `SKILL.md` enters the conversation **as a single message
and stays for the rest of the session**. Claude Code does **not** re-read the
file on later turns. So write standing instructions, not one-time steps. On
auto-compaction, the most recent invocation of each skill is re-attached after
the summary, keeping the **first 5,000 tokens** of each, with a **combined
25,000-token budget** across all re-attached skills, filled most-recent-first —
so older skills can be dropped entirely.

**[inference]** For our fresh-context-per-iteration loop this is mostly moot:
iterations are short enough that compaction shouldn't fire. It becomes relevant
only if an iteration goes long, which is itself the drift signal we want to
catch. Treat "compaction fired" as a drift alarm, not a normal event.

**Claude Code frontmatter beyond the spec** (these are *not* spec fields —
using them costs us portability to other Agent Skills clients):

| Field | Effect |
|---|---|
| `disable-model-invocation: true` | only the user can invoke; description stays out of context; also blocks preloading into subagents |
| `user-invocable: false` | hidden from the `/` menu; only Claude invokes; description always in context |
| `allowed-tools` | pre-approves tools **for the invoking turn only**; grant clears on next message; does *not* restrict other tools |
| `disallowed-tools` | removes tools from the pool while active — e.g. remove `AskUserQuestion` from a background loop skill |
| `paths` | glob patterns limiting auto-activation to matching files |
| `context: fork` | run the skill in its own subagent context |

Claude Code validates strictly and errors on unknown keys, e.g.:

```
Unexpected key(s) in SKILL.md frontmatter: argument-hint.
Allowed properties are: allowed-tools, compatibility, description, license, metadata, name
```

Note that this particular error message lists **only the six spec fields** —
which tells us the extended fields are accepted in the Claude Code skill
locations but the *portable* surface (claude.ai uploads, the Skills API,
`package_skill.py` from `anthropics/skills`) is restricted to exactly:
`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`.

**Command naming:** in a personal/project skill, frontmatter `name` sets only
the display label — **the command comes from the directory name.** In a plugin
skill, `name` sets the last segment after the plugin prefix. Combined with the
spec's "name must match the parent directory name" rule, the safe policy is:
**always make directory name == frontmatter `name`.**

**Variables** available in skill bodies and in `allowed-tools` Bash rules:
`${CLAUDE_SKILL_DIR}` (the dir containing `SKILL.md`) and
`${CLAUDE_PROJECT_DIR}`. Using the same variable in both lets a bundled script
run without a permission prompt:

```markdown
---
name: render-chart
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)
---
Run ${CLAUDE_SKILL_DIR}/scripts/render.sh <input>
```

**Invocation in `-p` mode:** user-invoked skills and custom commands work —
include `/skill-name` in the prompt string and Claude Code expands it before
running. Terminal-only builtins (`/login`) don't. In non-interactive sessions
the names `help` and `feedback` are *not* reserved.

### R11.6 Validation tooling

The spec points to **`skills-ref`**, the reference library at
`github.com/agentskills/agentskills/tree/main/skills-ref`.

- Language: **Python**. Installed from source (`pip install -e .` or `uv sync`),
  then `skills-ref` is on PATH in the activated environment.
- Commands:
  - `skills-ref validate path/to/skill` — checks frontmatter validity and naming
    conventions
  - `skills-ref read-properties path/to/skill` — emits metadata as JSON
  - `skills-ref to-prompt path/to/skill-a path/to/skill-b` — emits XML-formatted
    skill descriptions for agent prompts
- **[unverified]** No published version number and no PyPI package name were
  visible; it appears to be source-install only as of Aug 2026. If we wire it
  into CI, vendor it at a pinned git SHA rather than depending on a registry
  release that may not exist.

A second packaging path exists — `package_skill.py` in `anthropics/skills` — for
producing bundles for claude.ai / the Skills API. **[unverified]** I did not
fetch that repo; noting it only as a lead.

### R11.7 Conformance checklist for when we write skills

Adopt these as the definition of done for every skill in `skills/`:

1. Directory name **exactly equals** frontmatter `name`. Lowercase, hyphens, no
   leading/trailing/consecutive hyphens, ≤64 chars.
2. `description` ≤1024 chars, states both **what** and **when**, and contains the
   literal keywords a matching task would use ("LWC", "Lightning Web Component",
   "`@wire`", "SLDS", …). This string is the *entire* basis for auto-activation.
3. Body **< 500 lines** and **< 5000 tokens**. Anything longer moves to
   `references/`.
4. References are relative, one level deep.
5. Prefer the **six spec fields**. Every Claude-Code-only field
   (`disable-model-invocation`, `user-invocable`, `disallowed-tools`, `paths`,
   `context`) is a deliberate portability trade — record why in a comment.
6. Body written as **standing instructions**, not one-time steps, because the
   content persists for the whole session and is never re-read.
7. `skills-ref validate ./skills/<name>` passes, wired into CI.
8. **[inference]** Add our own lint on top of `skills-ref`: assert body token
   count < 5000 (spec recommendation, which `skills-ref` may not check), and
   assert directory-name == `name` (spec requires it; unclear whether the
   validator enforces it).

---

## R12 — Existing Ralph implementations

### R12.0 The technique

Geoffrey Huntley's "Ralph Wiggum technique": a bash loop that repeatedly feeds
an agent the *same* prompt file until the task is done. The load-bearing
property is **fresh context per iteration** — each pass re-reads the codebase,
the prompt, and the state files rather than accumulating a conversation that
eventually compacts and loses the plot. Persistence lives in the *filesystem and
git history*, not in the context window.

I surveyed five implementations, in descending order of relevance to us.

### R12.1 Comparison table

| | Official `ralph-loop` plugin | snarktank/ralph | frankbria/ralph-claude-code | mikeyobrien/ralph-orchestrator | vercel-labs/ralph-loop-agent |
|---|---|---|---|---|---|
| Author | **Anthropic** | community | community | community | Vercel Labs |
| Language | Bash (Stop hook) | Bash | Bash 4.0+ | **Rust** (+ TS dashboard) | TypeScript (AI SDK) |
| Fresh context/iter? | **No** — same session | Yes | Yes | Yes | Partial (summarization) |
| Loop mechanism | `Stop` hook returns `decision: block` | `ralph.sh` re-invokes CLI | bash loop + tmux | `ralph run` | `RalphLoopAgent.loop()` |
| Completion | `<promise>TEXT</promise>` exact match | all `prd.json` stories `passes: true` → `<promise>COMPLETE</promise>` | **dual gate**: ≥2 heuristics **AND** `EXIT_SIGNAL: true` | `LOOP_COMPLETE` token | `verifyCompletion() → {complete, reason}` |
| Iteration cap | `--max-iterations N` (default unlimited) | `ralph.sh [max_iterations]`, default 10 | yes | yes | `iterationCountIs(n)` |
| Cost cap | none | none | `MAX_CALLS_PER_HOUR` (100), `MAX_TOKENS_PER_HOUR` | claimed, undocumented | **`costIs(max, rates?)`**, `tokenCountIs(n)` |
| State files | `.claude/ralph-loop.local.md` | `prd.json`, `progress.txt`, git | `.ralph/{PROMPT,fix_plan,AGENT}.md`, `.ralphrc`, `.ralph/logs/` | `.ralph/` specs+plans+config | in-memory |
| Drift handling | none | tests/typecheck backpressure | **circuit breaker**, rollback, session reset | backpressure gates + Telegram HITL | `reason` fed into next iteration |
| License | Anthropic (bundled) | — | MIT | MIT | Apache-2.0 |
| Maturity | v1.0.0, official | reference impl | v0.11.5, 784 BATS tests | active, 2026-01-28 snapshot | **"experimental, APIs may change"** |

### R12.2 Official Anthropic `ralph-loop` plugin — already on this machine

Located at `C:\Users\shikh\.claude\plugins\cache\claude-plugins-official\ralph-loop\1.0.0\`.
Author: Anthropic. ~190-line bash Stop hook + three command markdown files + a
setup script.

**Mechanism.** Registers a `Stop` hook. On every attempted exit the hook reads
`.claude/ralph-loop.local.md` (YAML frontmatter + prompt body), and if the loop
is active returns:

```json
{"decision": "block", "reason": "<the same prompt text>", "systemMessage": "🔄 Ralph iteration N | ..."}
```

Blocking the Stop feeds the prompt back. The loop runs **inside the current
session**.

**Completion detection** is the part worth stealing. The hook reads the session
transcript JSONL, takes the last 100 `role:assistant` lines, `jq`-slurps them to
text blocks, and takes the last one. It then extracts `<promise>…</promise>` via
`perl -0777` (non-greedy, whitespace-normalized) and compares with `=` — literal
string comparison, deliberately not `==`, because `[[ ]]` glob-matches and would
break on `*`, `?`, `[`. The system message it injects each iteration:

> `To stop: output <promise>COMPLETE</promise> (ONLY when statement is TRUE — do not lie to exit!)`

**Other details worth noting:** session isolation via `session_id` in the state
frontmatter (the state file is project-scoped but the Stop hook fires in every
session in that project); numeric validation of `iteration`/`max_iterations` with
the state file deleted on corruption; atomic state update via temp-file + `mv`;
transcript scan capped at 100 lines to bound `jq` input.

The README states the plugin's own limitation plainly: `--completion-promise`
uses exact string matching, so **you cannot express multiple terminal states**
("SUCCESS" vs "BLOCKED"). It says to rely on `--max-iterations` as the primary
safety mechanism. It also documents a Windows issue where `bash` resolves to a
misconfigured WSL bash instead of Git Bash — relevant, since we are on Windows 11.

**Verdict: do not fork; do steal the completion protocol.** The fatal mismatch
is that this plugin **does not reset context between iterations** — it blocks
Stop within one session, so context accumulates and eventually compacts. That is
the opposite of the Ralph property we want. It is an *interactive* ergonomics
tool, not an unattended migration harness. But the `<promise>` protocol, the
"do not lie to exit" framing, the literal-comparison detail, and the
corrupt-state-file-means-halt policy are all directly reusable.

### R12.3 snarktank/ralph — the cleanest state model

`./scripts/ralph/ralph.sh [max_iterations]`, default 10. Backend selected via
`--tool amp` or `--tool claude`.

Three-part state, and this split is the best idea in the survey:

1. **`prd.json`** — the task manifest. Each user story has a `passes` boolean.
   Completion is *computed*, not asserted: when all stories are `passes: true`
   the agent emits `<promise>COMPLETE</promise>` and the loop exits.
2. **`progress.txt`** — **append-only learnings for future iterations.** This is
   the cross-context memory channel. Iteration N writes what it learned;
   iteration N+1 reads it with fresh context.
3. **Git history** — the durable record of what was actually done.

Prompt templates are tool-specific (`prompt.md` for Amp, `CLAUDE.md` for Claude
Code) and are meant to carry project-specific quality-check commands and
codebase conventions.

No cost caps. Failure handling is entirely "backpressure": typechecking and
tests catch errors so bad code doesn't compound.

**Verdict: fork the state model, not the code.** `prd.json` maps almost exactly
onto our census: one row per LWC component, a `passes` flag per component set by
the oracle. `progress.txt` is the answer to "how does iteration N+1 know that
iteration N already tried and failed approach X" without paying for context.

### R12.4 frankbria/ralph-claude-code — the best failure handling

v0.11.5, MIT, Bash 4.0+, 784 BATS tests. Requires Claude Code CLI, tmux
(recommended), `jq`, git, GNU coreutils.

Ideas worth taking:

- **Dual-condition exit gate.** Requires ≥2 heuristic completion signals **AND**
  an explicit `EXIT_SIGNAL: true` from Claude. Explicitly designed to prevent
  premature termination during productive iterations. This is strictly better
  than the official plugin's single exact-match promise.
- **Circuit breaker.** Opens after **3 loops with no progress** or **5 loops with
  identical errors**; auto-recovers after a 30-minute cooldown. This is the only
  implementation with a principled drift detector.
- **Rate/token budgets**: `MAX_CALLS_PER_HOUR` (default 100), optional
  `MAX_TOKENS_PER_HOUR`.
- **Two-stage error filtering** to avoid false positives from JSON field
  contents — i.e. don't declare an error because the word "error" appeared
  inside a `--output-format json` payload. A real bug we would otherwise hit.
- Manual recovery: `--reset-circuit`, `--reset-session`, `--rollback [BRANCH]`.
- State in `.ralph/`: `PROMPT.md`, `fix_plan.md` (prioritized checklist),
  `AGENT.md` (build/test commands), `.ralphrc`, `.ralph/logs/` with 10MB rotation.

**Verdict: fork the circuit breaker logic and the dual-gate exit; leave the
bash.** 784 BATS tests is genuinely impressive engineering, but it is ~all
solving problems that exist *because* the harness is bash parsing CLI JSON —
problems the SDK deletes by giving us typed `ResultMessage.subtype`.

### R12.5 mikeyobrien/ralph-orchestrator — the one named in the brief

**Important correction to the brief's premise: this is now a Rust project, not
a Python one.** README snapshot dated 2026-01-28. Rust 1.75+ core, TypeScript/JS
web dashboard (marked **Alpha**, "rough edges and breaking changes"). MIT.

Install: `npm install -g @ralph-orchestrator/ralph-cli` (recommended), or
`cargo install ralph-cli`, or a shell installer from GitHub Releases.

```
ralph init --backend claude
ralph plan "description"
ralph run -p "prompt"
```

Concepts: **"hats"** — specialized personas coordinating through events, with
five built-ins (`code-assist`, `debug`, `research`, `review`,
`pdd-to-code-assist`). Multi-backend: Claude Code, Gemini CLI, Kiro, Codex,
Forge, Amp, Copilot CLI, OpenCode. Completion on `LOOP_COMPLETE` or iteration
cap. Backpressure gates (test/lint/typecheck) reject incomplete work. Human-in-
the-loop recovery via "RObot" Telegram integration. State in `.ralph/`.

**[unverified]** Cost caps are mentioned as a feature but I found no
documentation of the mechanism or the flag. Do not assume they exist.

**Verdict: do not fork.** Three reasons. (1) Rust + a Node CLI wrapper + an alpha
web dashboard is a large surface to take on for a loop we can write in 200 lines.
(2) Its central abstraction — multi-backend across eight different agent CLIs —
is *cost* for us, not value; we are on Claude and will stay there. (3) The "hats"
model overlaps with subagents, which the SDK gives us natively with proper cost
attribution. Worth reading for the hat taxonomy; that's it.

### R12.6 vercel-labs/ralph-loop-agent — closest in *intent*

`npm install ralph-loop-agent ai zod`. Apache-2.0. Wraps AI SDK `generateText`
in an outer loop. Two-tier nested loop: outer iteration control, inner tool
execution.

API: `new RalphLoopAgent({ model, instructions, tools, verifyCompletion,
stopWhen, toolStopWhen, onIterationStart, onIterationEnd })`, then `.loop(opts)`
(returns iterations, final text, usage) or `.stream(opts)` (streams the final
iteration only).

Stop conditions compose as an array (stops when *any* fires):
`iterationCountIs(n)`, `tokenCountIs(n)`, **`costIs(maxCost, rates?)`**.

`verifyCompletion(ctx) → { complete: boolean, reason?: string }`. When not
complete, **`reason` is injected as guidance into the next iteration.** That is a
better feedback channel than a bare boolean and better than a promise tag,
because the loop tells the agent *why* it isn't done.

Its own README lists the target use cases as code migrations (Jest→Vitest,
CJS→ESM), dependency upgrades (React 17→18), and codebase-wide refactors. That is
our problem statement almost verbatim.

Marked **experimental; APIs may change between versions.**

**Verdict: steal the API shape, don't take the dependency.** It is built on the
Vercel AI SDK, so adopting it means running our migration on `generateText`
rather than on the Claude Code agent loop — losing hooks, skills, CLAUDE.md,
permission modes, MCP wiring, file checkpointing, and OTel. That is far too much
to give up. But `verifyCompletion → {complete, reason}` and composable
`stopWhen` predicates are the right interface, and I would copy both signatures
into our driver.

### R12.7 What to fork vs. write

**Write ourselves (~200 lines, TS, on the Agent SDK):**

- the outer `for` loop and per-unit dispatch
- global + per-iteration budget accounting from `ResultMessage.total_cost_usd`
- worktree allocation and cleanup
- structured logging keyed by OTel `prompt.id`

**Fork the ideas, with attribution, from:**

| Take | From | Why |
|---|---|---|
| `<promise>TEXT</promise>` + "do not lie to exit" framing | official `ralph-loop` plugin | battle-tested phrasing; Anthropic-authored |
| Literal (not glob) comparison of the completion token | official plugin | real bug they already hit |
| Corrupt-state-file ⇒ halt, don't guess | official plugin | correct failure posture |
| `prd.json` `passes` flags + computed completion | snarktank/ralph | maps 1:1 onto our census |
| `progress.txt` append-only cross-iteration learnings | snarktank/ralph | the memory channel fresh context needs |
| **Dual-gate exit** (heuristics AND explicit signal) | frankbria | prevents premature exit; strictly better than single-token |
| **Circuit breaker**: 3 no-progress or 5 identical-error iterations ⇒ open | frankbria | only real drift detector in the survey |
| Two-stage error filtering (ignore "error" inside JSON payloads) | frankbria | mostly moot on the SDK, but keep the lesson |
| `verifyCompletion → {complete, reason}`, reason fed forward | vercel-labs | better than a boolean |
| Composable `stopWhen: [iterationCountIs, tokenCountIs, costIs]` | vercel-labs | clean cap composition |

**Explicitly do not fork:** ralph-orchestrator (wrong language, wrong
abstraction), the Vercel package itself (wrong agent loop), any bash harness
(the SDK deletes the problems they solve).

### R12.8 Our completion + drift design **[inference]**

Synthesizing the above into what I'd actually build:

**Completion — three gates, all must pass.** No single signal.

1. *Objective*: the oracle's render diff for this component is clean.
2. *Mechanical*: typecheck + lint + the component's tests pass.
3. *Declared*: the agent emits `<promise>MIGRATED</promise>`, with the
   "do not lie to exit" instruction present in every iteration's system message.

Gate 1 is the real one. Gates 2 and 3 exist to catch the case where the oracle
is passing for the wrong reason.

**Drift — four independent alarms, any one halts the unit:**

1. `ResultMessage.subtype === "error_max_budget_usd"` on two consecutive
   iterations.
2. Circuit breaker: 3 iterations with no change in oracle score, or 5 with an
   identical error signature (frankbria's thresholds; no reason to invent new
   numbers).
3. A `compact_boundary` message appeared — the iteration ran long enough to
   compact, which means the unit is too big or the agent is thrashing.
4. `git diff --stat` shows churn (lines changed) rising while the oracle score
   is flat — thrash, not progress.

**Terminal states**, recorded to the census row: `MIGRATED`, `BLOCKED(reason)`,
`BUDGET_EXHAUSTED`, `DRIFT_HALTED`. Note this is precisely what the official
plugin's exact-match promise cannot express, and why we're not using it as-is.

---

## Open items / what I could not verify

1. **Agent SDK credits on subscription plans from 15 June 2026** — claimed by a
   secondary blog, absent from every Anthropic primary I fetched. Verify before
   budgeting if we run on a subscription rather than an API key.
2. **Agent Skills announcement/open-source dates** (Oct 2025 / Dec 2025) — not
   present on the spec site or repo landing page I read. Plausible, unconfirmed.
3. **`skills-ref` version / PyPI presence** — source-install only as far as I
   could see. Vendor at a pinned git SHA if we wire it into CI.
4. **ralph-orchestrator cost caps** — advertised, mechanism undocumented.
5. **`persistSession` equivalent for `claude -p`** — no documented flag found.
6. **Whether `skills-ref validate` enforces directory-name == `name`** and the
   5000-token body recommendation — I read the command list, not the source.
   Assume not; add our own lint.

---

## Sources

Primary — Anthropic / Claude Code documentation:

- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/agent-sdk/agent-loop
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-sdk/cost-tracking
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/monitoring-usage

Primary — Agent Skills standard:

- https://agentskills.io/
- https://agentskills.io/specification
- https://github.com/agentskills/agentskills
- https://github.com/agentskills/agentskills/tree/main/skills-ref

Primary — package registries (queried 11 Aug 2026):

- https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk → latest `0.3.228`
- https://pypi.org/pypi/claude-agent-sdk/json → latest `0.2.136`
- https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk — returned HTTP 403
  to automated fetch; data taken from the registry API above instead

Primary — local filesystem (this machine):

- `C:\Users\shikh\.claude\plugins\cache\claude-plugins-official\ralph-loop\1.0.0\`
  — `README.md`, `.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `hooks/stop-hook.sh` (191 lines), `commands/`, `scripts/`
- `C:\Users\shikh\LWCTOReactConversion\skills\` — confirmed empty
- `C:\Users\shikh\LWCTOReactConversion\research\README.md`

Ralph implementations:

- https://github.com/mikeyobrien/ralph-orchestrator
- https://raw.githubusercontent.com/mikeyobrien/ralph-orchestrator/main/README.md
- https://mikeyobrien.github.io/ralph-orchestrator/
- https://github.com/snarktank/ralph
- https://github.com/frankbria/ralph-claude-code
- https://claytonfarr.github.io/ralph-playbook/
- https://github.com/vercel-labs/ralph-loop-agent
- https://raw.githubusercontent.com/vercel-labs/ralph-loop-agent/main/README.md
- https://ghuntley.com/ralph/ (origin of the technique; cited by the official
  plugin README, not independently fetched)

Secondary / not relied upon for any unmarked claim:

- https://www.totalum.app/blog/claude-agent-sdk-credits-2026 (source of the
  unverified June 2026 credits claim)
- https://www.zerosync.co/blog/ralph-loop-technical-deep-dive
- https://lukasgrigis.dev/blog/ralph-loop/
- https://ralphloop.sh/blog/who-invented-the-ralph-technique/
- https://deepwiki.com/vercel-labs/ralph-loop-agent
