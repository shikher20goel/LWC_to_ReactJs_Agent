# 13 — Competitive Landscape: Tools that convert LWC to React (or migrate LWC off-platform)

**Survey date:** 2026-08-11
**Method:** ~20 web searches + ~25 direct fetches (GitHub API, npm registry search API, Salesforce Developer docs, vendor blogs). Every URL actually fetched is listed in **Sources** at the end. Claims not directly supported by a fetched page are marked **[inference]**.

---

## 0. Executive summary (read this if nothing else)

1. **There is still no maintained LWC→React converter in existence, anywhere.** The only artifact that has ever claimed to do it is `blittle/lwc2react` (POC, dead since Dec 2020). npm registry search returns zero conversion packages; `awesome-component-converters` has zero LWC entries; Mitosis has no LWC target; no AppExchange or consultancy product was found. This is a well-evidenced negative, not a "couldn't find it."
2. **The landscape moved sideways, not toward us.** In 2026 Salesforce answered "I want React" with **Salesforce Multi-Framework** (GA July 2026): a *new* React runtime on-platform (`UIBundle` metadata, Vite, `@salesforce/sdk-data`). It is explicitly **additive, not a migration** — "Multi-Framework doesn't replace LWC; it runs alongside it." Salesforce ships **no** LWC→React migration tooling and gives **no** migration guidance.
3. **Salesforce's only real migration agent is Aura→LWC, not LWC→anything.** It lives in `@salesforce/mcp` (`aura-experts` / `lwc-experts` toolsets), is a **pure LLM-prompting orchestration** — it returns PRD blueprints and guidance text, not AST transforms — and its "verification" is a **checklist tool** (`verify_aura_migration_completeness`) plus **manual screenshot comparison by the developer**. There is no differential execution anywhere in it.
4. **The closest prior art to our differential oracle is `@lwc/test-runner`** — Salesforce's SSR test runner, which pixel-matches SSR vs CSR renderings of the *same* LWC in headless Chrome (`visuallyIdenticalInCSRandSSR`). It is LWC-vs-LWC, never cross-framework. It is the one thing in this survey that does something we don't: **pixel diffing**.
5. **We are ahead on the two things that matter** (real template AST + differential verification) and **behind on one strategic thing**: our React output targets generic React, while Salesforce's blessed, GA, deployable React target is a `UIBundle` whose data layer is `@salesforce/sdk-data` GraphQL hooks — and Salesforce says *"Don't reach for `@wire`."*

---

## 1. Direct LWC→React (and LWC→anything) converters

### 1.1 `blittle/lwc2react` — the only one that ever existed

| Field | Value |
|---|---|
| URL | https://github.com/blittle/lwc2react |
| License | **None declared** (GitHub API `license: null`) — legally unusable as a base |
| Created | 2020-05-01 |
| Last meaningful update | 2020-12-28 (`updated_at`); `pushed_at` 2023-01-06 is branch/bot activity **[inference]** |
| Popularity | 6 stars, 1 fork, 49 commits, 28 open PRs (mostly stale dependabot) **[inference]** |
| Maturity | POC. README: *"proof of concept and **NOT** ready for use in production!"* |

Already dissected in `research/06-clusterB-codemod.md`. Recorded here only for the comparison table. Confirmed by this survey: it operates on **compiled LWC output** via a rollup plugin (not on templates), README lists wire adapters as unsupported, and there is **no verification of any kind** — no tests, no diffing, no fixtures.

### 1.2 Everything else in this category: nothing

Searched and came up empty. These are *negative results with evidence*:

- **npm registry search API** (`text=lwc react convert`, 25 results) returns only first-party `@lwc/*` / `@salesforce/*` packages and an unrelated `color-convert`. **No package on npm claims to convert LWC to React or to any other framework.**
- **`milahu/awesome-component-converters`** — the canonical cross-framework converter index (react/svelte/solid/vue/angular/mitosis) — contains **zero** LWC or Lightning Web Components entries.
- **Mitosis (Builder.io)** — the broadest multi-target compiler (react, vue, angular, svelte, solid, qwik, lit, stencil, web components, swift, marko…) — has **no LWC input and no LWC output target**.
- **Codemod.com** — an active AI/compiler-aware migration platform with 1,000+ codemods — surfaced **no LWC codemods** in search; its catalogue is framework-upgrade oriented (React/Next/Angular versions).
- **AppExchange / consultancies** — no productized "LWC→React" offering found. Partner marketing in 2026 is about *building* LWC or *adopting* Multi-Framework, not converting. Searches for "LWC to React migration services" return generic Salesforce consulting SEO pages.
- **LWC→Vue / LWC→Angular / LWC→Svelte** — nothing. The only related repo, `muenzpraeger/sfdx-lwc-preact-svelte-vue-example`, is an *interop demo* (running other frameworks alongside LWC), not a converter. **[inference]** based on repo title/description; not fetched in depth.

