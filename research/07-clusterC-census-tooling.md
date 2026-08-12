# Cluster C — Census Tooling (R6 + R7)

**Status:** COMPLETE — blocking gate cleared for M-1 (the org census)
**Date:** 11 August 2026
**Covers:** R6 (LWC static analysis at org scale), R7 (Apex parsing and dependency graphing)
**Method:** web research + **executed spikes** against this repo's `force-app` fixtures. Where a claim is empirical, it is labelled **[verified]** with the command output that proves it. Where it is reasoning, it is labelled **[inference]**. Where a tool's 2026 status could not be established, it says so.

---

## 0. VERDICT — read this first

> ### The census is a **weekend of glue code**, not a two-week build.
>
> Concretely: **3–5 working days** for a production-grade census covering both LWC and Apex, of which roughly **1 day is LWC extraction, 1 day is Apex extraction, 1 day is graph assembly + tiering, and 1–2 days is edge-case hardening against your real org.**

The reason it is cheap is not that a census tool exists — **it does not**. It is that **the two hard parts, the parsers, are already written, maintained, and directly callable from Node.**

- `@lwc/template-compiler` exports a `parse()` that returns the real LWC template AST. **[verified]** — spike ran, extracted `lightning-*` tags, `c-*` children, directives, event listeners and named slots from all three fixture bundles, zero warnings.
- `@apexdevtools/apex-parser@5.1.0` (ANTLR4, published 3 Jul 2026) parses Apex into a full parse tree with named contexts. **[verified]** — spike ran, extracted class name, `with/inherited sharing`, `extends`/`implements`, `@AuraEnabled(cacheable=…)`, full method signatures with typed params, per-query sObjects **and** the SOQL access mode (`USER_MODE` / `WITH SECURITY_ENFORCED` / default), plus static class references.

Everything else in the census spec is a `for` loop over those two ASTs plus `fast-xml-parser` on `.js-meta.xml`.

**Performance is a non-issue. [verified]**

| Workload | Measured |
|---|---|
| 300 LWC bundles (template `parse` + JS `@babel/parser`) | **261 ms** |
| Module load (one-time) | 70 ms |
| 500 Apex class parses | **1 764 ms** (≈3.5 ms/class) |

An org with 1 000 LWCs and 3 000 Apex classes parses in **under 15 seconds**. There is no need for incremental caching, worker pools, or a database. Write JSON to disk and move on.

### The two things that would make it a two-week build (and why they don't apply)

1. **Wanting a *semantically resolved* Apex graph** (real overload resolution, inheritance-aware method binding, cross-namespace type resolution). That is a compiler front-end, and writing one is genuinely weeks. **You do not need it.** Migration ordering needs a *conservative over-approximation* of the edges, which name-based reference collection gives you. See §7.4.
2. **Wanting the census to be *complete* rather than *useful*.** Dynamic `lwc:component`, computed Apex invocations, and `Type.forName` will always escape static analysis. Budget an `unresolved[]` bucket and a manual review queue instead of chasing them. See §9.

---

## 1. Build vs buy — the recommendation

**BUY the parsers. BUILD the census. Do not buy a census tool; none of them emit the shape you need.**

| Candidate | What it actually is | Verdict for M-1 |
|---|---|---|
| **`@lwc/template-compiler` `parse()`** | The real LWC template parser, same one the platform compiles with | **BUY — core dependency** |
| **`@babel/parser` + `@babel/traverse`** | JS AST; LWC JS is plain ESM + decorators | **BUY — core dependency** |
| **`@apexdevtools/apex-parser`** | ANTLR4 Apex grammar, actively maintained, JS/TS target | **BUY — core dependency** |
| **`fast-xml-parser`** | `.js-meta.xml` | **BUY — core dependency** |
| Salesforce Code Analyzer v5 | Violation reporter across 6 engines | **Adjacent — use for risk flags, not inventory.** See §3 |
| `@lwc/eslint-plugin-lwc` | Lint rules for LWC | **Adjacent — mine its rule list as a risk checklist.** See §4 |
| `@salesforce/eslint-plugin-lwc-graph-analyzer` (Komaci) | Wire-graph static-analysability checker for offline/priming | **Interesting signal, wrong output shape.** See §5 |
| `lwc-dependency-viewer` | Regex scanner + cytoscape graph | **Do not depend on it. Regex-based.** See §6 |
| Tooling API `MetadataComponentDependency` | Org-side dependency rows | **Optional cross-check only.** See §6.3 |
| `apexlink` / `@apexdevtools/apex-ls` | Scala/ScalaJS Apex semantic analyser | **Fallback if you later need real type resolution.** See §7.5 |
| SFGE (Salesforce Graph Engine) | Path-based DFA for security violations | **Not a graph exporter.** See §3.3 |

---

## 2. Verified package versions — the recommended stack

All versions below were read from the **npm registry on 11 Aug 2026** via `npm view`, including the actual publish date of the latest version (not the `time.modified` field, which is misleading — several Salesforce packages show a bulk metadata touch on 2026-04-17 that is *not* a release).

### Core — install these

| Package | Version | Latest publish | Maintained? |
|---|---|---|---|
| `@lwc/template-compiler` | **9.4.0** | 2026-08-10 | **Yes — actively.** 880 versions, released yesterday |
| `@lwc/compiler` | 9.4.0 | 2026-08-10 | Yes |
| `@babel/parser` | **7.29.8** (8.0.4 exists) | current | Yes |
| `@babel/traverse` | **7.29.8** | current | Yes |
| `@apexdevtools/apex-parser` | **5.1.0** | 2026-07-03 | **Yes.** BSD-3, ANTLR runtime `antlr4@4.13.2` |
| `fast-xml-parser` | **5.10.1** | 2026-07-16 | Yes |

### Adjacent / optional

