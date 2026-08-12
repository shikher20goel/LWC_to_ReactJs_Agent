# **Agentic Engineering Best Practices**

## **How to build the LWC → React migration agent**

### **v1.0 — grounded in primary sources, August 2026**

**Purpose:** this is the *how to build the agent* document. It sits beneath the architecture document (`01-architecture-and-best-practices-v2.md`), which is the *what to build*. Read this before writing a single `SKILL.md`.

**Sourcing discipline:** every claim below is traceable to Part 12\. Where sources disagree, I say so. Where I'm extrapolating, I mark it **\[inference\]**. This matters because most "agent best practice" content online is recycled summary — the numbers below come from primary engineering write-ups and independent measurement.

---

# **Part 0 — The ten laws**

Everything in this document reduces to these. If you only implement ten things, implement these.

| \# | Law | Source of authority |
| :---- | :---- | :---- |
| **L1** | **Context is a finite attention budget, not storage.** Find the smallest set of high-signal tokens that produce the outcome. | Anthropic, context engineering |
| **L2** | **Don't use prompts for control flow.** If you know the workflow, write actual control flow. Classify, then route to small focused prompts. | Horthy, 12-Factor Agents |
| **L3** | **Write instructions at the right altitude** — between brittle hardcoded if-else logic and vague guidance that assumes shared context. | Anthropic, context engineering |
| **L4** | **Fewer, better tools.** If a human engineer can't say which tool applies, the agent can't either. | Anthropic, writing tools for agents |
| **L5** | **Progressive disclosure.** Load metadata always, body on trigger, references on demand. | Anthropic, Agent Skills |
| **L6** | **Deterministic work belongs in code, not tokens.** Sorting a list by generating tokens is absurd; so is transpiling a template. | Anthropic, Agent Skills |
| **L7** | **Subagents exist to isolate context, not to parallelise for its own sake.** They explore in tens of thousands of tokens and return \~1–2k. | Anthropic, context engineering \+ multi-agent |
| **L8** | **State lives on disk, not in the conversation.** Repository and git history are the memory. | Huntley, Ralph loop |
| **L9** | **Start evaluating on day one with \~20 cases.** Early changes have huge effect sizes; you don't need hundreds. | Anthropic, multi-agent research |
| **L10** | **Every correction becomes a permanent rule.** When the agent errs, the fix goes in the rules file, not in a longer chat message. | Anthropic, compounding engineering |

---

# **Part 1 — The canon**

What to actually read, and what each contributes that the others don't.

| Source | Date | Unique contribution |
| :---- | :---- | :---- |
| **Anthropic — Building Effective AI Agents** | Dec 2024 | The workflow/agent distinction; the five composable patterns. Still the best primer. |
| **Anthropic — How we built our multi-agent research system** | Jun 2025 | Orchestrator-worker in production. Delegation failure modes, effort-scaling rules, eval methodology, the token economics. |
| **Anthropic — Writing effective tools for agents** | Sep 2025 | Tool design as a distinct discipline. Namespacing, consolidation, token efficiency, error-message engineering, eval-driven tool optimisation. |
| **Anthropic — Effective context engineering for AI agents** | Sep 2025 | The theoretical spine: attention budget, context rot, right altitude, just-in-time retrieval, compaction / note-taking / subagents. |
| **Anthropic — Equipping agents with Agent Skills** | Oct 2025 (open standard Dec 18, 2025\) | The skill format and three-tier progressive disclosure. Skills as onboarding docs for a new hire. |
| **Horthy — 12-Factor Agents / RPI → QRSPI** | Apr 2025, revised 2026 | Control flow discipline; the "dumb zone"; the self-correction that split one 85-instruction prompt into seven steps of \<40 instructions each. |
| **Huntley — the Ralph loop** | Jul 2025 | Fresh context per iteration; filesystem as memory; empirical guardrail tuning. |
| **Claude Code docs — best practices** | current | Plan mode, subagent delegation, compaction customisation, hooks. |

**Note on how these fit together.** They are not competing frameworks. Anthropic's posts describe *what good context looks like*; Horthy describes *how to keep control flow out of the model*; Huntley describes *how to run for hours without context rot*. The architecture in Part 8 uses all three.

---

# **Part 2 — Context engineering (the foundational discipline)**

## **2.1 Why context is a budget**

Anthropic's framing: context is the set of tokens present when sampling, and the engineering problem is maximising their utility against LLM constraints. The physical cause is architectural — transformers let every token attend to every other, producing n² pairwise relationships, so as context grows the model's ability to capture those relationships is stretched thin. Models also have less training exposure to very long sequences.

Consequence: **context rot** — recall degrades as token count rises. Anthropic is careful to describe this as a performance gradient, not a cliff. Models stay capable at long context but lose precision on retrieval and long-range reasoning.

Horthy's practitioner version is blunter and gives you an operational threshold: past roughly **40% context fill** you enter the "dumb zone" where signal-to-noise degrades. His summary — "you always get better results if you use less of them" — regardless of window size.