### 1.3 The inverse direction (React → inside LWC) — a crowded, irrelevant space

Many repos exist for *embedding React inside LWC*, and they pollute every search for "LWC React":
- `ChuckJonas/lwc-react-webpack-demo` — webpack-bundle React, mount inside an LWC.
- `ivanovivelin/lwc-oss-react-boilerplate` — React alongside LWC OSS.
- `ccoenraets/lightning-react` — **1 commit, 32 stars, ~2016-era**, hosts a React component inside an Aura component. Dormant, educational.

None of these convert anything. They matter only as evidence that the community's answer to "I want React in Salesforce" has always been *wrap*, never *convert*.

---

## 2. Salesforce's own migration tooling (2026 state)

### 2.1 `@salesforce/mcp` — the Aura→LWC migration agent

| Field | Value |
|---|---|
| npm | `@salesforce/mcp` **0.30.15**, published **2026-07-09**, Apache-2.0 |
| Providers | `@salesforce/mcp-provider-aura-experts` 0.3.7 (2026-03-26); `@salesforce/mcp-provider-lwc-experts` 0.7.0 (2026-04-02) |
| Repo | https://github.com/salesforcecli/mcp |
| Docs | https://developer.salesforce.com/docs/platform/lwc/guide/mcp-intro.html |
| Maturity | Shipping, actively released; the LWC/Aura toolsets are documented as **Beta** on the feature pages, while the reference table marks most individual tools **GA**. This is an inconsistency in Salesforce's own docs — treat the *feature* as Beta. |

**Architecture — this is the important finding.** It is **not** a codemod. It is an MCP server whose tools overwhelmingly **return guidance text, checklists and PRD documents to an LLM**, which then writes the code. The reference page's own "implementation notes" read like: *"Returns guidance text"*, *"Returns instructional prompts"*, *"Returns reference material"*. Salesforce's own disclaimer: *"MCP Tools for LWC uses generative AI, which can produce inaccurate or harmful responses"* and output is *"often nondeterministic."*

**The Aura→LWC pipeline** (from the Jan 2026 Vibes blog, which shows the real call sequence):

1. `orchestrate_aura_migration` — produces a migration plan
2. `create_aura_blueprint_draft` — analyses the Aura bundle → **YAML/PRD blueprint** (structure, purpose, references, state); framework-agnostic
3. `enhance_aura_blueprint_draft` — LLM "expert pass" to resolve dependencies and flag unknowns
4. `transition_prd_to_lwc` — maps Aura PRD → LWC blueprint (platform service mappings)
5. `create_lwc_component_from_prd` — generates the LWC
6. `guide_design_general` / SLDS tools — styling pass

Notable design idea: the **blueprint/PRD is a framework-agnostic intermediate representation**, and it is a *human-reviewable artifact*. That is genuinely good product thinking (see §7).

**How does it verify? Essentially, it doesn't.**

- `verify_aura_migration_completeness` (GA) — *"provides a completeness checklist … completeness metrics based on functional and UI parity, event handling, data binding, modularity, error handling, localization, security, performance."* This is an **LLM-evaluated checklist over source text**. Nothing is executed. Nothing is rendered. There is no oracle.
- `score_issues` (GA) — computes a *"readiness score (0–100) and quality grade."* Again static/LLM.
- Real verification in the documented workflow is **the developer deploying the component and eyeballing it**. The Salesforce blog's own worked example: side-by-side screenshots, four prompts, 30–40 minutes, and three defects (events not received, `[object Object]` rendered instead of values, styling misalignment) all caught **only by manual post-deploy testing**.
- Adjacent tools do exist that touch tests: `create_lwc_jest_tests`, `review_lwc_jest_tests`, `orchestrate_lwc_component_testing`, `run_lwc_accessibility_jest_tests` (GA). But these **generate tests for the new component**; they do not compare old vs new behaviour. A generated test that passes tells you the generated code matches the generated test's own assumptions — the classic tautology.

**What it does NOT handle:** LWC→React or LWC→anything off-platform (does not exist in any toolset); deterministic transformation; behavioural equivalence; wire-adapter semantics beyond guidance prose. Also documented limitation: *"Include the entire Aura bundle — partial input reduces PRD quality."*

**Is there anything for LWC→off-platform?** `guide_lo_migration` (GA) converts a Lightning Out **beta** host page to **Lightning Out 2.0**. That is host-page plumbing, not component conversion. **There is no LWC→React, LWC→Multi-Framework, or LWC→off-platform tool in `@salesforce/mcp` as of Aug 2026.**

### 2.2 `salesforce/lwc-codemod` — a real codemod, but LWC→LWC only