| Package | Version | Latest publish | Note |
|---|---|---|---|
| `@salesforce/plugin-code-analyzer` | 5.15.0 | 2026-07-29 | The `sf code-analyzer` CLI plugin |
| `@lwc/eslint-plugin-lwc` | 3.5.0 | 2026-03-27 | eslint ^9 peer |
| `@lwc/eslint-plugin-lwc-platform` | 6.3.0 | 2025-09-30 | Platform-module rules |
| `@salesforce/eslint-config-lwc` | 4.1.2 | 2025-12-11 | eslint ^9 peer |
| `@salesforce/cli` | 2.146.3 | 2026-08-11 | Only needed for org-side queries |

### ⚠️ Correction to the R6 brief — a package in the brief no longer exists

**`@salesforce/eslint-plugin-lwc` returns HTTP 404 on the npm registry. [verified]**

```
npm error 404 Not Found - GET https://registry.npmjs.org/@salesforce%2feslint-plugin-lwc
```

The official ESLint rules for LWC now ship as **`@lwc/eslint-plugin-lwc`** (repo is still `github.com/salesforce/eslint-plugin-lwc`; the npm scope moved to `@lwc`). Anything in the project docs referencing `@salesforce/eslint-plugin-lwc` should be corrected. Related packages that *do* still live under `@salesforce/`: `eslint-config-lwc`, `eslint-plugin-lightning` (2.0.0), `eslint-plugin-aura` (3.0.0).

### ☠️ Dead — do not use

| Package | Last publish | Status |
|---|---|---|
| `apex-parser` (unscoped, `nawforce/apex-parser`) | **2023-02-05**, v2.17.0 | **Abandoned.** Superseded by `@apexdevtools/apex-parser` |
| `apexlink` (npm) | **2022-06-06**, v2.3.5 | **Abandoned on npm.** The Scala project lives on as `@apexdevtools/apex-ls` |
| `lwc-services` | 2022-05-08 | Dead |

**Status I could not fully verify:** `@apexdevtools/apex-ls` last published **2025-11-27** (v6.0.2) — 8 months stale as of today. The GitHub repo shows 2026 copyright and ~3 280 commits, so it appears alive, but **I cannot confirm from npm that it is actively released in 2026.** Treat as "probably maintained, not proven."

---

## 3. Salesforce Code Analyzer v5 — what it is and is not

**[verified from docs]** Code Analyzer v5 is a unified violation reporter. The CLI plugin is `@salesforce/plugin-code-analyzer` (v5.15.0, July 2026). v4 was **retired in August 2025** — any v4 guidance you find is dead.

Engines: **PMD** (currently PMD 7.25.0), **ESLint** (v8 and v9), **CPD**, **Regex**, **RetireJS**, **Flow Scanner**, **SFGE**.

### 3.1 What it gives you for free (worth taking)

The ESLint engine bundles, out of the box:
- `@salesforce/eslint-config-lwc/recommended`
- `plugin:@lwc/lwc-platform/recommended`
- `@salesforce-ux/eslint-plugin-slds` (SLDS 2 rules — relevant to your React styling story)
- `eslint-plugin-react`, `eslint-plugin-react-hooks`, `jsx-a11y` — **added in v5.10.0, Feb 2026.** This means Code Analyzer can lint the *generated React* as well as the source LWC, from one config. That is directly useful for the oracle pipeline's S6/S7 gates.

Output: `csv`, `xml`, `json`, `html`. Rule selection: `--rule-selector eslint:LWC`, `eslint:React`, `eslint:Custom`, with parenthesised grouping since v5.6.1.

### 3.2 Custom rules — the "ESLint as collector" trick

**[verified from docs]** v5 supports custom ESLint rules via `eslint_config_file` or `auto_discover_eslint_config: true`; custom rules are auto-tagged `Custom` and selectable with `--rule-selector eslint:Custom`. v5.12.0 (Apr 2026) added execution of custom rules by name. v5.11.0 (Mar 2026) added **MCP tools for custom PMD rule generation**, and v5.14.0 (Jun 2026) added an **`ast-dump` command** that prints the AST for Apex/Visualforce/HTML/XML/JavaScript as XML or JSON, specifically to help author XPath for custom PMD rules.

You *could* write custom ESLint rules that emit one "violation" per census fact and parse the JSON report. **Do not.** It inverts the tool: you would be encoding structured data into a diagnostic channel, losing types, fighting severity/exit-code semantics, and paying a full ESLint bootstrap for every run. The direct-AST approach in §8 is ~120 lines and 10× faster. **[inference]**

`ast-dump` is, however, genuinely useful **as an exploration aid** while you learn the Apex grammar — it is a faster way to answer "what is this node called" than writing dump scripts. **[inference]**

### 3.3 SFGE is not a graph exporter

**[verified from docs]** SFGE does path-based data-flow analysis: it takes a parse tree, loads vertices into an Apache TinkerPop graph, builds code paths from entry points, and applies rules along each path. Every violation carries a source vertex and a sink vertex.

So the graph exists internally — **but the documented output is violations only (JSON/XML). There is no documented "export the graph" command.** Documented SFGE limitations that matter to you:
- does not scan **Apex triggers**
- does not handle anonymous Apex
- Apex property chains **depth ≤ 2**
- requires **unique class names across files**

v5.11.0 (Mar 2026) improved SFGE speed/stability on large codebases (reduced timeouts, more parallelism).

**Where SFGE *is* worth running:** its CRUD/FLS rules are the cheapest way to populate `lwcs_touching_FLS_or_sharing[]` — the field that drives your R1 security risk and one of the two kill-criteria gates. Run it once, take the violation list, join back to classes, join classes to LWCs via the `@salesforce/apex/*` edges. **[inference]**

**Caveat I could not resolve:** SFGE historically depended on **Jorje**, Salesforce's closed-source binary parser. The v5 "Work with Salesforce Graph Engine" page does not state which front-end v5 uses. **I cannot confirm whether v5's SFGE still uses Jorje or has moved to the open apex-parser + Summit-AST stack that PMD 7 adopted.** Assume it may still be a binary blob, and therefore that SFGE is a JVM-dependent, slower, less scriptable component than the rest of your stack.