**Operational rule for our project:** treat 40% of the window as the working ceiling for any single agent turn. Design every stage to fit under it. If a stage can't, it's two stages.

## **2.2 The right altitude**

The single most useful prompt-authoring concept. Anthropic describes two failure modes:

- **Too low:** engineers hardcode brittle if-else logic to force exact behaviour. Creates fragility and maintenance debt.  
- **Too high:** vague guidance that gives no concrete signal, or falsely assumes shared context.

The target is specific enough to guide, flexible enough to leave the model strong heuristics.

**How to hit it in practice \[inference, but consistent with the sources\]:** write the rule, then ask "would a competent new hire with the reference docs open do the right thing from this alone?" If they'd need you to enumerate cases, you're too high. If you're enumerating cases they could derive, you're too low.

**Worked example from our domain:**

| Altitude | Text | Verdict |
| :---- | :---- | :---- |
| Too low | "If adapter is getRecord, emit useQuery with key \['record',id\]. If getObjectInfo, emit key \['objectInfo',api\]. If getListUi, emit… (40 more)" | Brittle. Belongs in a **catalog file**, not a prompt. |
| Too high | "Convert wire adapters to appropriate React data fetching." | No signal. Agent invents conventions per component. |
| **Right** | "Every `@wire` becomes a `useQuery` from `@migration/salesforce-runtime`. Look the adapter up in `catalog/wire-adapters.xml` — never invent a mapping; escalate if absent. Each `$`\-prefixed param becomes both a query-key segment and an `enabled` guard, because LWC wires don't fire on undefined params but `useQuery` will." | Names the invariant, points to the data, explains the *why* behind the non-obvious rule. |

Note what the "right" version does: it moves the 40-case enumeration into a **file the agent reads on demand** and keeps the prompt to the *principle plus the trap*.

## **2.3 Just-in-time retrieval**

Rather than pre-loading everything, maintain lightweight identifiers — file paths, queries, links — and load data at runtime via tools. Claude Code does this to analyse large datasets: write targeted queries, store results, use shell tools to inspect volumes of data without ever pulling the full object into context.

The metadata itself carries signal. Anthropic's example: a file named `test_utils.py` in `tests/` implies something different from the same name in `src/core_logic/`. Folder hierarchy, naming conventions, and timestamps all steer both humans and agents.

**Direct implication for our skill library:** the directory structure *is* part of the prompt. `skills/decisions/wire-to-query/` tells the agent this is a judgment domain before it reads a byte. Name things so the path is self-documenting.

The trade-off Anthropic names honestly: runtime exploration is slower than pre-computed retrieval, and without good tools and heuristics an agent wastes context chasing dead ends. **The hybrid is what Claude Code actually does** — `CLAUDE.md` loaded up front, `glob`/`grep` for just-in-time navigation.

**Our hybrid:** `ROUTER.md` \+ the current node's contract loaded up front; catalogs, references, and source files fetched on demand.

## **2.4 The three long-horizon techniques**

For work whose token count exceeds the window — which describes our migration exactly — Anthropic names three:

**Compaction.** Summarise a nearly-full context and reinitialise with the summary. In Claude Code this preserves architectural decisions, unresolved bugs, and implementation details while discarding redundant tool output, then continues with the five most recently accessed files. Tuning advice: maximise recall first, then improve precision. The lightest safe form is clearing old tool results — once a tool has been called deep in history, the raw result rarely needs to persist.

**Structured note-taking.** The agent writes notes to persistent memory outside the window and pulls them back later. Cheap, and it's what makes multi-hour coherence possible.

**Sub-agent architectures.** Specialised subagents handle focused tasks with clean windows; each may explore across tens of thousands of tokens but returns a distilled summary, typically **1,000–2,000 tokens**.

Anthropic's own selection guidance:

- Compaction → tasks needing extensive back-and-forth  
- Note-taking → iterative development with clear milestones  
- Multi-agent → complex research where parallel exploration pays

**For our project:** note-taking is primary (`progress.txt`, contracts, scorecards), subagents secondary (per-stage isolation), compaction is a fallback we should rarely hit — because Ralph resets context rather than compacting it. Huntley's argument is that a clean restart beats lossy compaction, and for our pipeline that's right: every stage's inputs are on disk anyway.

---

# **Part 3 — Writing instructions and prompts**

## **3.1 On XML tags — the honest answer**

You asked specifically about XML tags. Here's the accurate position rather than the cargo-cult one.

Anthropic recommends organising prompts into distinct sections — their examples include `<background_information>`, `<instructions>`, `## Tool guidance`, `## Output description` — using XML tagging or Markdown headers to delineate. **But they add an important caveat: exact prompt formatting is likely becoming less important as models get more capable.**

Separately, on *tool response* format, they found no one-size-fits-all between XML, JSON and Markdown, because LLMs perform better on formats matching their training distribution — and they explicitly say to pick based on your own evaluation.

**So the honest guidance:**