| Field | Value |
|---|---|
| URL | https://github.com/salesforce/lwc-codemod |
| License | BSD-3-Clause · 20 stars |
| Last push | **2026-08-04** — actively maintained |
| Transforms | `shadow-to-light`, `synthetic-to-native`, `html-template-cleanup` |

`html-template-cleanup` explicitly *"fixes several HTML warnings/errors generated by the `@lwc/template-compiler`"* — i.e. Salesforce's own codemod is template-compiler-aware, which corroborates our choice of parser. But the tool is entirely intra-LWC: renderMode flags, `this.template` rewrites, `.scoped.css` renames. **No cross-framework capability, and no verification beyond "it still compiles."**

### 2.3 Third-party Aura→LWC converters — unverifiable, treat as vapour

- **`aura-to-lwc.vercel.app`** ("Free Aura to LWC Converter") — the page fetched as a bare title with no content. **Could not verify what it does, who runs it, or whether it still works.** Do not cite as a real tool.
- **`BuildLoop.aura2lwc`** (VS Code Marketplace) — exists as a listing; not fetched in depth. Marketed as "converts Aura Components to LWC on the fly." **[inference]** given the category, it is regex/template-level with no verification; unconfirmed.

---

## 3. The LWC off-platform ecosystem — who runs LWC outside Salesforce?

### 3.1 LWC Open Source core — alive and shipping fast

npm registry confirms the whole `@lwc/*` family at **9.4.0, published 2026-08-10** (the day before this survey): `@lwc/template-compiler`, `@lwc/compiler`, `@lwc/engine-dom`, `@lwc/engine-server`, `@lwc/ssr-compiler`, `@lwc/ssr-runtime`, `@lwc/signals`, `@lwc/rollup-plugin`, `@lwc/babel-plugin-component`. MIT, https://lwc.dev.

**This is load-bearing for us:** our oracle depends on `@lwc/template-compiler` and Node-side LWC rendering, and both are first-party, current, and released weekly-ish. No abandonment risk.

### 3.2 Does anyone else render LWC in Node? Yes — three, and only one verifies anything

1. **`@lwc/engine-server` + `@lwc/ssr-compiler` (9.4.0)** — first-party. Renders LWC to a **string** in Node, synchronously, single pass. This is the same primitive our oracle uses. Salesforce uses it for LWR SSR + islands hydration on Experience Cloud.
2. **`@lwc/test-runner` (1.3.1, published 2024-07-17)** — **the closest thing to a differential oracle in the entire ecosystem.** Runs specs in **headless Chrome**, parallel tabs, *"as many as ten thousand tests can complete in under six seconds."* API: `renderToMarkup()` → `insertMarkupIntoDom()` → `hydrateElement()`, plus the assertion **`visuallyIdenticalInCSRandSSR`**, described as *"a pixel match of SSR and CSR components."* Fixture props are passed as plain objects; specs are `*.spec-ssr.js`.
   - **But:** it compares **LWC to LWC** (server render vs client render of the same component). It is a hydration-correctness tool, not a migration tool. Nobody has ever pointed it across a framework boundary.
   - Also note LWC's runtime **hydration mismatch warning** — the engine already logs when SSR HTML *"doesn't match the output of its first rendering cycle on the client."* That is a shipped, production-grade instance of the "two renderers must agree" discipline.
3. **`@salesforce/sfdx-lwc-jest` (7.9.0, 2026-04-01) / `@lwc/jest-preset` (19.6.1, 2026-04-15)** — jsdom rendering + `@lwc/jest-serializer` snapshot serializer + `@salesforce/sfdx-lwc-jest/dist/lightning-stubs` for base components and wire mocks (`registerLdsTestWireAdapter` et al). Renders LWC in Node, but verification is **self-snapshots**, not cross-implementation diffs.

### 3.3 LWC Garden — the best community off-platform dev tool

| Field | Value |
|---|---|
| URL | https://lwc.garden · https://github.com/lukethacoder/lwc-garden |
| License | **GPL-3.0** (viral — cannot be vendored into a permissive codebase) |
| Activity | 33 stars, 5 forks, 91 commits, last push **2026-01-11** (updated 2026-02-24). Maintained but low-velocity, one maintainer (Luke Secomb). |
| Maturity | Maintained OSS side project, not commercial |

Positioned as the replacement for `@salesforce/lwc-dev-server` (*"has not received an update since 2021"*). Capabilities relevant to us:
- Runs **on-platform folder structures** (`force-app/...`) locally, resolving `lightning/*` imports, Custom Labels and Static Resources.
- **Mocks Apex, OmniScript, AppExchange packages and any on-platform import** — the same mocking problem our fixture layer solves.
- **`argTypes` for `@api` properties** — a Storybook-style args UI for driving component inputs. This is the single best DX idea in the ecosystem for fixture authoring.
- Slot pre-filling, SLDS out of the box, HMR.
- **Verification: none.** No diffing, no assertions, no oracle. It is a dev server.
- Bundler: README "built with" lists webpack/pnpm per the fetched page; other sources say Vite. **[inference]** — treat as unresolved, it does not affect us.