---

## 4. `@lwc/eslint-plugin-lwc` — use its rule list as your risk checklist

**[verified from repo README]** The plugin (npm: `@lwc/eslint-plugin-lwc@3.5.0`, peer `eslint@^9` + `@babel/eslint-parser@^7`) ships these rules. Several map one-to-one onto census fields and tiering signals:

| Rule | Census relevance |
|---|---|
| `no-document-query` | **Direct hit** on `lwcs_with_querySelectorAll[]` — global DOM escape, forces Tier A/H |
| `no-inner-html` | `innerHTML` use — Tier H candidate |
| `no-async-operation` | `setTimeout`/`requestAnimationFrame` — timing-dependent, oracle-hostile |
| `no-leaky-event-listeners` | listeners added without teardown — affects lifecycle port |
| `prefer-custom-event` | raw `Event` vs `CustomEvent` |
| `no-unknown-wire-adapters`, `no-unexpected-wire-adapter-usages`, `valid-wire` | wire-adapter validity — feeds `wire_adapters_used[]` |
| `no-attributes-during-construction`, `no-host-mutation-in-connected-callback` | host mutation in constructor/`connectedCallback` — React-hostile |
| `no-api-reassignments`, `valid-api`, `no-leading-uppercase-api-name` | `@api` prop hygiene → React props |
| `no-template-children` | direct `this.template.children` traversal |
| `consistent-component-name`, `no-deprecated`, `no-disallowed-lwc-imports`, `valid-track`, `newer-version-available` | hygiene |
| `valid-graphql-wire-adapter-callback-parameters` | GraphQL wire — likely Tier H |
| **SSR family** (`ssr-no-restricted-browser-globals`, `ssr-no-unsupported-properties`, `ssr-no-node-env`, `ssr-no-disallowed-lwc-imports`, `ssr-no-host-mutation-in-connected-callback`, `ssr-no-static-imports-of-user-specific-scoped-modules`, `ssr-no-form-factor`, `ssr-no-unsupported-node-api`) | **High-value proxy.** A component that is SSR-clean is far likelier to render in your Node-based oracle. Run the SSR ruleset across the org and treat violations as an oracle-risk score |
| Compat: `no-async-await`, `no-for-of`, `no-rest-parameter` | mostly irrelevant to you |

**Recommendation:** run this plugin org-wide **once**, in parallel with the census, and store the violation counts per component as extra census columns. It costs an afternoon and it gives you a second, independent risk signal that you did not have to write. It does **not** replace the census — ESLint tells you what is *wrong*, not what *exists*.

---

## 5. Komaci / `eslint-plugin-lwc-graph-analyzer` — right idea, wrong output

**[verified]** `@salesforce/eslint-plugin-lwc-graph-analyzer` wraps `@komaci/static-analyzer`. Komaci "interrogates a Lightning web component's `@wire` definitions and dependency graph" to decide whether the component is **statically analysable**, which is the precondition for LWC **data priming / offline** (Salesforce Mobile Offline).

This is the closest thing that exists to "an official LWC wire-dependency-graph extractor."

**Why it still isn't your tool:**
- Output is **diagnostics**, not a graph. The graph is built to answer yes/no, and is not exported.
- **Version drift.** The plugin's stable release is `1.0.0`; the newest published thing is `1.1.0-beta.2` from **2025-11-14** — 9 months stale. Its dependencies pin `@lwc/template-compiler ~3.5.0` and `@komaci/static-analyzer ^252.1.0`, while `@komaci/static-analyzer` itself is at **264.5.0** (2026-05-05) and `@lwc/template-compiler` is at **9.4.0**. Bringing this in drags a six-major-version-old template compiler into your tree.
- Its notion of "static analysability" is stricter than yours (it needs *primeable* graphs), so it will reject components your migration can handle fine.

**Verdict: do not depend on it.** **[inference]** But the *idea* is worth stealing: "can this component's data dependencies be determined without running it" is exactly your Tier M/A/H discriminator, and Komaci's `RULES.md` is a free enumeration of the ways `@wire` config defeats static analysis. Read it; don't link it.

---

## 6. Other LWC inventory tools surveyed

### 6.1 `lukethacoder/lwc-dependency-viewer` — regex, not AST

**[verified by reading `scripts/walk-files.ts` source]** It is a **regex scanner**, not a parser. Actual patterns from the source:

```
import\s*(?:{[^{}]*}|\w+)\s*from\s*['"]${importName}['"]
<${htmlComponentName}\b[^>]*[\s\S]*?\/${htmlComponentName}>
import\s+(?:.+?\s+from\s+)?'@salesforce\/apex\/(\w+)\.(\w+)'
@salesforce\/resourceUrl\/(\w+)
```

It strips newlines before matching, sacrificing positional accuracy. It is **not published to npm** (`npm view lwc-dependency-viewer` → 404); it is a clone-and-run repo with a hardcoded `FOLDER_TO_SEARCH` constant you must edit. Output is `output.json` for a cytoscape view.

**Verdict:** exactly the thing "don't hand-roll a parser before checking what exists" was meant to prevent you from *reinventing*, and also exactly the thing you should not *adopt* — because it hand-rolled the parser. Its self-closing-tag blind spot alone (`<c-foo />` will not match `<c-foo>...</c-foo>`) would silently drop edges from your dependency graph. **[inference]** Its `@salesforce/apex` and `resourceUrl` regexes are, however, a reasonable sanity cross-check against your AST results.

### 6.2 `DependencyGraphForSF` (VS Code Marketplace)

Covers LWC, Aura, Visualforce, Apex, triggers and Flows. **I could not verify its parsing method, licence, output format, or 2026 maintenance status** — it is a marketplace extension with no inspectable npm package. Not scriptable in CI. **Not recommended; not dismissed.**