| Use XML when | Use Markdown when |
| :---- | :---- |
| The content is **structured data** the agent must parse or emit precisely (our contracts, catalogs, scorecards) | The content is **prose instruction** a human will also maintain |
| You need **schema validation** in CI | Nesting is shallow |
| Sections nest more than two deep | You want it readable in a PR diff |
| You're delimiting untrusted or verbatim content | — |

**Our decision:** XML for contracts, catalogs, and machine-consumed artifacts (they're validated in CI, so the structure earns its cost). Markdown with `##` headers for `SKILL.md` bodies (matches the Agent Skills convention and stays diff-readable). **Do not XML-wrap everything reflexively** — it inflates token count for no measured gain. Where you can't decide, evaluate; don't argue.

## **3.2 Examples over rules**

Anthropic strongly endorses few-shot prompting but warns against a specific failure: stuffing a laundry list of edge cases into a prompt to articulate every possible rule. Their recommendation is a curated set of **diverse, canonical** examples portraying expected behaviour.

**Rule for our skill library:** three to five canonical examples per skill, chosen to span the space, living in `references/*-examples.md` (loaded on demand). Not thirty edge cases inline.

## **3.3 Explain the why**

Practitioner consensus, and consistent with Anthropic's iterate-with-Claude guidance: rules that state a rationale survive edge cases the rule-writer didn't anticipate; bare imperatives don't generalise. **\[inference from the pattern, widely reported\]**

Compare:

- ❌ `Always add an enabled guard to useQuery.`  
- ✅ `Add an enabled guard to every useQuery derived from a reactive wire param, because LWC wires do not fire when a reactive param is undefined but useQuery will — producing a spurious call on mount that the oracle's call-diff will flag.`

The second version lets the agent recognise the *class* of problem in a construct you never enumerated.

## **3.4 Section template for a stage prompt**

\#\# Role

\[One sentence. What this agent is and is not responsible for.\]

\#\# Inputs

\[Exact file paths. Not "the contract" — \`contracts/source/\<node\>.xml\`.\]

\#\# Procedure

1\. …numbered, ordered, with the escalation branch stated inline

2\. …

\#\# Rules

\[Invariants only. Each with severity and rationale. Enumerations go in catalogs.\]

\#\# Failure modes

\[Symptom → cause → fix. This grows with every defect found.\]

\#\# Escalate to human when

\[Explicit conditions. Ambiguity here is what makes loops stall or invent.\]

\#\# Output

\[Exact artifact path and schema. One artifact per stage.\]

---

# **Part 4 — Skills**

## **4.1 The mechanism**

A skill is a directory containing `SKILL.md`, which must open with YAML frontmatter containing at minimum `name` and `description`. At startup the agent pre-loads only name and description for every installed skill.

**Three tiers:**

| Tier | What loads | When | Measured cost |
| :---- | :---- | :---- | :---- |
| 1 | `name` \+ `description` | Always, at startup | Independent measurement across Anthropic's 17 official skills: **median \~80 tokens**, range \~55–235. All 17 together ≈1,700 tokens. |
| 2 | Full `SKILL.md` body | When the agent judges the skill relevant | Same measurement: **\~275 to \~8,000 tokens, median \~2,000** |
| 3 | Bundled `references/`, `scripts/`, `assets/` | Only when the task demands | Effectively unbounded — never enters context unless read |

That tier-1 figure is the important one: **an agent can be aware of dozens of skills for less context than a single activated skill costs.** This is what makes a 55-skill library viable.

Anthropic's spec guidance: keep `SKILL.md` under **\~500 lines / \~5,000 tokens**; push anything not needed on every invocation into a reference file.

## **4.2 The description field is the most important line you will write**

It is the *only* thing loaded at startup, so it alone determines whether the skill ever fires. Anthropic explicitly says to pay special attention to `name` and `description` because Claude uses them to decide whether to trigger.

**Write it to answer two questions: what it does, and when to use it.** Include trigger vocabulary the agent will actually encounter. Max 1,024 characters.

\# ❌ Fires unreliably — describes the noun, not the trigger

description: Handles wire adapters.

\# ✅ Describes capability \+ trigger surface

description: \>-

  Convert LWC @wire declarations into TanStack Query calls against

  @migration/salesforce-runtime, preserving reactive-param semantics, cache

  behaviour, and invalidation. Use whenever a source contract contains a

  \<wire\> element, when mapping getRecord/getObjectInfo/getListUi/Apex wire

  adapters, when deciding query keys or staleTime, or when diagnosing an

  oracle call-diff showing an unexpected call on mount.

Naming convention widely used: lowercase, hyphenated, gerund-noun (`converting-wire-adapters`), avoid reserved words like "claude" or "anthropic", max 64 chars.

## **4.3 Authoring guidance from Anthropic**

Four practices, quoted in substance:

1. **Start with evaluation.** Run agents on representative tasks, observe where they struggle, then build skills incrementally to fill those specific gaps. *Do not write skills speculatively.*  
2. **Structure for scale.** Split when unwieldy. Keep mutually-exclusive or rarely-co-occurring paths in separate files to reduce token use. Make it clear whether Claude should *run* a script or *read* it as reference.  
3. **Think from Claude's perspective.** Watch real usage; iterate on unexpected trajectories and overreliance.  
4. **Iterate with Claude.** Ask Claude to capture successful approaches and common mistakes into the skill. When it goes off track, ask it to self-reflect on what went wrong. Their framing is that this discovers what context Claude *actually* needs rather than what you guessed up front.

Point 4 is the highest-leverage and least-used. **Build it into our loop as a formal step:** every BLOCKED task produces a self-reflection that becomes a candidate `<failure-mode>` entry.

## **4.4 Skills carry code, and should**

Skills can bundle scripts the agent executes without reading them into context. Anthropic's rationale is blunt: sorting a list by generating tokens is far more expensive than running a sort, and many applications need deterministic reliability that only code provides. Their PDF skill ships a Python script that extracts form fields — Claude runs it without loading either the script or the PDF into context.

**This is the mechanism behind our ≥60% determinism budget.** The template codemod, the catalog lookup, the oracle differs, the fixture generator — all ship as scripts inside skills. The LLM decides *when*, the code decides *what*.

## **4.5 Skill anti-patterns**

| Anti-pattern | Why it fails |
| :---- | :---- |
| Encyclopaedia skill (`lwc/everything`) | Tier-2 cost on every trigger; buries the decision |
| Vague description | Never fires, or fires constantly |
| Enumerations inline | Should be a catalog file — unversionable, untestable, token-heavy |
| Rules without rationale | Don't generalise past the enumerated case |
| Skills written before evals | You guess the gaps; Anthropic says find them empirically |
| Overlapping skills | Same confusion as overlapping tools |

---

# **Part 5 — Tools**

Tools are a different discipline from prompts. Anthropic's framing: traditional software is a contract between deterministic systems; a tool is a contract between a deterministic system and a *non-deterministic* agent. You cannot design them the way you design APIs for other developers.

## **5.1 Choose few, high-impact tools**

The common error is wrapping existing API endpoints one-to-one regardless of whether that suits an agent. Their address-book example: a `list_contacts` tool that returns everything forces the agent to read it token-by-token — brute-force search. Better to build `search_contacts` or `message_contact`.

**Consolidate.** Their examples:

- Not `list_users` \+ `list_events` \+ `create_event` → build `schedule_event`  
- Not `read_logs` → build `search_logs` returning only relevant lines plus surrounding context  
- Not `get_customer_by_id` \+ `list_transactions` \+ `list_notes` → build `get_customer_context`

**Our tool set, applying this:**

| ❌ Naive | ✅ Consolidated |
| :---- | :---- |
| `read_html`, `read_js`, `read_css`, `read_meta` | `get_lwc_bundle(node)` → all four, normalised |
| `list_children`, `list_wires`, `list_apex` | `get_dependency_closure(node, depth)` |
| `run_tsc`, `run_eslint`, `run_build`, `run_oracle` | `verify_node(node)` → one gate result |

Roughly **10–14 tools total.** More than that and you're recreating the problem Anthropic warns about: bloated tool sets with ambiguous decision points.

## **5.2 Namespacing**

Group by common prefix — by service (`asana_search`, `jira_search`) and by resource (`asana_projects_search`). Anthropic notes prefix-vs-suffix namespacing had non-trivial, model-varying effects on their evals, and tells you to choose by your own evaluation rather than by rule.

**Ours:** `sf_*` (org access), `graph_*`, `contract_*`, `emit_*`, `verify_*`.

## **5.3 Return meaningful context**

Return only high-signal information. Prioritise contextual relevance over flexibility. Avoid low-level identifiers like `uuid`, `mime_type`, `256px_image_url`; prefer `name`, `file_type`.

**The finding worth internalising:** resolving arbitrary alphanumeric UUIDs into semantically meaningful language — or even a simple 0-indexed scheme — measurably improved precision by reducing hallucination. Agents handle natural-language identifiers far better than cryptic ones.

**Applied:** our tools return `propertySummary` and `PropertyController.getBroker`, never `0Rb5g000000XyZ1CAK`.

Expose a `response_format` enum (`concise` / `detailed`) so the agent controls verbosity. Their Slack example: concise responses used about **one third** the tokens of detailed ones.

## **5.4 Token efficiency and error engineering**

Implement pagination, range selection, filtering, or truncation with sensible defaults for anything that could be large. **Claude Code caps tool responses at 25,000 tokens by default** — a good reference point.

When truncating, steer with instructions. And prompt-engineer your *error* responses: communicate specific, actionable improvements rather than opaque codes or tracebacks.

\# ❌

raise ValueError("E\_INVALID\_NODE")

\# ✅

return ToolError(

  "No LWC bundle named 'propertysummary'. Names are case-sensitive; "

  "try 'propertySummary'. Run graph\_list\_nodes to see the 14 nodes in scope."

)

## **5.5 Optimise tool descriptions — the highest-ROI lever**

Anthropic calls prompt-engineering tool descriptions one of the most effective improvement methods. Their advice: describe the tool as you would to a new hire, making implicit context explicit — query formats, niche terminology, relationships between resources. Name parameters unambiguously (`user_id`, not `user`).

Two datapoints on how much this matters:

- Claude Sonnet 3.5 reached state-of-the-art on SWE-bench Verified after **precise refinements to tool descriptions**, cutting error rates substantially.  
- A tool-testing agent that repeatedly used a flawed tool and rewrote its description produced a **40% decrease in task completion time** for later agents.

**Do this for our tools.** Build the tool eval (Part 7), then let Claude optimise the descriptions against it. Anthropic notes most of their own advice came from repeatedly optimising internal tools with Claude Code, and that held-out test sets showed gains beyond expert hand-written implementations.

---

# **Part 6 — Agent topology**

## **6.1 Workflows vs agents**

Anthropic's distinction, which is load-bearing:

- **Workflows** — LLMs and tools orchestrated through *predefined code paths*  
- **Agents** — LLMs *dynamically* directing their own process and tool usage

Their overall finding across many teams: the most successful implementations weren't using complex frameworks — they used simple composable patterns.

Horthy's version is the operational rule: don't use prompts for control flow. If you know the workflow, use real control flow — classify the input, then feed it to smaller focused prompts with fewer instructions and fewer available actions.

**Our pipeline is a workflow, not an agent.** Eight stages, fixed order, code-enforced. Only *within* stages do we let the model act agentically. This is deliberate: we know the workflow, so encoding it in a prompt would be strictly worse.

**The cautionary tale is Horthy's own.** His team publicly advocated small focused prompts, then wrote a monolithic \~85-instruction prompt. On recognising it, they split their three-step RPI into a seven-step pipeline (Questions, Research, Design, Structure, Plan, Worktree, Implement) with **fewer than 40 instructions per step**.

**Constraint adopted:** no stage prompt exceeds 40 instructions. If it does, split the stage.

## **6.2 The five patterns, mapped to our pipeline**

| Pattern | Definition | Where we use it |
| :---- | :---- | :---- |
| **Prompt chaining** | Sequential calls, output feeds next, gates validate between | S2→S3→S4→S5, with the S6 gate |
| **Routing** | Classify, then dispatch to a specialised handler | Tier M/A/H classification → codemod / LLM / stub |
| **Parallelisation** | Sectioning (split work) or voting (same work, aggregate) | Independent leaf nodes in parallel; voting on security-relevant classification |
| **Orchestrator-workers** | Central LLM decomposes, delegates, synthesises — subtasks not predictable up front | Graph traversal; scope exploration |
| **Evaluator-optimiser** | One call generates, another evaluates in a loop | The oracle diff → repair loop |

Anthropic notes evaluator-optimiser works best with **clear evaluation criteria and measurable value from iterative refinement** — which is exactly what the oracle gives us, and exactly what our v1 plan lacked.

## **6.3 Delegation — the failure modes are documented**

From the multi-agent research system, early failures included spawning 50 subagents for simple queries, endlessly searching for nonexistent sources, and distracting each other with excessive updates.

**Every subagent task description needs four things:** an objective, an output format, guidance on tools and sources, and clear task boundaries. Without them, agents duplicate work or leave gaps. Their concrete example: given the vague instruction "research the semiconductor shortage," one subagent explored the 2021 automotive chip crisis while two others duplicated each other on 2025 supply chains.

**Scale effort explicitly.** Agents judge effort poorly, so embed the rules. Anthropic's:

- Simple fact-finding → 1 agent, 3–10 tool calls  
- Direct comparison → 2–4 subagents, 10–15 calls each  
- Complex research → 10+ subagents with divided responsibilities

**Our equivalent, in `CLAUDE.md`:**

Tier-M-only node          → no subagent, codemod path, ≤5 tool calls

Node with 1–2 Tier-A      → 1 emitter subagent, ≤15 tool calls

Node with 3+ Tier-A       → analyst \+ architect \+ emitter, ≤25 calls each

Node with any Tier-H      → stop after stub. Escalate. Do not explore.

**Subagent output to the filesystem.** Anthropic's appendix names this explicitly: have subagents persist artifacts and return lightweight references, rather than passing everything back through the coordinator. It prevents information loss in multi-stage processing and cuts token overhead from copying large outputs through history — and works particularly well for structured outputs like code.

**Our rule:** subagents write to `contracts/`, `mfe/src/`, `diff/`; they return a path plus a ≤200-token summary. Never the artifact itself.

## **6.4 The economics — read before choosing multi-agent**

The numbers, from Anthropic's own analysis:

- Multi-agent (Opus lead \+ Sonnet subagents) beat single-agent Opus by **90.2%** on their internal research eval.  
- Three factors explained **95%** of performance variance on BrowseComp; **token usage alone explained 80%**. Tool-call count and model choice were the other two.  
- Agents use roughly **4×** the tokens of chat. Multi-agent uses roughly **15×**.  
- Parallelisation (3–5 subagents concurrently, each using 3+ tools in parallel) cut research time by **up to 90%**.

**And the honest caveat, which applies directly to us:** Anthropic states that most coding tasks involve fewer genuinely parallelisable subtasks than research, that LLM agents aren't yet good at real-time coordination, and that domains requiring shared context or heavy inter-agent dependency are a poor fit today.

**Conclusion for our project \[inference from that caveat\]:** use subagents for **context isolation per stage**, not for aggressive parallelism. Our dependency graph is inherently sequential leaf-to-root. Parallelise only across *independent* leaves. Do not build a 10-subagent swarm — you'd pay 15× tokens for a task whose critical path is serial anyway.

---

# **Part 7 — Evaluation**

Anthropic treats evals as the precondition for everything else. Skills guidance says start with evaluation; tools guidance says build the eval before optimising.

## **7.1 Start small, immediately**

Their strongest practical advice: in early development, effect sizes are enormous — a prompt tweak might move success from 30% to 80% — so you can see changes with very few cases. They started with **about 20 queries** representing real usage. They explicitly push back on the common belief that only hundred-case evals are worth building.

**Our Phase 0 eval: 20 components.** Not 60\. Sixty is the Phase 1 regression corpus; 20 is what you need to start.

## **7.2 Write hard eval tasks**

Anthropic warns against simplistic sandbox tasks that don't stress the tools. Strong tasks may require dozens of tool calls.

| ❌ Weak | ✅ Strong |
| :---- | :---- |
| "Convert `propertyTile` to React." | "Convert the `propertySummary` subtree. It has 3 children, 2 wire adapters, an LMS channel with a subscriber outside scope, and a `lightning-record-edit-form`. Produce contracts, code, an oracle-green result for Tier M/A, a Tier-H stub with spec, and a fidelity log." |

## **7.3 LLM-as-judge, done the way that worked**

They evaluated free-form outputs with an LLM judge scoring against a rubric: factual accuracy, citation accuracy, completeness, source quality, tool efficiency.

**The finding that saves you time:** they experimented with multiple judges per component but found a **single LLM call with a single prompt, outputting 0.0–1.0 scores plus a pass/fail grade**, was most consistent and best aligned with human judgement.

Also: avoid overly strict verifiers that reject correct answers over formatting or valid alternative phrasing.

**Our judge rubric:** contract fidelity, decision quality, fidelity-loss honesty, rule adherence, escalation correctness. The oracle handles behavioural correctness mechanically — the judge only grades what the oracle can't.

## **7.4 End-state evaluation**

Critical for agents that mutate state. Their guidance: evaluate whether the correct **final state** was achieved, not whether a prescribed process was followed, because agents may find alternative valid paths. For complex workflows, break evaluation into discrete checkpoints where specific state changes should have occurred, rather than validating every intermediate step.

**Ours:** grade the final artifact set per node, not the trajectory.

## **7.5 Metrics beyond accuracy**

Collect per-task runtime, tool-call count, total token consumption, and tool errors. Redundant calls suggest pagination or limits need rightsizing; frequent parameter errors suggest descriptions need work.

**Their canonical example of what this catches:** Claude was needlessly appending `2025` to web-search queries, biasing results and degrading performance. Fixed by improving the tool description. You only find that class of bug by reading tool-call metrics.

## **7.6 Held-out test sets**

They relied on held-out sets to avoid overfitting to their training evals — and those sets revealed further gains beyond expert hand-written tool implementations.

**Ours:** 20 of the 60 corpus components never touch skill development. They're only run at phase gates.

## **7.7 Human evaluation still catches what automation misses**

Their example: human testers noticed early agents systematically preferred SEO-optimised content farms over authoritative but lower-ranked sources — a bias no automated eval flagged. Adding source-quality heuristics fixed it.

**Ours:** styling parity and security-relevant rendering are human-reviewed. Permanently, not temporarily.

---

# **Part 8 — The loop**

## **8.1 Ralph, and why it fits here**

A coding agent in a plain `while` loop, reading the same goal file each iteration, doing one unit of work, exiting. **Fresh context every pass is the point, not a side effect.** State lives in the filesystem and git; the repository is the memory; the goal prompt is the only persistent instruction.

Huntley's tuning philosophy: each failure reveals a problem domain, you add a guardrail, repeat until the prompt converges. Your job is to sit *on* the loop, not in it.

**Documented weaknesses:** drift without structure, uncapped cost, garbage-in-infinite-garbage-out on ambiguous tasks, and legacy codebases needing human judgment. Best suited to **testable outputs with clear requirements**.

Every design choice in our architecture — the fixed 8-stage pipeline, the topological order, the oracle, the 3-strike block, the iteration cap — exists to keep us inside that "testable outputs" regime. **Ralph over unverifiable work is a token bonfire.**

## **8.2 QRSPI — the planning discipline**

Horthy's RPI (Research → Plan → Implement) was revised because it was "right in spirit but broken in practice". The update inserts an explicit questions/outline phase and forces humans to read the *code*, not just the plan file.

His warning is worth taking personally: his team tried having the model write code with no human review in July 2025, and shut the whole system down four months later.

**Applied:** our S1 scope report is a human gate. Our reviewer packets exist so humans read *diffs and contracts*, not just scorecards. A green scorecard is not a substitute for reading code on Tier-A nodes.

## **8.3 Compounding engineering**

Anthropic's practice, widely reported: whenever Claude does something wrong, add it to `CLAUDE.md` so it doesn't recur — even ending corrections with an instruction to update the rules file. Every banked correction sharpens every future session.

**Formalise it.** In our system a defect has a fixed lifecycle:

oracle diff / human review finds defect

  → diagnose to a class (not an instance)

  → add \<failure-mode\> entry with symptom keyed to the diff signature

  → add a rule if the class was unruled

  → re-run the 40-component corpus

  → merge only if no regression

**The symptom must be phrased as a diff signature, not prose** — that's what makes it mechanically matchable next time.

## **8.4 The loop file**

GOAL.md  — the only persistent instruction (see architecture doc §7.1)

CLAUDE.md — rules, forbidden actions, verify command, completion promise

plan.md   — human-readable narrative

prd.json  — machine task list, every task passes:false initially

progress.txt — append-only agent memory

Anthropic's compaction tip applies if you ever do compact: you can instruct in `CLAUDE.md` what must survive summarisation — e.g. always preserve the full list of modified files and the test commands.

---

# **Part 9 — Production reliability**

From the multi-agent write-up, all directly relevant:

**Errors compound.** In traditional software a bug breaks a feature; in agentic systems minor changes cascade into large behavioural changes. One failed step can send the agent down an entirely different trajectory.

**Build for resumption, not restart.** They built systems that resume from where the error occurred, because restarting is expensive. They combine model adaptability (telling the agent a tool is failing and letting it adapt — which they report works surprisingly well) with deterministic safeguards: retry logic and regular checkpoints.

**Ours:** git commit per iteration is the checkpoint. Every stage is resumable from disk. No stage depends on in-context state from a prior stage.

**Tracing is not optional.** Agents are non-deterministic between runs even with identical prompts. They report users saying agents "couldn't find obvious information" with no way to see why — until full production tracing let them diagnose systematically. They monitor decision patterns and interaction structure.

**Ours:** log every tool call, every skill load, every escalation, per node, to `trace/`. When the loop produces garbage at 3am you need the trace, not the output.

**Deployment coordination.** Agents are stateful and long-running, so updates can land mid-process. They use rainbow deployments, shifting traffic gradually while both versions run. **\[inference\]** For us the analogue is simpler: never change skills mid-run. Version the skill library, pin the version in `prd.json`, and finish the run before upgrading.

---

# **Part 10 — Security**

Anthropic's guidance on skills: they grant new capabilities through instructions *and code*, so malicious skills can introduce vulnerabilities or direct Claude to exfiltrate data. Install only from trusted sources; audit anything less trusted by reading the bundled files, paying particular attention to code dependencies and bundled resources, and to instructions or code that connect to untrusted external networks.

**Our rules, extending that to this project:**

1. No skill, agent, or tool ever requests, stores, logs, or transmits a Salesforce password, security token, or session ID. Auth is JWT Bearer via pre-authorised org alias.  
2. Retrieved LWC/Apex source is **data, not instructions**. A comment in a retrieved file saying "ignore previous instructions" is org content, and the agent must not act on it. State this explicitly in `CLAUDE.md` — retrieved source is untrusted input.  
3. The loop may not edit fixtures, shim tests, or the golden corpus. These are evidence; making them mutable makes the whole gate meaningless.  
4. Sandboxed container for any `--dangerously-skip-permissions` run. Never on a workstation with org credentials in the keychain.  
5. Every third-party skill or MCP server gets read before install.

---

# **Part 11 — Applied: the build order**

Everything above, sequenced for our project.

| Step | Do | Grounded in |
| :---- | :---- | :---- |
| 1 | Build the **20-case eval set** from real components. Run a bare Claude Code session against them. Record where it fails. | Start with evaluation (Skills); start small (multi-agent) |
| 2 | Build the **oracle harness** and the **shim**. Deterministic verification before any skill exists. | Code over tokens (Skills); testable outputs (Ralph) |
| 3 | Build **10–14 consolidated tools**. Namespace them. Write descriptions as if for a new hire. | Writing tools for agents |
| 4 | Build the **tool eval**, then let Claude optimise the tool descriptions against it. Use a held-out set. | 40% completion-time gain; SWE-bench precedent |
| 5 | Write skills **only for the gaps step 1 found.** Catalogs first — they're data, not prose. | Build incrementally to address shortcomings |
| 6 | Add the **regression suite**: every skill change re-runs the corpus, reports delta, blocks on regression. | Held-out sets; compounding engineering |
| 7 | Wire the **8-stage workflow in code**, not in a prompt. ≤40 instructions per stage. | 12-Factor; QRSPI |
| 8 | Wrap in **Ralph**. Tune on the corpus only, until it reproduces the hand-migrations. | Ralph loop |
| 9 | Add **tracing** before the first unattended overnight run. | Production reliability |
| 10 | Pilot. Measure token cost, tool calls, human minutes, oracle coverage. | Metrics beyond accuracy |

**Note the ordering deliberately puts skills fifth.** Both Anthropic sources say to find gaps empirically first. Writing 55 skills before running a single eval is the most likely way to waste three months of this project.

---

# **Part 12 — Checklists**

## **Skill review**

- [ ] `description` states what **and when**, with trigger vocabulary, ≤1,024 chars  
- [ ] `SKILL.md` ≤500 lines / \~5,000 tokens  
- [ ] Enumerations live in catalogs, not inline  
- [ ] Every rule has severity \+ rationale  
- [ ] 3–5 canonical examples in `references/`, not 30 edge cases inline  
- [ ] `<failure-mode>` symptoms phrased as diff signatures  
- [ ] Escalation conditions explicit  
- [ ] Clear whether bundled code is *run* or *read*  
- [ ] No overlap with an existing skill  
- [ ] Corpus regression run: no newly-failing components

## **Tool review**

- [ ] Namespaced by prefix  
- [ ] Consolidates a real workflow, not a wrapped endpoint  
- [ ] Returns semantic identifiers, never raw UUIDs  
- [ ] `response_format` enum where output size varies  
- [ ] Default token cap (≤25k reference point)  
- [ ] Errors state the specific fix, not a code  
- [ ] Parameters unambiguously named (`node_api_name`, not `node`)  
- [ ] Description written as onboarding for a new hire  
- [ ] Measured against the tool eval

## **Stage prompt review**

- [ ] ≤40 instructions  
- [ ] Right altitude — no enumerations, no vagueness  
- [ ] Exact input and output paths  
- [ ] Fits under 40% context with a typical node loaded  
- [ ] Control flow is in code, not in the prompt  
- [ ] Subagent tasks state objective, format, tools, boundaries  
- [ ] Effort budget stated

---

# **Part 13 — Anti-patterns**

| \# | Anti-pattern | Why it bites |
| :---- | :---- | :---- |
| A1 | Control flow in the prompt | The workflow is known — encode it in code. Horthy's central thesis. |
| A2 | The monolithic mega-prompt | Horthy's own mistake. 85 instructions → seven steps of \<40. |
| A3 | Skills before evals | You build for imagined gaps. Both Anthropic sources say measure first. |
| A4 | Tool sprawl | If a human can't pick the tool, neither can the agent. |
| A5 | Wrapping every API endpoint as a tool | Agents have different affordances from programs. |
| A6 | Raw UUIDs in tool output | Measurably increases hallucination. |
| A7 | 30 edge cases inline | Curate canonical examples instead. |
| A8 | Subagents returning full artifacts | Write to disk, return a reference. |
| A9 | Multi-agent by default | \~15× token cost; coding parallelises worse than research. |
| A10 | Trusting a green eval with no human review | Horthy shipped unread code and killed the system four months later. |
| A11 | Fixing a defect in chat instead of in the rules file | Loses the compounding effect entirely. |
| A12 | Treating retrieved source as instructions | Prompt-injection surface. |
| A13 | XML-tagging everything reflexively | Token cost without measured benefit; format matters less than it used to. |
| A14 | No tracing | Non-determinism makes post-hoc diagnosis impossible without it. |

---

# **Part 14 — Sources**

**Primary (Anthropic Engineering):**

- Building Effective AI Agents — anthropic.com/research/building-effective-agents (Dec 2024\)  
- How we built our multi-agent research system — anthropic.com/engineering/multi-agent-research-system (Jun 2025\)  
- Writing effective tools for agents — with agents — anthropic.com/engineering/writing-tools-for-agents (Sep 2025\)  
- Effective context engineering for AI agents — anthropic.com/engineering/effective-context-engineering-for-ai-agents (Sep 2025\)  
- Equipping agents for the real world with Agent Skills — anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills (Oct 2025; open standard agentskills.io, Dec 18 2025\)  
- Claude Code best practices — code.claude.com/docs/en/best-practices

**Practitioner:**

- Dex Horthy (HumanLayer) — 12-Factor Agents (Apr 2025); RPI → QRSPI revision; the "dumb zone"  
- Geoffrey Huntley — ghuntley.com/loop, the Ralph Wiggum loop (named Jul 2025\)

**Independent measurement:**

- SwirlAI token measurement across Anthropic's 17 official skills (tier-1 median \~80 tokens; tier-2 median \~2,000)

*All content paraphrased. Two short quotations retained where exact wording carries the meaning.*  