### 3.4 Dead/deprecated off-platform tooling (important negative)

- **`lwc-services`, `create-lwc-app`, `rollup-plugin-lwc-typescript`** — all **deprecated, support ended 2022-03-31**, never revived. Salesforce's blog: *"It's Time to Say Goodbye to create-lwc-app."*
- **`@salesforce/lwc-dev-server`** — unmaintained since 2021 (per LWC Garden; superseded on-platform by `sf lightning dev`) **[inference]**.
- **`adaptive-lwc-ds`** (0.0.5, 2022-02-11) — "LWC OSS project with Lightning base components, SLDS and Jest." Dead.
- lwc.dev now points standalone-app users at **`lwr`** (Lightning Web Runtime), not a create-app CLI.

**Net:** the off-platform LWC *dev* story is thin and community-carried; the off-platform LWC *runtime* story (LWR/SSR) is first-party and healthy. Nobody in either camp verifies a conversion, because nobody is converting.

---

## 4. Adjacent: migrating Salesforce UI to other stacks

### 4.1 Salesforce Multi-Framework — the biggest 2026 development, and it is *not* a migration path

| Field | Value |
|---|---|
| Announced | Open beta **2026-04-15** (TDX 2026); **GA July 2026** (Summer '26) |
| Docs | https://developer.salesforce.com/docs/platform/multiframework/guide/reactdev-overview.html |
| Metadata | new **`UIBundle`** type — *"a built React app, deployed to Salesforce as a unit"*, in `force-app/main/default/uiBundles/` |
| Toolchain | Vite + TypeScript + Vitest, Tailwind + shadcn/ui preconfigured; `sf project deploy start` |
| SDK | `@salesforce/sdk-data` **1.135.0 (2026-05-05)** — *"Runtime SDK for accessing Salesforce record data via GraphQL and REST from React web apps."* Siblings: `@salesforce/sdk-view` (modals/toasts/theming), `@salesforce/sdk-chat`. `createDataSDK()` handles auth — no manual OAuth. |
| Templates | `reactinternalapp` (App Launcher/SSO), `reactexternalapp` (Experience Cloud) |

What it explicitly does **not** do:

- **No LWC→React migration tooling and no migration guidance.** Every official and secondary source says the same thing: *"Multi-Framework doesn't replace LWC; it runs alongside it… Multi-Framework is an additive capability, not a migration mandate."*
- **No `lightning-*` base components in React.** You bring shadcn/MUI/Ant. (SLDS CSS itself remains available as a framework-agnostic stylesheet — `@salesforce-ux/design-system` 2.264.0, 2026-07-22.)
- **No `@wire`.** *"Don't reach for `@wire`. It's not how React apps consume data here. Use the SDK's GraphQL hooks and Apex `fetch()` instead."* and *"Wire adapters and Lightning Data Service stay on the LWC side of the house."*
- **No React inside Lightning pages yet.** Embedding React components alongside LWC on a Lightning page requires **Micro-Frontend support**, which is Developer Preview / closed pilot. Sources conflict on the target release (one says Spring '26 closed pilot, another says Spring '27) — **unresolved**.
- GA breaking changes from beta: package import renames, `.query()`/`.mutate()` split, metadata target `AppLauncher` → `CustomApplication`.

**Strategic read:** Salesforce has created the destination but not the road. A customer who wants their existing LWC estate in React today has an officially supported *runtime* and **zero** official *conversion*. That is exactly the gap our tool sits in — and it also means our output format should arguably be a `UIBundle`, not generic React (see §7.2).

### 4.2 Lightning Out 2.0 — the official "LWC off-platform" answer (GA Winter '26)

Architecture: **LWR runtime + iframe inside shadow DOM + `window.postMessage()`** for events. You define a Lightning Out app in Setup and drop generated markup into any external React/Angular/Vue page.

It is the main *alternative* to conversion — and its limitations are why conversion still has a market:
- **Lightning base components are NOT supported.** You must wrap each `lightning-*` usage in a custom LWC.
- **Aura components not supported** (post-GA roadmap).
- **`lightning/navigation` not supported** — no page navigation from embedded components.
- **Authenticated Salesforce users only.** No unauthenticated/guest access; no JWT bearer flow; no client-credentials flow.
- **Requires third-party cookies** enabled in the browser plus cross-domain session cookies in the org — a hard blocker as browsers phase these out **[inference]**.
- Perf: a JS runtime per page load, and *"every component in an iframe makes a connection to Salesforce"* — five embedded components, five connections.
- You cannot load the LO2 library from inside an LWC (LWS blocks script injection).

**Verification story: none.** It's a runtime, not a migration.

### 4.3 SLDS-for-React: `salesforce/design-system-react`

BSD-3-Clause, **community-supported / maintenance mode** (134 open issues, 23 open PRs; the a11y audit cadence in the README last records **November 2019**). SLDS 1-era; no evidence of SLDS 2 support. It is the obvious off-the-shelf target for `lightning-*` → React mapping, and it is *not* being actively driven by Salesforce. **[inference]** relying on it as our base-component target would be a maintenance liability; a catalog-driven SLDS→CSS approach (ours) has less bus factor.

Related: **`salesforce/base-components-recipes` is ARCHIVED (2023-05-30, MIT)**; Salesforce redirects source-seekers to the npm package **`lightning-base-components` 1.28.19-alpha (2026-05-15)**, *"provided as-is with no support contract."* That package is the practical ground truth for base-component behaviour and is still being published.

### 4.4 `@ashokreddy1828/sf-react-ui` — unverified, probably a personal project

npm registry: v1.0.11, **2026-05-20**, *"React equivalent of lightning-base-components for Salesforce — SfRecordForm, SfProvider and more."* The npm page returned **HTTP 403** to our fetcher, so **nothing beyond the registry blurb is verified** — no license, no downloads, no repo confirmed. **[inference]** a personal-scope package published three months ago is almost certainly an individual's experiment, not a viable dependency. Flagged for completeness only.

### 4.5 Cross-framework migration prior art outside Salesforce

- **`ng2react`** (https://github.com/ng2react/vscode, MIT, *"Early Alpha"*) — AngularJS→React VS Code extension. TypeScript parsing for *analysis*, but the conversion itself is an **OpenAI GPT call**. Offers test generation and prompt review. Its own README: *"The generated code is not guaranteed to be correct. It is generated by an AI model and may contain bugs."* **No verification.** This is the honest state of the art for LLM-based framework migration.
- **Codemod.com** — compiler-aware code intelligence platform, 1,000+ codemods, agent-oriented (`npx codemod ai`), claims up to 90% token reduction. Relevant as *distribution/packaging* prior art. No LWC content.
- **Salesforce Engineering's own AI refactor case study** — 275 Apex classes / 3,500+ files moved in ~4 months vs a 2-year manual estimate. Apex, not UI; cited only as evidence that Salesforce's internal position is "LLM refactor + human review," with no differential oracle.
- **Visual regression vendors** (Applitools Eyes 10.22 with Storybook addon, Jan 2026; Percy/Sauce; Provar and UTAM for Salesforce UI) — these are the *commercial* answer to "did the UI change?" None of them is wired to a migration tool; a human sets up both sides. UTAM is notable because Salesforce built it precisely because *"Salesforce continuously changes the DOM in every release and migrates pages from Aura to Lightning"* — i.e. Salesforce's institutional answer to migration verification is **page objects + UI tests written by humans**.

---

## 5. Feature comparison table

Legend: ✅ full · ◐ partial · ❌ none · — not applicable

| Tool | Direction | Input it parses | Approach | **Verification** | `@wire` | `lightning-*` base cmps | Apex | Styling/SLDS | Maturity / last activity |
|---|---|---|---|---|---|---|---|---|---|
| **Ours** | LWC→React | **Real `@lwc/template-compiler` AST** + component JS | **Deterministic codemod** | ✅ **Differential oracle**: renders original LWC and generated React against identical fixtures, diffs component-boundary trees | ✅ TanStack Query shim preserving wire semantics | ◐ catalog-driven | ◐ via shim | ✅ catalog-driven SLDS→CSS | Active (this project) |
| `blittle/lwc2react` | LWC→React | **Compiled LWC JS output** (rollup plugin) | Rewrite of compiled artifact | ❌ none | ❌ silently stubbed | ❌ | ❌ | ◐ scoped CSS only | POC, dead 2020-12; no license |
| `@salesforce/mcp` aura-experts | **Aura→LWC** | Aura bundle (LLM-read) | **LLM prompting** + PRD blueprint | ◐ **checklist only** (`verify_aura_migration_completeness`, `score_issues`) — nothing executed; real check is manual screenshots | — | ✅ (target is LWC) | ◐ guidance | ✅ SLDS guidance tools | Beta/GA-mixed; 2026-07-09 |
| `salesforce/lwc-codemod` | LWC→LWC | LWC HTML/JS (template-compiler aware) | Deterministic codemod | ❌ (compiles-clean only) | — | — | — | renames `.css`→`.scoped.css` | Maintained; 2026-08-04 |
| **Salesforce Multi-Framework** | *(none — greenfield React)* | — | New runtime + `UIBundle` metadata | ❌ no migration ⇒ no verification | ❌ **replaced** by GraphQL hooks | ❌ not available in React | ✅ Apex `fetch()` | Tailwind/shadcn; SLDS CSS optional | **GA July 2026** |
| **Lightning Out 2.0** | *(none — embeds LWC as-is)* | — | LWR + iframe + `postMessage` | — | ✅ (real LWC runtime) | ❌ **unsupported**, must wrap | ✅ | ✅ | GA Winter '26 |
| **LWC Garden** | *(none — dev server)* | LWC source | Local dev server + mocks + `argTypes` | ❌ | ◐ mockable | ✅ resolves `lightning/*` | ✅ mockable | ✅ SLDS built in | Maintained; 2026-01-11; **GPL-3.0** |
| `@lwc/test-runner` | LWC↔LWC (SSR vs CSR) | LWC source | Headless-Chrome harness | ✅ **pixel match** (`visuallyIdenticalInCSRandSSR`) + hydration mismatch warnings | ◐ | ✅ | ◐ | ✅ (pixels) | First-party; 1.3.1 (2024-07) |
| `sfdx-lwc-jest` | *(none — unit tests)* | LWC source | jsdom + snapshot serializer | ◐ **self-snapshots** (no cross-impl diff) | ◐ wire test adapters | ◐ stubs | ◐ mocks | ❌ | First-party; 2026-04-01 |
| `design-system-react` | *(none — component lib)* | — | Hand-written React SLDS components | ❌ | — | ◐ React equivalents (SLDS 1) | — | ✅ SLDS 1 | Maintenance mode, community |
| `ng2react` | AngularJS→React | TS parse for analysis | **GPT prompt** | ❌ ("not guaranteed to be correct") | — | — | — | — | Early alpha, MIT |
| Mitosis / awesome-component-converters | many→many | JSX/etc. | AST compiler | ◐ (snapshot tests of own outputs) | — | — | — | — | Active — **but zero LWC support** |

---

## 6. Where we are genuinely ahead

Stated plainly, because the survey supports it:

1. **We are the only tool that verifies a cross-framework conversion by execution.** Every converter found (lwc2react, ng2react, the MCP Aura agent, any AI codemod) ships code and hopes. The only execution-based comparison in the ecosystem is `@lwc/test-runner`, and it never crosses a framework boundary. A differential oracle over identical fixtures is, as far as this survey can establish, **novel in the Salesforce ecosystem**.
2. **We are the only tool that parses LWC templates.** `lwc2react` works on compiled output — which is why it silently loses semantics. `lwc-codemod` is template-compiler-aware but stays inside LWC. Nobody else consumes the `@lwc/template-compiler` AST to emit another framework.
3. **We are the only tool that preserves wire semantics.** `lwc2react` stubs `@wire`. Salesforce's official position for React is *delete `@wire` and rewrite the data layer by hand*. A shim that preserves reactive-stream/refresh semantics behind TanStack Query has no counterpart anywhere.
4. **Deterministic beats nondeterministic for audit.** Salesforce's own docs warn their migration output is *"often nondeterministic"* and requires manual review. A deterministic codemod produces reviewable, re-runnable, diff-stable output — which is the difference between a one-time consulting exercise and a repeatable migration.
5. **SLDS handling.** The only alternatives are: hand-mapping to `design-system-react` (maintenance mode, SLDS 1, last a11y audit 2019) or "bring your own component library" (Multi-Framework's answer). A catalog-driven converter is defensible.

---

## 7. What they do that we don't — concrete, implementable, ranked by value

### 7.1 Pixel/visual diffing on top of tree diffing — **HIGH**
*From: `@lwc/test-runner`'s `visuallyIdenticalInCSRandSSR`; Applitools Storybook addon.*
Our oracle diffs **component-boundary trees**. That is the right primary signal, but it is structurally blind to CSS: a wrong class, a dropped `.slds-` token, a broken grid, an inherited style that no longer inherits — all pass a tree diff and fail a user. Salesforce solved the equivalent problem for SSR/CSR by pixel-matching in headless Chrome, at ~10k assertions in <6s.
**Implementable:** mount LWC and generated React side by side in Playwright/headless Chrome against the same fixture, screenshot both, image-diff with a tolerance, and diff **computed styles** for every matched node as a cheaper, less flaky middle tier. Computed-style diffing is probably the higher-value half — it localizes the failure to a node and a property instead of "these pixels differ."

### 7.2 Emit a deployable Salesforce `UIBundle`, and map `@wire` → `@salesforce/sdk-data` — **HIGH**
*From: Salesforce Multi-Framework GA (July 2026).*
This is the strategic gap. Salesforce now has a **GA, production-deployable React runtime on-platform**, with `UIBundle` metadata, `createDataSDK()` auth, GraphQL `.query()`/`.mutate()`, and Apex `fetch()`. If our output is generic React, a customer still has to solve deployment, auth and data access themselves. If we emit a `UIBundle`-shaped project, our conversion becomes *deployable to production on the vendor's blessed path* on day one.
**Implementable:** a second emitter target (`--target=uibundle`) producing the `force-app/main/default/uiBundles/` layout + Vite config; and a second wire-shim backend that resolves our preserved wire semantics onto `@salesforce/sdk-data` GraphQL/Apex instead of a generic fetcher. Keep the TanStack Query shim as the semantic layer — swap only the transport. Note GA breaking changes (`.query()`/`.mutate()` split, `CustomApplication` target) and that **base components do not exist in that runtime**, which makes our SLDS catalog *more* valuable there, not less.

### 7.3 A framework-agnostic blueprint / PRD as a review artifact + LLM fallback tier — **MEDIUM-HIGH**
*From: `create_aura_blueprint_draft` / `enhance_aura_blueprint_draft`.*
Salesforce's pipeline emits a human-readable YAML/PRD describing structure, purpose, references and state **before** generating code. Two benefits we lack: (a) a reviewable artifact a tech lead can sign off on per component, and (b) a clean handoff point where a **bounded LLM tier** can take components our deterministic codemod refuses — the codemod produces the blueprint + a precise list of unhandled constructs, and the LLM fills only those holes, with our oracle as the accept/reject gate. That last part is the combination nobody has: **LLM generation with a differential oracle as the fitness function.** It converts "nondeterministic and unverifiable" into "nondeterministic but *verified*."

### 7.4 An interop escape hatch: embed unconverted LWC rather than failing — **MEDIUM-HIGH**
*From: Lightning Out 2.0; Multi-Framework micro-frontend preview.*
Migrations stall on the 5% of components that can't be converted (heavy base components, `lightning/navigation`, third-party managed-package LWC). Both Salesforce answers to this are *embedding*. We could emit, for any component the codemod declines, a React wrapper that mounts the **original LWC** as a custom element via `@lwc/engine-dom` (off-platform) or Lightning Out 2.0 (on-platform), so a partial migration still ships.
Caveats worth documenting in our output: LO2 does **not** support base components (each needs a custom wrapper), does not support `lightning/navigation`, requires third-party cookies, and is authenticated-users-only.

### 7.5 Accessibility as a first-class diff — **MEDIUM**
*From: `run_lwc_accessibility_jest_tests`, `guide_component_accessibility` (both GA); SLDS blueprints are accessibility-defining.*
Since we already render both sides, running axe against both and diffing the **violation sets** (and the accessibility tree) is nearly free and catches an entire class of regressions that tree diffs miss — a `<div role="button">` where a `lightning-button` used to be. Salesforce treats a11y as part of migration completeness; we currently don't measure it at all.

### 7.6 Fixture authoring ergonomics: `argTypes` + auto-generated mocks — **MEDIUM**
*From: LWC Garden.*
Garden's best idea is declaring `@api` properties as **args with types**, giving a live control panel, plus slot pre-filling and one-line mocks for Apex/managed-package imports. Our fixtures are hand-written, which is the throughput bottleneck on any real estate of components. Deriving default `argTypes` from the `@api` declarations in the component's own AST (which we already have) would auto-generate a first-cut fixture per component, with a UI to refine it. (Note Garden is **GPL-3.0** — take the *idea*, not the code.)

### 7.7 A readiness/completeness score and a migration report — **MEDIUM (cheap)**
*From: `verify_aura_migration_completeness`, `score_issues` (0–100 + quality grade).*
Salesforce's checklist is weak *as verification*, but it's strong *as a product surface*: per-component scores let a lead triage 400 components and report progress to a steering committee. We have far better raw data (oracle pass/fail, unhandled-construct counts, style-diff deltas) and currently surface none of it as a portfolio-level score. Low effort, high perceived value.

### 7.8 Hydration-mismatch discipline as an extra oracle mode — **LOW-MEDIUM**
*From: LWC's own SSR/CSR hydration warning; `renderToMarkup`→`insertMarkupIntoDom`→`hydrateElement`.*
LWC already flags when server HTML *"doesn't match the output of its first rendering cycle on the client."* If we ever emit SSR-capable React, running the same three-phase comparison gives a second, independent oracle for free. Also worth stealing: their spec naming convention (`*.spec-ssr.js`) and parallel-tab execution model for making 10k comparisons cheap.

### 7.9 Distribution: ship as an MCP server / VS Code surface — **LOW-MEDIUM**
*From: `@salesforce/mcp` (0.30.15, actively released), Codemod.com's `npx codemod ai`, ng2react's VS Code extension.*
The whole ecosystem's distribution channel in 2026 is "an MCP server the coding agent calls." A thin MCP wrapper (`convert_lwc_component`, `run_oracle`, `explain_unhandled`) makes our deterministic codemod usable *from inside* Agentforce Vibes/Claude Code sessions — and positions the oracle as the verification layer those agents conspicuously lack.

### 7.10 Codemod registry / recipe packaging — **LOW**
*From: Codemod.com.*
Publishing individual transforms as versioned, independently runnable recipes helps adoption and lets users run a subset. Nice-to-have; no correctness value.

---

## 8. Things worth *not* copying

- **PRD-only verification** (Salesforce's checklist + screenshots). It reads as rigorous and verifies nothing executable. If we add a score (§7.7), it must be computed **from oracle results**, never from an LLM reading source.
- **Compiled-output rewriting** (`lwc2react`). The survey confirms this is why that project silently dropped semantics.
- **Depending on `design-system-react`** as the base-component target: maintenance mode, SLDS 1, community-supported, a11y audit trail ends 2019.
- **GPL-licensed code** (LWC Garden) and **unlicensed code** (`lwc2react` declares no license — copying from it is not permitted regardless of how instructive it is).

---

## 9. Sources

Every URL below was actually fetched or returned by search during this survey (2026-08-11).

**Salesforce official — Multi-Framework / React**
- https://developer.salesforce.com/blogs/2026/04/build-with-react-run-on-salesforce-introducing-salesforce-multi-framework
- https://developer.salesforce.com/blogs/2026/07/build-with-react-on-salesforce-multi-framework-is-now-ga
- https://developer.salesforce.com/docs/platform/multiframework/guide/reactdev-overview.html
- https://developer.salesforce.com/docs/platform/multiframework/guide/reactdev-lwc-diff.html

**Salesforce official — MCP / migration tooling**
- https://developer.salesforce.com/docs/platform/lwc/guide/mcp-intro.html
- https://developer.salesforce.com/docs/platform/lwc/guide/mcp-aura.html
- https://developer.salesforce.com/docs/platform/lwc/guide/mcp-migration.html
- https://developer.salesforce.com/docs/platform/lwc/guide/mcp-reference.html
- https://developer.salesforce.com/blogs/2026/01/migrate-from-aura-to-lwc-with-agentforce-vibes

**Salesforce official — Lightning Out 2.0 / SSR / base components**
- https://developer.salesforce.com/docs/platform/lwc/guide/lightning-out-intro.html
- https://developer.salesforce.com/docs/platform/lwc/guide/lightning-out-limitations.html
- https://developer.salesforce.com/blogs/2025/10/lightning-out-2-0-is-now-generally-available-in-winter-26
- https://developer.salesforce.com/docs/platform/lwr/guide/lwr-ssr-components-test.html
- https://developer.salesforce.com/blogs/2022/02/its-time-to-say-goodbye-to-create-lwc-app
- https://lwc.dev/

**GitHub repos (fetched, incl. API metadata)**
- https://github.com/blittle/lwc2react · https://api.github.com/repos/blittle/lwc2react
- https://github.com/salesforce/lwc-codemod · https://api.github.com/repos/salesforce/lwc-codemod
- https://github.com/lukethacoder/lwc-garden · https://api.github.com/repos/lukethacoder/lwc-garden
- https://github.com/salesforce/design-system-react
- https://github.com/salesforce/base-components-recipes
- https://github.com/ccoenraets/lightning-react
- https://github.com/ng2react/vscode
- https://raw.githubusercontent.com/milahu/awesome-component-converters/master/readme.md

**npm registry search API (hard version/date evidence)**
- https://registry.npmjs.org/-/v1/search?text=lwc%20react%20convert&size=25
- https://registry.npmjs.org/-/v1/search?text=lightning-base-components&size=15
- https://registry.npmjs.org/-/v1/search?text=%40lwc%2Ftest-runner&size=5
- https://registry.npmjs.org/-/v1/search?text=%40salesforce%2Fsdk&size=20
- https://registry.npmjs.org/-/v1/search?text=%40salesforce%2Fmcp&size=5

**Secondary / community (search-surfaced, used for corroboration)**
- https://scalefirst.dev/2026/05/react-apps-salesforce-multi-framework-summer-26/
- https://lwc.garden/
- https://aura-to-lwc.vercel.app/ *(fetched — returned no usable content; tool unverified)*
- https://www.npmjs.com/package/@ashokreddy1828/sf-react-ui *(fetch returned HTTP 403; unverified)*
- https://engineering.salesforce.com/how-ai-driven-refactoring-cut-a-2-year-legacy-code-migration-to-4-months/
- https://codemod.com/
- https://mitosis.builder.io/docs/overview/