### 6.3 Tooling API `MetadataComponentDependency` — a useful cross-check, not a source of truth

**[from search results; the Tooling API doc page itself was not fetched]** This is a **Beta** Tooling API object exposing org-computed dependency rows.

Limits that make it unsuitable as the primary source:
- **2 000-record cap per query** — an org of any size overflows it, and the object does not paginate like normal SOQL.
- Supported types: `ApexClass`, `ApexComponent`, `ApexPage`, `ApexTrigger`, `AuraDefinitionBundle`, `CustomObject`, `CustomField`, `CustomTab`, `CustomPermission`, `CustomApplication`. **Note the omission: `LightningComponentBundle` (LWC) is not on that list.** For an *LWC* census this is close to useless.
- Same-namespace only.
- Still Beta after years.

`forcedotcom/dependencies-cli` exists as an SFDX plugin over it; **I did not verify its 2026 maintenance status.**

**Use it for one thing:** validating your offline Apex class→class graph against the org's own view, on a sample, to estimate your false-negative rate. **[inference]**

### 6.4 sfdx-hardis

`sfdx-hardis@7.23.0`, published 2026-08-09 — **very actively maintained.** It generates an AI-written searchable documentation site covering Flows, Objects, Profiles, Apex and Lightning Pages, and 130+ commands take an `--agent` flag for non-interactive execution by coding agents.

**[inference]** This does not produce your census schema, but if you later want a human-browsable companion to `census.json`, this is the tool to wrap rather than build. Not on the critical path.

### 6.5 Commercial "tech debt audit" products

Several vendors (Clientell, Gearset, Sweep and others) sell org-grading audits that include an "LWC Components" domain. **All are black-box, org-connected, and none publishes the per-component extraction schema you need.** They cannot give you `lwcs_with_composed_events[]`. Dismissed.

---

## 7. R7 — Apex parsing and dependency graphing

### 7.1 The parser landscape, resolved

There are exactly **three** viable Apex front-ends in 2026:

| Front-end | Nature | Status |
|---|---|---|
| **Jorje** | Salesforce's own, **closed-source binary blob** shipped inside the VS Code extension | Alive but unusable as a dependency |
| **apex-parser + Summit-AST** | Open ANTLR4 grammar (originally Kevin Jones / `nawforce`) + Google's Summit-AST translating the ANTLR tree into a Jorje-shaped AST | **The open standard.** PMD 7 switched to it |
| **apex-ls / ApexLink** | Scala semantic analyser built on the same grammar, with real type resolution | Alive, JVM/ScalaJS |

**[verified from search results / PMD docs]** Since **PMD 7.0.0 (22 Mar 2024)**, PMD uses `apex-parser` + Summit-AST instead of Jorje, precisely because Jorje was a closed binary. Summit-AST was written to produce an AST structurally very close to Jorje's so existing PMD rules did not need rewriting. Code Analyzer v5 currently ships **PMD 7.25.0**.

**Consequence for you:** the grammar you would use directly (`@apexdevtools/apex-parser`) is the *same grammar underpinning PMD's Apex support*. You are not on a side path; you are on the mainstream open one.

`@vlocode/apex@2.4.1` (published 2026-08-05, MIT, from the Codeneos/vlocode project) is a second live fork of the same grammar, updated for `antlr4ng`. **[inference]** Keep it as a fallback if `@apexdevtools/apex-parser` ever stalls; do not run both.

### 7.2 Verified API — `@apexdevtools/apex-parser@5.1.0`

**[verified by execution]** 203 exports. Depends on `antlr4@4.13.2`. Ships ESM + CJS + browser bundles with TypeScript declarations.

Entry points:
- `ApexParserFactory.createParser(source)` → parser
- `ApexParserFactory.createLexerAndParser(source, listener)` → both, with error listeners wired
- `parser.compilationUnit()` — classes/interfaces/enums
- `parser.triggerUnit()` — **triggers** (note: SFGE cannot scan triggers; this parser can)
- `parser.anonymousUnit()` — anonymous Apex
- `parser.query()` — standalone SOQL
- `ApexParseTreeWalker.DEFAULT.walk(listener, tree)`
- `ApexParserBaseListener` / `ApexParserBaseVisitor`
- `ApexErrorListener`, `ThrowingErrorListener`, `ApexSyntaxError`, `CaseInsensitiveInputStream`

**Two gotchas that cost me time — write them down:**

1. **Repeated children use a `_list()` suffix.** This is the antlr4 4.13 JS-target convention and it is *not* what the older `antlr4ts` docs show. `ctx.modifier()` returns a *single* child (or throws); `ctx.modifier_list()` returns the array. Same for `formalParameter_list()`, `fieldName_list()`.
2. **DML statement contexts are not prefixed with `Dml`.** They are `InsertStatementContext`, `UpdateStatementContext`, `DeleteStatementContext`, `UpsertStatementContext`, `MergeStatementContext`, `UndeleteStatementContext` — so the listener hooks are `enterInsertStatement`, not `enterDmlInsertStatement`. Guessing the latter silently yields zero DML, which looks like a clean codebase rather than a bug.

**Verified tree shape** for `public with sharing class AccountController { @AuraEnabled(cacheable=true) public static List<Account> getAccounts() { ... } }`:

```
CompilationUnitContext
  TypeDeclarationContext
    ModifierContext        :: public
    ModifierContext        :: withsharing        <-- sharing lives HERE, on the parent
    ClassDeclarationContext
      IdContext            :: AccountController
      ClassBodyContext
        ClassBodyDeclarationContext
          ModifierContext
            AnnotationContext
              QualifiedNameContext     :: AuraEnabled
              ElementValuePairsContext :: cacheable=true
          ModifierContext  :: public
          ModifierContext  :: static
          MemberDeclarationContext
            MethodDeclarationContext
              TypeRefContext        :: List<Account>
              IdContext             :: getAccounts
              FormalParametersContext
              BlockContext
```

**Critical detail:** `with sharing` / `without sharing` / `inherited sharing` are `ModifierContext` children of **`TypeDeclarationContext`, the parent of `ClassDeclarationContext`** — not of the class declaration itself. `getText()` returns them whitespace-stripped as `withsharing` / `withoutsharing` / `inheritedsharing`. Match on those exact lowercase tokens.

### 7.3 What the spike extracted — all four R7 targets, confirmed

Run against a deliberately hard synthetic class:

```apex
public inherited sharing class OpportunityService extends BaseService implements Schedulable {
    @AuraEnabled(cacheable=false)
    public static Opportunity upsertOpp(Id oppId, Map<String,Object> payload, List<String> tags) {
        Opportunity o = [SELECT Id, Name, Amount FROM Opportunity WHERE Id = :oppId WITH SECURITY_ENFORCED LIMIT 1];
        List<Contact> cs = [SELECT Id FROM Contact WHERE AccountId = :o.AccountId WITH USER_MODE];
        AccountController.getAccounts();
        Helper h = new Helper();
        update o;
        return o;
    }
    @AuraEnabled public static void doThing() { System.debug(LoggingLevel.ERROR, 'x'); }
    public void execute(SchedulableContext sc) { }
}
```

Output (abridged, **verbatim from the spike**):

```json
{
  "types": [{ "kind":"class", "name":"OpportunityService",
              "extends":"BaseService", "implements":"Schedulable",
              "modifiers":["public","inheritedsharing"], "sharing":"inheritedsharing" }],
  "methods": [
    { "name":"upsertOpp", "returns":"Opportunity",
      "params":[{"type":"Id","name":"oppId"},
                {"type":"Map<String,Object>","name":"payload"},
                {"type":"List<String>","name":"tags"}],
      "annotations":["@AuraEnabled(cacheable=false)"],
      "modifiers":["public","static"], "auraEnabled":true, "cacheable":false },
    { "name":"doThing", "returns":"void", "params":[],
      "annotations":["@AuraEnabled"], "auraEnabled":true, "cacheable":false },
    { "name":"execute", "returns":"void",
      "params":[{"type":"SchedulableContext","name":"sc"}], "auraEnabled":false }
  ],
  "soql": [
    { "sObjects":["Opportunity"], "selectList":"Id,Name,Amount",
      "accessMode":"WITH SECURITY_ENFORCED", "hasWhere":true },
    { "sObjects":["Contact"], "selectList":"Id",
      "accessMode":"USER_MODE", "hasWhere":true }
  ],
  "typeRefs": ["BaseService","Schedulable","String","Opportunity","Id",
               "Map<String,Object>","Object","List<String>","List<Contact>",
               "Contact","Helper","SchedulableContext"],
  "staticRefs": ["AccountController","System","LoggingLevel"],
  "news": ["Helper"],
  "syntaxErrors": []
}
```

Against the repo's real `AccountController.cls` it correctly reported `sharing: "withsharing"`, `cacheable: true`, `sObjects: ["Account"]`, `accessMode: "USER_MODE"` — the last of which is the exact signal CLAUDE.md hard rule 4 is about.

All four R7 targets are therefore satisfied:
- ✅ **class-to-class references** — union of `typeRefs`, `staticRefs`, `news`, `extends`, `implements`
- ✅ **SOQL queries and their sObjects** — `QueryContext.fromNameList().fieldName_list()`
- ✅ **`@AuraEnabled` method signatures** — full name/return/typed-params/`cacheable`
- ✅ **sharing declarations** — including the "omitted" case, which is semantically distinct (inherits caller's context) and must not be conflated with `inherited sharing`

### 7.4 Building the graph — the honest design

**Edges** = for each class, the union of `typeRefs ∪ staticRefs ∪ news ∪ {extends} ∪ {implements}`, filtered to names that exist in your own class inventory (this drops `System`, `Map`, `String`, `LoggingLevel`, and all sObject names in one step, without a stdlib denylist).

**This is a name-based over-approximation.** It cannot distinguish an overloaded call target, and it will draw an edge for a class merely *named* in a comment-free type position it never actually calls. That is the correct trade: **for topological migration ordering you want to over-connect, not under-connect** — a spurious edge costs you ordering conservatism; a missing edge costs you a broken migration. **[inference]**

**Topological ordering:**
1. Build directed graph `A → B` = "A references B".
2. Find SCCs (Tarjan) — Apex codebases **will** have mutual references; you must condense cycles into supernodes or the topo sort fails. Treat each SCC as one atomic migration unit.
3. Topologically sort the condensation. **Leaves = classes referencing nothing else of yours = migrate first.**
4. Seed the roots from `@AuraEnabled` methods reachable from LWC `@salesforce/apex/Class.method` imports — that join is what produces `apex_classes_reachable[] { class, depth, callers[] }`. `depth` = BFS distance from the LWC-facing entry point.

**Note:** `@salesforce/apex/Namespace.Class.method` is a valid form. Split from the right, not the left.

### 7.5 If you later need real semantics

`@apexdevtools/apex-ls` (npm `6.0.2`, 2025-11-27; also on Maven Central) does actual type resolution — it powers the `apex-assist` VS Code extension via a built-in JSON-RPC server, and exposes `dependency-report`, `dependency-counts` and `dependency-bombs` commands.

**[inference]** This is the escape hatch if name-based edges prove too noisy. Cost: a JVM (or a large ScalaJS bundle) in your toolchain, and a stale-ish npm release. **Do not start here.** Start with the ANTLR approach; escalate only if measured noise justifies it.

---

## 8. R6 — the concrete LWC extraction approach

### 8.1 The `parse()` stability question — answered, with a caveat

**[verified]** `@lwc/template-compiler` exports `parse` at the package root, and it is **in the type declarations**:

```
node_modules/@lwc/template-compiler/dist/index.d.ts:16:
export declare function parse(source: string, config?: Config): TemplateParseResult;
```

**[verified]** However, the package **README documents only `compile`**. `parse` is exported and typed, but not documented.

**Verdict: semi-public. Usable, but pin exactly. [inference]**
- Pin `@lwc/template-compiler` to an exact version (no `^`, no `~`). It publishes very frequently — 880 versions, latest 9.4.0 on 2026-08-10.
- Write a **shape-assertion test** that parses a fixture template and asserts the presence of the node types you depend on (`Root`, `Component`, `Element`, `ForEach`, `IfBlock`, `ElseifBlock`, `ElseBlock`, `Slot`, `EventListener`, `Directive`, `Property`, `Attribute`, `Text`, `Identifier`, `MemberExpression`, `Literal`). Run it in CI. When you bump the compiler, that test — not production — tells you the IR moved.
- This is the same pin-and-assert discipline R4 will need for the codemod, so build the harness once and share it.

**Note:** this repo currently resolves `@lwc/template-compiler@8.28.2` transitively via `@salesforce/sfdx-lwc-jest@7.9.0`. The spike ran on 8.28.2. If you install 9.x directly you will have two copies in the tree — resolve that deliberately (an `overrides` entry) rather than accidentally. **[verified — version read from local `node_modules`]**

### 8.2 Verified template-side extraction

```js
import { parse as parseTemplate } from '@lwc/template-compiler';

const { root, warnings } = parseTemplate(html, {});
// walk `root` recursively, skipping the `location` and `parent` keys
```

Node types observed in the fixtures **[verified]**:
`Root, Component, Element, ExternalComponent, Property, Attribute, Literal, Identifier, MemberExpression, Text, EventListener, Directive, ForEach, IfBlock, ElseifBlock, ElseBlock, Slot`

Mapping to census fields:

| Census field | Extraction |
|---|---|
| `lightning-*` tags | node `type === 'Component'`, `name.startsWith('lightning-')` |
| `c-*` children (dependency graph) | node `type === 'Component'`, `name.startsWith('c-')`. **Kebab → camel** to get the bundle name: `c-broker-card` → `brokerCard`. `@lwc/template-compiler` exports `kebabcaseToCamelcase` for exactly this — use it, don't reimplement |
| Directives | `node.directives[].name` (e.g. `Key`) **plus** the block node types themselves (`ForEach`, `IfBlock`, `ElseifBlock`, `ElseBlock`) — modern `lwc:if/elseif/else` are *node types*, legacy `if:true` is a directive. Collect both |
| Event bindings | `node.listeners[].name` |
| Slots | `type === 'Slot'`; the slot **name** is in `attributes[]` where `name === 'name'`, **not** on `node.name` (which is the tag, `slot`). This bit me in the spike |

Verified output on the fixtures:

```
accountList      lightning-card, lightning-formatted-text, lightning-button
                 directives: IfBlock, ForEach, Key, ElseifBlock, ElseBlock   listeners: click
brokerCard       lightning-button   slots: ["footer"]                        listeners: click
propertySummary  lightning-card, lightning-formatted-number
                 c-broker-card                                               listeners: contact
```

### 8.3 Verified JS-side extraction

```js
import { parse as parseJs } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default ?? _traverse;   // ESM/CJS interop — required

const ast = parseJs(src, {
  sourceType: 'module',
  plugins: [['decorators', { decoratorsBeforeExport: true }],
            'classProperties', 'classPrivateProperties'],
});
```

**Three bugs the spike surfaced. Do not repeat them:**

1. **Visit `'ClassProperty|ClassMethod'` in a single combined visitor.** I initially ran two `traverse()` passes and every `@api`, `@wire` and event was recorded **twice**. Duplicates in a census are worse than omissions — they silently inflate your Tier counts.
2. **`@babel/traverse` validates visitor keys at runtime.** A typo'd node type throws `You gave us a visitor for the node type X but it's not a valid type`. Good — it fails loudly. Let it.
3. **Do not infer LMS from a `__c` suffix.** My first pass flagged `@salesforce/schema/Property__c.Price__c` as a message channel. The only correct signal is the prefix `@salesforce/messageChannel/`.

**Wire adapter module resolution — the part that is easy to get wrong.** `@wire(getRecord, {...})` gives you the *local identifier*, not the module. Build an `importMap: localName → source` on `ImportDeclaration`, then resolve after the walk:

```js
out.wires.forEach(w => { w.module = importMap.get(w.adapter) ?? '(unresolved)'; });
```

Verified result on `propertySummary`:

```json
[{ "adapter":"getRecord", "target":"property", "module":"lightning/uiRecordApi",
   "config":[{"key":"recordId","reactive":true,"value":"$recordId"},
             {"key":"fields","reactive":false,"value":"FIELDS"}] },
 { "adapter":"getBroker",  "target":"broker",   "module":"@salesforce/apex/PropertyController.getBroker",
   "config":[{"key":"propertyId","reactive":true,"value":"$recordId"}] }]
```

Note the `reactive` flag (leading `$` in the config value). That distinction — reactive vs static wire config — is precisely what R8/R9 need to model in the TanStack Query shim, so capture it now rather than re-parsing later.

**Full JS field mapping:**

| Census field | Extraction |
|---|---|
| `@salesforce/*` imports | `ImportDeclaration` where source starts `@salesforce/`. **`source.split('/')[1]` is the kind**: `apex`, `schema`, `label`, `user`, `resourceUrl`, `messageChannel`, `contentAssetUrl`, `i18n`, `client`, `apexContinuation`, `userPermission`, `customPermission`, `community` |
| Apex methods called | `@salesforce/apex/<Class>.<method>` — **this is the join key to the Apex graph** |
| `@wire` adapters + modules | `@wire(...)` CallExpression decorator + `importMap` (above) |
| `@api` / `@track` | Identifier decorators on class members |
| Lifecycle hooks | `ClassMethod` named `constructor`, `connectedCallback`, `renderedCallback`, `disconnectedCallback`, `errorCallback`, `render` |
| DOM access | `MemberExpression` with property in `querySelector`, `querySelectorAll`, `getElementById`, `children`, `childNodes`. Also flag `this.template` vs bare `document` (the latter is `no-document-query` territory) |
| composed+bubbling CustomEvents | `NewExpression` callee `CustomEvent`; read `arguments[1]` `ObjectExpression` for `composed`/`bubbles` **literal `true`**. Verified: `brokerCard` → `{"name":"contact","composed":true,"bubbles":true}` |
| LMS | import of `lightning/messageService` (for `publish`/`subscribe`/`MessageContext`/`APPLICATION_SCOPE`) **and/or** `@salesforce/messageChannel/X__c`. **Record the channel name** — the channel is the join key for the subscriber map |
| empApi | import of `lightning/empApi` |
| Navigation / other platform modules | `lightning/navigation`, `lightning/uiRecordApi`, `lightning/uiObjectInfoApi`, `lightning/refresh`, `lightning/platformShowToastEvent` |

**Event-name caveat:** `new CustomEvent(this.someVar)` yields `(dynamic)`. Count these; a non-trivial dynamic-event population is itself a Tier-H signal. **[inference]**

### 8.4 `.js-meta.xml`

**[verified from LWC Developer Guide]** Parse `LightningComponentBundle` with `fast-xml-parser`. Fields you want: `apiVersion` (mandatory since Spring '25), `isExposed`, `masterLabel`, `description`, `targets/target[]`, `targetConfigs/targetConfig[]`, `capabilities/capability[]`, and the `ai` block on Agentforce-enabled orgs.

Valid `target` values include: `lightning__AppPage`, `lightning__RecordPage`, `lightning__HomePage`, `lightning__FlowScreen`, `lightning__GlobalAction`, `lightning__RecordAction`, `lightning__UtilityBar`, `lightning__Tab`, `lightning__UrlAddressable`, `lightningCommunity__Page`, `lightningCommunity__Page_Layout`, `lightningCommunity__Theme_Layout`, `analytics__Dashboard`, `lightningSnapin__*`, `lightningStatic__Email`, `lightning__AgentforceInput` / `lightning__AgentforceOutput`, `lightning__PropertyEditor`, plus Field Service / Enablement / Voice targets.

**Migration-relevant reading of this file [inference]:**
- **`isExposed: false` and no `.js-meta.xml` at all** ⇒ a **pure child component**. `brokerCard` in this repo has no meta file. These are your migration leaves and your easiest wins — order them first.
- **`lightning__RecordPage`** ⇒ the component receives `recordId`/`objectApiName` from the page context. Your React host must supply these explicitly; they are not props in the source.
- **`lightning__FlowScreen`** ⇒ two-way Flow bindings. **Tier H** — the contract is with the Flow runtime, not the DOM.
- **`lightningCommunity__*`** ⇒ Experience Cloud / LWR. Different runtime, different assumptions.
- **`targetConfigs`** ⇒ design-time properties that admins set. These are *props with no call site in your code*. A census that ignores `targetConfigs` will under-count the public API surface of every app-builder-exposed component.

**Third census consumer note:** per the post-spike addendum in doc 03, `catalog/base-components.xml` needs readable **prop names** per base component. The `lightning-*` frequency table from §8.2 is exactly the prioritised worklist for that catalog — build the histogram first, write catalog entries in descending frequency order, stop when coverage crosses your threshold.

---

## 9. What static analysis will not tell you — budget for it

Put every one of these in an `unresolved[]` bucket with the file and line, and route it to manual review. **Do not let a clean-looking census hide them. [inference]**

| Blind spot | Impact |
|---|---|
| `lwc:component` / `lwc:is` dynamic components | the child edge is unknowable statically. Count occurrences; each is manual |
| Legacy `lwc:dynamic` + `import()` | same |
| `new CustomEvent(computedName)` | event name unknown |
| `composed`/`bubbles` from a variable, not a literal | your boolean check misses it. Flag "non-literal event options" separately |
| Apex called via `Type.forName`, `Callable`, or dynamic dispatch | missing graph edges |
| Dynamic SOQL (`Database.query(str)`) | sObject unknown — and it is also the highest-risk security construct in the codebase |
| Managed-package components (`ns-*` tags) | not in your source tree at all; will appear as unresolved children |
| Aura components consuming LWCs | invisible from the LWC side. If Aura still exists in the org, it is an inbound-edge blind spot for the entire migration |
| Flow-invoked Apex (`@InvocableMethod`) | a root you would otherwise miss — collect it alongside `@AuraEnabled` |
| CSS-only coupling (`::part`, `--custom-props`, SLDS overrides) | invisible to both parsers |

---

## 10. Recommended build plan

**Day 1 — LWC extractor.** `@lwc/template-compiler.parse` + `@babel/parser`/`@babel/traverse` + `fast-xml-parser`. Emit one JSON record per bundle. The spike in §8 already covers ~70% of this; it is ~200 lines finished. Add the shape-assertion test (§8.1) the same day.

**Day 2 — Apex extractor.** `@apexdevtools/apex-parser`. Emit one JSON record per class/trigger. The spike in §7.3 covers most of it; add `enterInsertStatement`-family DML hooks, `@InvocableMethod`, interfaces, enums, and inner classes.

**Day 3 — Graph assembly + tiering.** Join LWC→Apex on `@salesforce/apex/*`; build the Apex reference graph; Tarjan SCC; topological order; compute `depth`; emit `census.json` in the doc-03 schema. Apply the Tier M/A/H rules and compute `tier_distribution`. **This is the day the two kill-criteria gates get their numbers.**

**Days 4–5 — Harden against the real org.** Every parse failure is a finding, not a bug to swallow: log it, count it, and report `parse_success_rate` as a first-class census field. A census that silently skips 8% of components will mis-price the project. Cross-check a sample against `MetadataComponentDependency` and against the `lwc-dependency-viewer` regexes; where they disagree, one of you is wrong and you need to know which.

**In parallel (cheap, do not block on it):** run `sf code-analyzer run` with `--rule-selector eslint:LWC` and the SSR ruleset over the whole tree; attach per-component violation counts to the census as an independent risk signal (§3.1, §4).

---

## 11. Answers to the specific R6/R7 questions

| Question | Answer | Confidence |
|---|---|---|
| `lightning-*` tags used | Template AST, `Component` nodes | **verified** |
| `c-*` children / dependency graph | Template AST + `kebabcaseToCamelcase` | **verified** |
| `@wire` adapters and their modules | Babel decorator + import map join | **verified** |
| `@salesforce/*` imports (apex/schema/label/user/resourceUrl) | `ImportDeclaration`, kind = path segment 1 | **verified** |
| Lifecycle hooks | `ClassMethod` name match | **verified** |
| `querySelectorAll` / DOM access | `MemberExpression` property match | verified pattern, not exercised by fixtures |
| composed+bubbling CustomEvents | `NewExpression` + literal option read | **verified** |
| Lightning Message Service | `lightning/messageService` + `@salesforce/messageChannel/*` | verified pattern; docs-confirmed |
| `empApi` | `lightning/empApi` import | docs-confirmed, pattern trivial |
| `.js-meta.xml` targets + `isExposed` | `fast-xml-parser` | **verified** (fixture read) |
| Apex class-to-class references | typeRefs ∪ staticRefs ∪ news ∪ extends ∪ implements | **verified** |
| SOQL + sObjects touched | `QueryContext.fromNameList()` | **verified**, incl. access mode |
| `@AuraEnabled` signatures | ClassBodyDeclaration modifiers + MethodDeclaration | **verified**, incl. `cacheable` |
| sharing declarations | `ModifierContext` on **TypeDeclarationContext** | **verified**, all four states |
| Leaf-to-root topological ordering | SCC-condensed topo sort over the reference graph | design verified; not yet implemented |

---

## Sources

**Fetched and read (WebFetch):**
- https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/code-analyzer.html
- https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/engine-eslint.html
- https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/release-notes.html
- https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/release-notes.md
- https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/engine-sfge-work-with.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html
- https://github.com/salesforce/eslint-plugin-lwc/blob/master/README.md
- https://github.com/salesforce/eslint-plugin-lwc-graph-analyzer
- https://github.com/lukethacoder/lwc-dependency-viewer
- https://raw.githubusercontent.com/lukethacoder/lwc-dependency-viewer/main/scripts/walk-files.ts
- https://github.com/apex-dev-tools/apex-parser
- https://github.com/apex-dev-tools/apex-ls
- https://github.com/salesforce/lwc/blob/master/packages/%40lwc/template-compiler/README.md

**Fetch attempted, blocked (HTTP 403 — npmjs.com rejects automated fetch):**
- https://www.npmjs.com/package/@salesforce/eslint-plugin-lwc
- https://www.npmjs.com/package/@apexdevtools/apex-parser

**Queried directly via the npm registry (`npm view`, 11 Aug 2026) — the source for every version and publish date in §2:**
- https://registry.npmjs.org/ — packages: `@lwc/template-compiler`, `@lwc/compiler`, `@lwc/engine-dom`, `@lwc/eslint-plugin-lwc`, `@lwc/eslint-plugin-lwc-platform`, `@salesforce/eslint-config-lwc`, `@salesforce/eslint-plugin-lwc` (404), `@salesforce/eslint-plugin-lightning`, `@salesforce/eslint-plugin-aura`, `@salesforce/eslint-plugin-lwc-graph-analyzer`, `@komaci/static-analyzer`, `@salesforce/plugin-code-analyzer`, `@salesforce/cli`, `@salesforce/sfdx-lwc-jest`, `@salesforce/apex-node`, `@salesforce/source-deploy-retrieve`, `@apexdevtools/apex-parser`, `@apexdevtools/apex-ls`, `apex-parser`, `apexlink`, `@vlocode/apex`, `lwc-services`, `sfdx-hardis`, `eslint`, `acorn`, `@babel/parser`, `fast-xml-parser`, `lwc-dependency-viewer` (404)

**Surfaced in search results and cited as such, but not individually fetched:**
- https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_metadatacomponentdependency.htm (MetadataComponentDependency Beta, 2 000-record cap, supported types)
- https://docs.pmd-code.org/latest/pmd_languages_apex.html and https://github.com/pmd/pmd/issues/3766 (PMD 7 replacing Jorje with apex-parser + Summit-AST)
- https://developer.salesforce.com/docs/platform/lwc/guide/use-message-channel-subscribe.html (LMS import conventions)
- https://github.com/forcedotcom/dependencies-cli
- https://github.com/hardisgroupcom/sfdx-hardis
- https://marketplace.visualstudio.com/items?itemName=FernandoFernandez.dependencygraphforsf

**Executed locally (the empirical basis for every [verified] claim):**
- LWC spike — `@lwc/template-compiler@8.28.2` `parse()` + `@babel/parser@7.29.8` / `@babel/traverse@7.29.8`, run against `force-app/main/default/lwc/{accountList,brokerCard,propertySummary}`. Working script preserved at `<scratchpad>/census-spike-final.mjs`.
- Apex spike — `@apexdevtools/apex-parser@5.1.0` (installed clean in scratchpad), run against `force-app/main/default/classes/AccountController.cls` and a synthetic hard case. Script at `<scratchpad>/apexspike/spike.js`.
- Benchmarks — 300 LWC bundles / 500 Apex classes, timings in §0.
