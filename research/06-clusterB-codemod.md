# Cluster B — Codemod Foundations

**R4:** `@lwc/template-compiler` template AST
**R5:** Transform rules mined from `blittle/lwc2react`

Research date: **11 Aug 2026**
Author: research agent (Cluster B)

> **Verification legend**
> - **[verified-local]** — I ran this against `@lwc/template-compiler@8.28.2` installed in this repo (`node_modules/@lwc/template-compiler`) and observed the output. Highest confidence.
> - **[verified-web]** — read from an upstream source I fetched (GitHub raw source, npm registry, issue/PR API). URL in Sources.
> - **[inference]** — my reasoning, not directly sourced. Treat as a hypothesis to test.
> - **[UNVERIFIED]** — I could not confirm this. Do not build on it without checking.

---

# R4 — The LWC template AST

## R4.0 TL;DR for implementers

| Question | Answer |
|---|---|
| Package | `@lwc/template-compiler` (MIT, part of `salesforce/lwc` monorepo) |
| Entry point for a codemod | named export **`parse(source, config?)`** → `{ root?, warnings }` |
| Is the AST a public API? | **No — officially internal/undocumented.** But it *has* been deliberately stabilized (see R4.7). |
| Does `parse()` throw? | **No, for template errors.** It returns `root: undefined` + populated `warnings`. **[verified-local]** |
| Circular refs / parent pointers? | **None.** Fully `JSON.stringify`-able. **[verified-local]** |
| Biggest traversal gotcha | `lwc:elseif` / `lwc:else` are **NOT siblings in `children`** — they hang off `.else` on the preceding node. **[verified-local]** |
| Version installed here | **8.28.2** |
| Version to pin | Pin exact, `8.x` line. See R4.8. |

---

## R4.1 The parse API

From `dist/index.d.ts` of the installed package **[verified-local]**:

```ts
export declare function parse(source: string, config?: Config): TemplateParseResult;
export default function compile(source: string, filename: string, config: Config): TemplateCompileResult;

interface TemplateParseResult {
  root?: Root;                     // undefined when a fatal error occurred
  warnings: CompilerDiagnostic[];
}
```

Runtime exports of the package (enumerated with `Object.keys(await import(...))`) **[verified-local]**:

```
ElementDirectiveName, LWCDirectiveDomMode, LWCDirectiveRenderMode, LwcTagName,
RootDirectiveName, TemplateDirectiveName, bindExpression, compile, default,
generateScopeTokens, kebabcaseToCamelcase, parse, toPropertyName
```

### Two important consequences of that export list

1. **`parse` is a real, callable named export** — you do not need to reach into `dist/` internals. Good.
2. **The `isElement` / `isIfBlock` / `isForEach` … type guards are NOT exported.** They exist in
   `dist/shared/ast.d.ts` (75 declared helpers) but `index.d.ts` only does `export * from './shared/types'`,
   which re-exports *types and enums*, not the `ast.ts` runtime helpers. **[verified-local]**
   → **Your codemod must write its own type guards.** Switch on the `type` string; it is a plain string
   discriminant on every node.

`config` is optional in practice: `parse('<template><div>{x}</div></template>')` with **no second argument**
returns a valid root. **[verified-local]** Pass `{ name, namespace }` anyway so diagnostics are legible.

### Config flags that gate AST features

From `dist/config.d.ts` (installed) and `src/config.ts` on `master` — **identical** **[verified-local]** + **[verified-web]**:

| Flag | Default | Effect on the AST you must care about |
|---|---|---|
| `experimentalDynamicDirective` | `false` | Gates `lwc:dynamic` → `DynamicDirective`. Marked deprecated in-source: `TODO [#3331]: remove usage of lwc:dynamic in 246` |
| `enableDynamicComponents` | `false` | Gates `lwc:is` on `<lwc:component>` → `IsDirective` + `Lwc` node |
| `enableLwcOn` | `false` | Gates `lwc:on` → `OnDirective` |
| `experimentalComplexExpressions` | `false` | Changes `value`/`handler` from `Identifier`\|`MemberExpression` to **raw acorn ESTree nodes** |
| `experimentalComputedMemberExpression` | `false` | Allows `{list[0].name}` → `MemberExpression` with `computed: true` |
| `preserveHtmlComments` | `false` | Whether `Comment` nodes appear at all |
| `enableStaticContentOptimization` | `true` | Codegen-only; does not change `parse()` output **[inference]** |
| `enableLwcSpread` | `true` | **Deprecated / ignored** — `lwc:spread` is always on |
| `apiVersion` | – | Does *not* gate complex expressions (tested 62 and 65, no difference) **[verified-local]** |

**Recommended codemod config — turn everything on so nothing silently degrades:**

```js
parse(src, {
  name: 'foo', namespace: 'c',
  experimentalDynamicDirective: true,  // still see legacy lwc:dynamic
  enableDynamicComponents: true,       // lwc:is
  enableLwcOn: true,                   // lwc:on
  experimentalComputedMemberExpression: true,
  preserveHtmlComments: true,          // else comments vanish from output
});
```

Note: enabling `experimentalDynamicDirective` and then using `lwc:dynamic` produces a **non-fatal warning**
`LWC1187: The lwc:dynamic directive is deprecated ... Please use lwc:is instead.` — root is still returned. **[verified-local]**

---

## R4.2 Node type catalogue

Every node has `type: string` and `location: SourceLocation`. Exhaustive union from `dist/shared/types.d.ts` **[verified-local]**, cross-checked against `master` **[verified-web]** — **identical**.

### Container / structural

| `type` | Fields beyond `type`/`location`/`children` | Produced by |
|---|---|---|
| `Root` | `directives: RootDirective[]`, `location: ElementSourceLocation` | the `<template>` root |
| `Element` | `name`, `namespace`, `attributes[]`, `properties[]`, `listeners[]`, `directives[]` | plain HTML tag (`div`, `input`) |
| `Component` | same as `Element` | custom element w/ a dash, e.g. `c-child`, `x-legacy` |
| `ExternalComponent` | same as `Element` | element carrying `lwc:external` |
| `Slot` | same as `Element` **plus `slotName: string`** (`""` = default slot) | `<slot>` |
| `Lwc` | same as `Element`, `name: 'lwc:component'` | `<lwc:component>` |

`StaticElement` is a *narrowing* of `Element` (children restricted to `StaticElement \| Text \| Comment`).
It is a **type-level** distinction used by the static-content optimizer; **`parse()` never emits the string
`"StaticElement"` as a `type` value.** You will only ever see `"Element"`. **[verified-local]**

### Leaf

| `type` | Fields |
|---|---|
| `Text` | `value: Literal \| Expression \| ComplexExpression`, `raw: string` |
| `Comment` | `value: string`, `raw: string` |

### Directive-parent nodes (each also has `directiveLocation: SourceLocation`)

| `type` | Source directive | Fields |
|---|---|---|
| `If` | `if:true` / `if:false` | `modifier: 'true'\|'false'`, `condition: Expression` |
| `IfBlock` | `lwc:if` | `condition: Expression`, `else?: ElseifBlock \| ElseBlock` |
| `ElseifBlock` | `lwc:elseif` | `condition: Expression`, `else?: ElseifBlock \| ElseBlock` |
| `ElseBlock` | `lwc:else` | *(none)* |
| `ForEach` | `for:each` | `expression: Expression`, `item: Identifier`, `index?: Identifier` |
| `ForOf` | `iterator:*` | `expression: Expression`, `iterator: Identifier` |
| `ScopedSlotFragment` | `lwc:slot-data` | `slotData: SlotDataDirective`, `slotName: Literal \| Expression` |

⚠️ **Name trap:** the `type` string is **`ForOf`**, but the source directive is **`iterator:name`**, and the enum
member is `TemplateDirectiveName.ForOf = "for:of"`. There is no `for:of` directive in LWC templates —
the enum value is a misnomer. Match on the **`type` string `'ForOf'`**. **[verified-local]**

### Expression nodes

```ts
type Expression = Identifier | MemberExpression;
interface Identifier       { type: 'Identifier';       name: string }
interface MemberExpression { type: 'MemberExpression'; object: Expression; property: Identifier }
interface Literal<V = string|boolean> { type: 'Literal'; value: V }   // NOTE: no `location`
```

**Runtime shape exceeds the `.d.ts`.** Actual `MemberExpression` objects also carry acorn's
`start`, `end`, `computed: boolean`, `optional: boolean`. Observed for `{a.b.c.d}` **[verified-local]**:

```json
{"type":"MemberExpression","start":1,"end":8,
 "object":{"type":"MemberExpression", "...":"...", "computed":false,"optional":false},
 "property":{"type":"Identifier","start":7,"end":8,"name":"d"},
 "computed":false,"optional":false}
```

→ Handle `computed: true` in your `exprToSource` even though the `.d.ts` doesn't mention it.
`Literal` has **no `location`**, unlike every other node — don't assume `node.location` exists on it.

### Enums (values are the literal directive strings)

```ts
TemplateDirectiveName { If:"if:true", IfBlock:"lwc:if", ElseifBlock:"lwc:elseif",
                        ElseBlock:"lwc:else", ForEach:"for:each", ForOf:"for:of",
                        ScopedSlotFragment:"lwc:slot-data" }
ElementDirectiveName  { Dom:"lwc:dom", Dynamic:"lwc:dynamic", Is:"lwc:is", External:"lwc:external",
                        InnerHTML:"lwc:inner-html", Ref:"lwc:ref", SlotBind:"lwc:slot-bind",
                        SlotData:"lwc:slot-data", Spread:"lwc:spread", On:"lwc:on", Key:"key" }
RootDirectiveName     { PreserveComments:"lwc:preserve-comments", RenderMode:"lwc:render-mode" }
LwcTagName            { Component:"lwc:component" }
```

⚠️ Note the `Directive.name` field holds the **enum KEY**, not the value. A `key={x}` directive
serializes as `{ type:'Directive', name:'Key', value:{type:'MemberExpression',...} }` — `name` is `'Key'`,
not `'key'`. Same for `Ref`, `Dom`, `InnerHTML`, `Spread`, `On`, `Is`, `Dynamic`, `SlotBind`, `SlotData`,
`RenderMode`, `PreserveComments`. **[verified-local]**

---

## R4.3 How each directive actually lands in the AST

All rows **[verified-local]** by parsing and dumping.

| LWC source | AST result |
|---|---|
| `<template for:each={items} for:item="it" for:index="i">` | `ForEach { expression: Identifier(items), item: Identifier(it), index: Identifier(i) }` |
| `for:each` **without** `for:item` | root still returned + warning `LWC1044: for:each and for:item directives should be associated together` |
| `<template iterator:iter={items}>` | `ForOf { expression: Identifier(items), iterator: Identifier(iter) }`. `iter.value/.index/.first/.last` appear in children as ordinary `MemberExpression`s off `iter` — the compiler does **not** special-case them |
| `<template if:true={isOpen}>` | `If { modifier: "true", condition: Identifier(isOpen) }` |
| `<template if:false={isOpen}>` | `If { modifier: "false", condition: Identifier(isOpen) }` — **same node type**, only `modifier` differs. Must negate on emit |
| `lwc:if` / `lwc:elseif` / `lwc:else` | `IfBlock` → `.else` → `ElseifBlock` → `.else` → `ElseBlock`. **`root.children.length === 1`** for a 3-branch chain |
| `lwc:elseif` not preceded by `lwc:if` | warning `LWC1165: 'lwc:elseif' directive must be used immediately after...`; root still returned |
| `key={it.id}` | an **`ElementDirective`** on the element: `{name:'Key', value: MemberExpression}` — **not** an attribute/property |
| missing `key` inside an iterator | warning `LWC1071: Missing key for element <li> inside of iterator...`; root still returned |
| `<x-legacy lwc:dynamic={ctor}>` | node `Component`, directive `{name:'Dynamic', value: Identifier}` + deprecation warning LWC1187 |
| `<lwc:component lwc:is={ctor} foo={bar}>` | node **`Lwc`** (`name:'lwc:component'`), directive `{name:'Is'}`, `foo` → `properties[]` |
| `<slot>` | `Slot { slotName: "" }` |
| `<slot name="header">` | `Slot { slotName: "header" }` **and** `attributes: [{name:'name', value: Literal("header")}]` — the name is present **twice**; prefer `slotName` |
| `<slot>` with children | children are the **fallback content** |
| `<p slot="body">` inside `<c-x>` | plain `Element` with an ordinary `attributes` entry `slot="body"`. No dedicated node — you must group children by this attribute yourself |
| `<template lwc:slot-data="kv" slot="row">` | `ScopedSlotFragment { slotData.value.name = "kv", slotName: Literal("row") }` |
| `onclick={handleClick}` | `listeners: [{type:'EventListener', name:'click', handler: Identifier}]` — **the `on` prefix is stripped**, case preserved as authored (all-lowercase per LWC rules) |
| `onmycustomevent={h}` on `<c-x>` | `listeners: [{name:'mycustomevent'}]` — LWC gives you **no casing information**; `mycustomevent` cannot be mechanically recovered as `myCustomEvent` |
| `ontest-event={h}` | **rejected** — 0 listeners + 1 warning. Hyphens are not allowed in `on*` handler names |
| `lwc:ref="box"` | directive `{name:'Ref', value: Literal("box")}` |
| `lwc:inner-html={html}` | directive `{name:'InnerHTML', value: Expression \| Literal<string>}` |
| `lwc:dom="manual"` | directive `{name:'Dom', value: Literal("manual")}` |
| `lwc:spread={props}` | directive `{name:'Spread', value: Expression}` |
| `lwc:on={handlers}` | directive `{name:'On', value: Expression}` (needs `enableLwcOn`) |
| `lwc:external` on `<c-x>` | changes the **node type** to `ExternalComponent`; does *not* appear in `directives[]` |
| `<template lwc:render-mode="light" lwc:preserve-comments>` | `root.directives: [{name:'RenderMode', value: Literal("light")}, {name:'PreserveComments', value: Literal(true)}]` |
| directives on a **non-`<template>`** element (`<div lwc:if={x}>`) | still produce a wrapper `IfBlock`/`ForEach` node whose single child is the `div`. Identical shape to the `<template>` form — **no flag distinguishes them** |

### Text nodes are split, one per interpolation

`<div>Hi {name}!</div>` produces **three** `Text` children **[verified-local]**:

| `value.type` | `value` | `raw` |
|---|---|---|
| `Literal` | `"Hi "` | `"Hi "` |
| `Identifier` | `name` | `"{name}"` |
| `Literal` | `"!"` | `"!"` |

`raw` preserves the original braces — useful for source-mapping. Whitespace-only text between elements is
dropped by the parser's normalization. **[inference — I did not isolate a whitespace-only case]**

---

## R4.4 Attribute vs. property — the rule you must replicate

This is the single most error-prone area. **All rows [verified-local].**

### On a `Component` / `ExternalComponent` / `Lwc` node

Everything that is *not* a directive, an event, or a "global" HTML attribute becomes a **`Property`**,
with `name` camelCased and `attributeName` holding the original kebab-case:

```
<c-child my-prop={x} aria-hidden={h} class="k" style="color:red" data-foo="1">
  properties: [ {name:"myProp",     attributeName:"my-prop"},
                {name:"ariaHidden", attributeName:"aria-hidden"} ]
  attributes: [ class="k", style="color:red", data-foo="1" ]
```

→ `class`, `style`, `data-*` stay **attributes even on custom elements**. `aria-*` becomes a **property**
on a custom element but stays an **attribute** on a plain element. This asymmetry is real and tested.

### On a plain `Element` node

| Source | `properties` | `attributes` | `listeners` |
|---|---|---|---|
| `<div class={c}>` / `class="s"` | — | `class` | — |
| `<div style={s}>` | — | `style` | — |
| `<label for={f}>` | — | `for` | — (**no `htmlFor` mapping**) |
| `<a href={h}>` | — | `href` | — |
| `<img src={s} alt={a}>` | — | `src`, `alt` | — |
| `<input value={v} checked={c} disabled={d} readonly={r} maxlength={m}>` | **`value`, `checked`** | `disabled`, `readonly`, `maxlength` | — |
| `<textarea value={v}>` | — | **`value`** | — |
| `<select value={v}>` | — | **`value`** | — |
| `<option selected={s}>` | — | `selected` | — |
| `<div id/title/hidden/tabindex/role/data-x/aria-label={…}>` | — | all 7 | — |
| `<button type="submit" onclick={go}>` | — | `type` | `click` |

**Practical takeaways for the codemod:**
- Only `input.value` and `input.checked` are promoted to properties among common form fields.
  `textarea`/`select` `value` is an **attribute** — if you naively map `attributes`→JSX attributes you'll
  still get `value=` which React accepts, so this happens to be benign. **[inference]**
- `for` is never renamed; you must emit `htmlFor` yourself.
- `class`→`className` is entirely your job.
- Boolean/empty attribute values: `flag` (bare) → `Literal(true)`; `disabled=""` → `Literal("")`;
  `n="3"` → `Literal("3")` (string, not number). **[verified-local]**

---

## R4.5 Diagnostics

`warnings` is `CompilerDiagnostic[]`. Observed runtime shape **[verified-local]**:

```json
{ "code": 1071,
  "message": "LWC1071: Missing key for element <li> inside of iterator. ...",
  "level": 1,
  "location": { "line": 1, "column": 48, "start": 47, "length": 12 },
  "url": "" }
```

Note the diagnostic `location` uses `{line, column, start, length}` — a **different shape** from the AST node
`SourceLocation` `{startLine, startColumn, endLine, endColumn, start, end}`. Don't mix them up.

**`parse()` did not throw on any input I tried** — including `""`, `"<template>"` (unclosed),
`"not html at all"`, and `<div>` as root. All returned `root: undefined` plus a warning. **[verified-local]**

| Input | `root` | First diagnostic |
|---|---|---|
| `""` | `undefined` | `LWC1072: Missing root template tag` |
| `"<template>"` | `undefined` | `LWC1078: <template> has no matching closing tag.` |
| `"not html at all"` | `undefined` | `LWC1072: Missing root template tag` |
| `<div>not a template root</div>` | `undefined` | `LWC1079: Expected root tag to be template, found div` |
| `<div>{</div>` | **present** | *(none — unterminated brace is silently literal text)* |

→ **Codemod contract: always check `if (!root)` and treat it as a hard failure; never assume a throw.**
Also surface `level`-1 warnings (LWC1044 / LWC1071 / LWC1165) as migration blockers even though parsing "succeeded".

---

## R4.6 Complex expressions (`experimentalComplexExpressions`)

Two things to know **[verified-local]**:

1. **HTML quoting is mandatory.** `title={a ? b : c}` (unquoted) fails at the *HTML* level —
   `LWC1057 / LWC1125: "? is not valid attribute for div"`. `onclick={()=>go(1)}` produces
   `LWC1058: unexpected-character-in-unquoted-attribute-value` and **`root: undefined`**.
   You must write `title="{a ? b : c}"` and `onclick="{() => go(1)}"`.
2. With the flag **off** and quoted braces, you get `LWC1034: Ambiguous attribute value ...` (warning).
   With the flag **on**, it parses cleanly and the value nodes become **raw acorn ESTree nodes**:

| Source | resulting `value`/`handler` `.type` |
|---|---|
| `title="{a ? b : c}"` | `ConditionalExpression` |
| `onclick="{() => go(1)}"` | `ArrowFunctionExpression` |
| `{n + 1}` in text | `BinaryExpression` |

`ComplexExpression` is typed as `AcornNode & { value?: any }`. → **Your expression printer needs a fallback
branch that hands anything other than `Identifier`/`MemberExpression`/`Literal` to a generic ESTree
code-generator** (the package depends on `astring`, which is exactly that, but does not re-export it).

**[inference]** For a Salesforce-org migration you can most likely leave this flag **off** and treat any
`LWC1034` as "needs human review", since complex expressions are still opt-in on-platform.

---

## R4.7 Is the AST a public API?

**Officially: no. Practically: it has been stabilized and has not moved in ~4.5 years.**

Evidence:

- The package `README.md` on `master` **documents only `compile()`. `parse()` is not documented at all.** **[verified-web]**
- Issue **#2432 "Make `@lwc/template-compiler` produce a stable AST"** (opened 23 Jul 2021, now **closed**)
  states plainly that the internal AST "was never meant to be exposed", that it leaked parse5 nodes,
  and that `parse()` existed only to collect template metadata. **[verified-web]**
- It was closed by **PR #2518 "refactor(template-compiler): refactor ast shape"**, merged **17 Dec 2021**,
  commit `fdeea05b70ac8ec7caa28add7930396ffd9b5382`, explicitly flagged as a breaking change to AST consumers.
  19 files, +1764/−1118. **[verified-web]** The exact npm version it shipped in is **[UNVERIFIED]** — no
  milestone was set on the PR — but it is in the LWC 2.x line **[inference]**.
- **Every goal listed in #2432 is satisfied in 8.28.2** **[verified-local]**:
  - no parse5 nodes on AST nodes — `Element` keys are exactly
    `type,name,namespace,location,attributes,properties,directives,listeners,children`
  - no `parent` back-pointer (`'parent' in node === false`)
  - no `original` / `attrsList`
  - `JSON.stringify(root)` succeeds (no circular refs)
  - `location` with line/column/char offsets on every node
- I diffed the installed `8.28.2` `shared/types.d.ts` against `src/shared/types.ts` on `master`
  (which is the **9.4.0** line): **same node types, same union members, same enum members, same fields.** **[verified-web]**
- LWC **v9.0.0** (3 Feb 2025) breaking changes do **not** touch `parse()` or the AST. The v9 breaks are:
  ESM main export, `experimentalDynamicComponent`→`dynamicImports`, babel-plugin dedupe removal,
  `wire` type params 4→3, `node:` import protocol. **[verified-web]**

**Verdict:** treat it as a *de facto* stable-but-unsupported API. Salesforce owes you no semver guarantee on it,
but the shape has survived 2.x → 9.x untouched. The risk is real but low, and it is **far** lower than the risk
of hand-rolling an HTML parser that reimplements LWC's attribute/property and directive rules.

**Mitigation [inference]:** write a thin adapter module over `parse()` that normalizes to *your own* IR, plus a
schema-assertion test that fails loudly if an unexpected `type` string or a missing field shows up. Then an
upstream change breaks one file, not your whole codegen.

---

## R4.8 Version pinning advice

Facts **[verified-web]** (npm registry, fetched 11 Aug 2026):

- `latest` = **9.4.0**
- Salesforce-release dist-tags: `winter26` = 8.20.6 · `spring26` = 8.25.1 · `summer26` = 9.1.5
- Older: `summer25` = 8.16.5 · `spring25` = 8.10.3 · `winter25` = 7.1.5 · `summer24` = 6.4.5
- This repo currently resolves **8.28.2** (transitively via `@salesforce/sfdx-lwc-jest@^7.9.0`) **[verified-local]**

**Recommendation:**

1. **Pin exactly** — `"@lwc/template-compiler": "8.28.2"`, no `^`, no `~`. You are consuming an undocumented API;
   let a human approve every bump.
2. **Add it as a direct devDependency.** Right now it is only a transitive dep of `sfdx-lwc-jest`; an unrelated
   bump to the Jest preset could silently swap your parser out from under you.
3. **Prefer the 8.x line over 9.x for now.** v9 made the `main` export **ESM-only**. Any part of your codemod
   toolchain that is CJS (many jscodeshift/Babel setups are) will need `await import()` or a full ESM migration.
   8.28.2 ships both `dist/index.cjs.js` (`main`) and `dist/index.js` (`module`), so it works either way. **[verified-local]**
4. **Match the dist-tag to the target org's API version** when the org matters. If you're migrating a
   Winter '26 org, `@lwc/template-compiler@npm:8.20.6` parses exactly the directive set that org supports —
   this prevents your codemod from accepting syntax the source org would have rejected. **[inference]**
5. Because the AST is identical across 8.x and 9.x, a future bump is low-risk; the ESM change is the real cost.

---

## R4.9 Walking the AST — working, verified code

Two traps this handles that a naive walker gets wrong:

1. **`.else` chains** — `lwc:elseif`/`lwc:else` are not in `children`.
2. **`computed` member expressions** — present at runtime, absent from the `.d.ts`.

```js
// walk-demo.mjs — verified against @lwc/template-compiler 8.28.2
import { parse } from '@lwc/template-compiler';

/** Depth-first over every node. Follows BOTH `children` and the `else` chain. */
function* walk(node, parent = null, depth = 0) {
  yield { node, parent, depth };
  for (const child of node.children ?? []) yield* walk(child, node, depth + 1);
  // CRITICAL: elseif/else are NOT siblings in `children` — they hang off `.else`
  if (node.else) yield* walk(node.else, node, depth + 1);
}

/** Expression -> source text. Handles the acorn-only `computed` flag. */
function exprToSource(e) {
  switch (e.type) {
    case 'Identifier': return e.name;
    case 'MemberExpression':
      return e.computed
        ? `${exprToSource(e.object)}[${exprToSource(e.property)}]`
        : `${exprToSource(e.object)}.${e.property.name}`;
    case 'Literal': return JSON.stringify(e.value);
    default: return `/* complex:${e.type} */`;   // ConditionalExpression, ArrowFunctionExpression, ...
  }
}

const isExpr = v => v && (v.type === 'Identifier' || v.type === 'MemberExpression');

function describe(node) {
  const d = [];
  switch (node.type) {
    case 'Root':
      if (node.directives.length)
        d.push(node.directives.map(x => `${x.name}=${JSON.stringify(x.value.value)}`).join(' '));
      break;
    case 'Element': case 'Component': case 'ExternalComponent': case 'Lwc': case 'Slot': {
      d.push(`<${node.name}>`);
      if (node.type === 'Slot') d.push(`slotName=${JSON.stringify(node.slotName)}`);
      for (const a of node.attributes)
        d.push(`attr ${a.name}=${isExpr(a.value) ? '{' + exprToSource(a.value) + '}' : JSON.stringify(a.value.value)}`);
      for (const p of node.properties)
        d.push(`prop ${p.name}(<-${p.attributeName})=${isExpr(p.value) ? '{' + exprToSource(p.value) + '}' : JSON.stringify(p.value.value)}`);
      for (const l of node.listeners) d.push(`on${l.name}={${exprToSource(l.handler)}}`);
      for (const dir of node.directives)
        d.push(`${dir.name}=${isExpr(dir.value) ? '{' + exprToSource(dir.value) + '}' : JSON.stringify(dir.value.value)}`);
      break;
    }
    case 'Text':    d.push(isExpr(node.value) ? `{${exprToSource(node.value)}}` : JSON.stringify(node.value.value)); break;
    case 'Comment': d.push(JSON.stringify(node.value)); break;
    case 'If':      d.push(`if:${node.modifier}={${exprToSource(node.condition)}}`); break;
    case 'IfBlock': case 'ElseifBlock':
      d.push(`cond={${exprToSource(node.condition)}}`, node.else ? `else->${node.else.type}` : 'no-else'); break;
    case 'ForEach':
      d.push(`each={${exprToSource(node.expression)}}`, `item=${node.item.name}`,
             node.index ? `index=${node.index.name}` : ''); break;
    case 'ForOf':
      d.push(`of={${exprToSource(node.expression)}}`, `iterator=${node.iterator.name}`); break;
    case 'ScopedSlotFragment':
      d.push(`slotData=${node.slotData.value.name}`,
             `slotName=${node.slotName.type === 'Literal' ? JSON.stringify(node.slotName.value) : exprToSource(node.slotName)}`); break;
  }
  return d.filter(Boolean).join('  ');
}

const source = `<template>
  <div class="card" title={heading} onclick={handleClick} lwc:ref="card">Hi {name}!</div>
  <template for:each={rows} for:item="row" for:index="i">
    <c-row key={row.id} data={row} onselect={handleSelect}></c-row>
  </template>
  <template lwc:if={loading}><p>Loading</p></template>
  <template lwc:elseif={error}><p>Error</p></template>
  <template lwc:else><slot name="body"></slot></template>
</template>`;

const { root, warnings } = parse(source, { name: 'demo', namespace: 'c' });
if (!root) { console.error('Fatal parse errors:', warnings); process.exit(1); }
for (const w of warnings) console.warn(`warn LWC${w.code} @${w.location?.line}:${w.location?.column} ${w.message}`);

for (const { node, depth } of walk(root)) {
  console.log('  '.repeat(depth) + node.type.padEnd(20) + describe(node));
}
```

### Actual output — copied from a real run **[verified-local]**

```
Root
  Element             <div>  attr class="card"  attr title={heading}  onclick={handleClick}  Ref="card"
    Text                "Hi "
    Text                {name}
    Text                "!"
  ForEach             each={rows}  item=row  index=i
    Component           <c-row>  prop data(<-data)={row}  onselect={handleSelect}  Key={row.id}
  IfBlock             cond={loading}  else->ElseifBlock
    Element             <p>
      Text                "Loading"
    ElseifBlock         cond={error}  else->ElseBlock
      Element             <p>
        Text                "Error"
      ElseBlock
        Slot                <slot>  slotName="body"  attr name="body"
```

Read that output carefully — it encodes most of R4:

- `title={heading}` on a `div` is an **attr**; `data={row}` on `c-row` is a **prop**.
- `key` shows up as the directive **`Key`**, not as an attribute.
- `onclick` → listener named `click`.
- The `ElseifBlock`/`ElseBlock` appear **indented under** `IfBlock` because they are reached via `.else`.
  Semantically they are siblings. **If you emit JSX by indentation/depth you will produce wrong output** —
  flatten the chain into a ternary or an early-return before emitting.

### Suggested JSX emission for the `.else` chain **[inference]**

```
IfBlock(c1)[A] -> ElseifBlock(c2)[B] -> ElseBlock[C]
  ⇒  {c1 ? (<A/>) : c2 ? (<B/>) : (<C/>)}
```
and for a bare `IfBlock` with no `.else`: `{c1 && (<A/>)}`.
For `If` with `modifier==='false'`, negate: `{!cond && (…)}`.

---

## R4.10 Gaps / things I could not verify

- Which exact npm version PR #2518 shipped in. **[UNVERIFIED]**
- Whitespace-only text node handling (I did not construct an isolating test). **[UNVERIFIED]**
- Whether `enableStaticContentOptimization` can alter `parse()` output (I believe it is codegen-only). **[inference]**
- Behaviour of `customRendererConfig` on the AST — not tested at all. **[UNVERIFIED]**
- I did not test `lwc:slot-bind`, SVG/MathML namespace handling, or `<template>` inside `<table>` edge cases.

---
---

# R5 — Transform rules in `blittle/lwc2react`

## R5.0 Repo status — read this before trusting anything below

The repo **exists** and is **not archived**. But it is a **self-declared proof of concept**, and it is old.

| Fact | Value | Confidence |
|---|---|---|
| URL | `https://github.com/blittle/lwc2react` | **[verified-web]** |
| Default branch | **`master`** — there is **no `main` branch** (the `main` trees API 404s) | **[verified-web]** |
| Stars / forks | **6** / 1 | **[verified-web]** |
| Created | 2020-05-01 | **[verified-web]** |
| Last real code commit | **2020-12-28** (`fix: everything`, `d76d357`). The `pushed_at` of 2023-01-06 is dependabot branches only | **[verified-web]** |
| Open issues | 28 — **all 28 are dependabot `build(deps): bump …`**. Zero human issues | **[verified-web]** |
| Layout | lerna monorepo — `packages/core` (the plugin, 7 source files) + `packages/sample-app` (demo storefront) | **[verified-web]** |
| Targets | `react ^16.13.1`, `lwc ^1.4.0-alpha3`, `recast 0.19.1`, `observable-membrane 1.0.1` | **[verified-web]** |
| npm | `lwc2react`, latest **0.6.5**, published **2022-05-08** — **npm is AHEAD of git master (0.3.0)**, built from source never committed to any branch | **[verified-web]** |
| README self-assessment | "This is a proof of concept and _NOT_ ready for use in production!" | **[verified-web]** |

**Age warning:** master predates LWC v2. `lwc:if` / `lwc:elseif` / `lwc:else` **did not exist yet**. Everything
below is calibrated to the LWC v1 directive set. Treat this repo as a source of *ideas and traps*, not a baseline.

> The file tree reported by the mining agent was independently re-fetched by me from
> `api.github.com/repos/blittle/lwc2react/git/trees/master?recursive=1` and matches exactly
> (189 files; `packages/core/src/` = `LightningComponent.js`, `class-compiler.js`, `compiler.js`,
> `dataMaps.js`, `helpers.js`, `index.js`, `template-compiler.js`).

---

## R5.1 The one architectural fact that governs every rule

**lwc2react never parses LWC templates or HTML. It does not use `@lwc/template-compiler`'s AST at all.**

It is a **second-pass rollup plugin** that runs **after `@lwc/rollup-plugin`** and rewrites the LWC compiler's
already-generated **JavaScript output** using `recast`. Every rule is therefore keyed on LWC's internal
render-helper calls — `api_element`, `api_iterator`, `api_slot`, `api_dynamic`, `api_custom_element`,
`api_key`, `api_text`, `api_scoped_id` — and on `_registerComponent` / `_registerDecorators`.
It never sees the strings `for:each`, `if:true`, or `@api`.

**This is the opposite of the approach in R4** and is the single biggest strategic takeaway:

- **Their approach:** LWC HTML → (LWC compiler) → JS → (recast rewrite) → React JS.
  Buys you free directive parsing; costs you all source fidelity, all attribute/property distinction,
  and couples you to LWC's *unversioned codegen internals* — a far less stable surface than the AST.
- **Our approach (R4):** LWC HTML → `parse()` → AST → JSX.
  We keep `slotName`, `attributeName`, `Property` vs `Attribute`, and source locations, all of which
  lwc2react has permanently destroyed by the time it runs.

Consequence for them: a directive is "supported" only if the `api_*` call it lowers to is in the switch in
`recurseElementTree`. Everything else hits `throw new Error('cannot process: ' + callee)`.

**Dispatch** — `packages/core/src/index.js` (`rollupLWC2ReactCompiler()`, rollup `transform` hook)
→ `packages/core/src/compiler.js` (`compile(id, source)`):

| Input | Action |
|---|---|
| id contains `@lwc/engine/dist/engine.js` **or `wire-service`** | replaced with `export default undefined` |
| folder name ≠ filename (regex `/.+\/(.+)\/(.+).js/`) | **source returned untouched** — only `foo/foo.js` entry modules compile |
| `*.html` | `compileTemplate` (`src/template-compiler.js`) |
| `*.css` | **returned verbatim** |
| else | `compileClass` (`src/class-compiler.js`) |

---

## R5.2 Rule table — templates (`packages/core/src/template-compiler.js`)

`compileTemplate(ast)` finds the function whose first param is `$api`, rewrites the signature to `tmpl($cmp)`,
replaces the body with `React.createElement` trees, changes `export default registerTemplate(tmpl)` →
`export default tmpl`, and appends `tmpl.customEvents = [...]`.

All rows **[verified-web]** by the mining agent reading source + committed Jest snapshots, unless marked.

| # | LWC construct | Lowered to | React output | Implementing fn (all in `src/template-compiler.js` unless noted) |
|---|---|---|---|---|
| T1 | Element | `api_element` | `React.createElement("div", props, children)` | `recurseElementTree` |
| T2 | Static text | `api_text` | bare string literal child | `recurseElementTree` |
| T3 | `{expr}` interpolation | `api_dynamic` | raw expression as child (`$cmp.params.productId`) | `recurseElementTree` |
| T4 | Child LWC component `<my-comp>` | `api_custom_element` | `React.createElement(_myComp, props, childrenObject)` — imported module identifier used directly as the React type | `recurseElementTree` |
| T5 | **`for:each`** | `api_iterator` | `$cmp.list.map(item => React.createElement(...))` | `buildChildren` (npm 0.6.5 also handles it in `recurseElementTree`) |
| T6 | **`key={…}`** | `key: api_key(0, item.id)` | `key: item.id` — unwraps `api_key`, keeps the **2nd** arg. Static numeric keys pass through as `key: 0` | `buildKey` |
| T7 | **`if:true` / `if:false`** | a `ConditionalExpression` (`$cmp.x ? el : null` / `!$cmp.x ? el : null`) | the same ternary, both branches recursed. **`if:false` works only because LWC already emitted the `!`** | `recurseElementTree`, `n.ConditionalExpression.check` branch |
| T8 | **Default/anonymous slot** `<slot>` | `api_slot("")` | `$cmp.props.children && $cmp.props.children[""] ? $cmp.props.children[""] : <fallback or null>` | `getChildrenFromSlot` |
| T9 | **Named slot** `<slot name="b">` | `api_slot("b")` | same ternary keyed on `$cmp.props.children["b"]` | `getChildrenFromSlot` |
| T10 | **Slot *content* passed to a child** | children of `api_custom_element` | **children become an OBJECT, not an array**: `{ "": <h1/>, "b": <h2 slot="b"/> }`, keyed by the `slot` attribute (`""` = default) | `recurseElementTree` when `options.slots === true`; key from `getSlotName` (reads `attrs.slot`) |
| T11 | `class="a b"` | `classMap: {a:true,b:true}` | `className: "a b"` — **keys joined by space, boolean values ignored** | `getClassNameString` |
| T12 | `class={expr}` | `className: expr` | `className: expr` verbatim | `buildProps` |
| T13 | `style="…"` | `styleMap: {...}` | `style: {...}` passed straight through | `buildProps` |
| T14 | Attributes (`attrs`) | `attrs: {title:"wow"}` | key mapped through `attributeMap` for React casing (`tabindex`→`tabIndex`, `readonly`→`readOnly`, `autofocus`→`autoFocus`, …) | `processProp` + `attributeMap` in **`src/dataMaps.js`** |
| T15 | Properties (`props`) | `props: {value: $cmp.query}` | **treated identically to attributes** — same `processProp`, same map. **The attribute/property distinction is discarded** | `buildProps` |
| T16 | Scoped id `id={…}` | `api_scoped_id("1")` | unwrapped to the raw 1st arg (`"1"`) — **id scoping discarded** | `processProp` |
| T17 | Scoped-CSS marker | — | **every** element gets `[tmpl.stylesheetTokens.shadowAttribute.toLowerCase()]: "true"` injected as its first prop | `buildProps` |
| T18 | Root element | — | gets `ref: $cmp.template` | `buildProps` (`topOfTree`) |

### T19 — Event bindings: the headline finding

**`onclick={handler}` is NOT converted to React's `onClick`.**

The native-event code path **exists but is commented out** — in `buildProps`, the block beginning
`//if (eventMap['on' + prop.key.value]) { // native event`. `eventMap` (all ~80 React synthetic event names)
is exported from `src/dataMaps.js` and **imported nowhere** — dead code. `svgMap` (~240 SVG attribute
mappings) is likewise dead, so SVG attribute casing is never corrected.

What actually happens for **every** `on{event}={handler}`, native or custom:

1. The element gets a generated ref prop `ref: $cmp.__ref1` (module counter `refCounter`; the root reuses `template`).
2. A triple `[eventName, handlerName, refName]` is pushed onto a module-level `customEvents` array.
3. `tmpl.customEvents = [["click","increment","__ref1"], …]` is emitted at the bottom of the compiled template.
4. At runtime the base class (`src/LightningComponent.js`) calls **`addEventListener`** on that ref's DOM node.

So all event handling is **real DOM listeners on refs**, not React synthetic props. Confirmed in
`packages/core/tests/__snapshots__/events.test.js.snap`. If the bound expression's object isn't `$cmp`,
it throws `Unable to handle bound event: <name>`.

**Verdict for us: do not copy this.** It exists because they operate on post-compile JS where the
`on`-prefix/casing information is already gone. From the R4 AST we get `listeners[].name` directly and can
emit a proper `onClick` prop. Their design is a workaround for a constraint we don't have.

---

## R5.3 Rule table — component class (`packages/core/src/class-compiler.js`)

`compileClass(ast)` → `convertClass()`, which orchestrates `convertMethods`, `buildRenderMethod`,
`buildStyles`, `convertConstructorBlock`, `convertLifeCycleMethods`.

| # | LWC construct | React output | Implementing fn | Notes |
|---|---|---|---|---|
| C1 | `extends LightningElement` | `extends LightningComponent`; injects imports of `lwc2react/lib/LightningComponent` and `observable-membrane` | `convertClass` / `compileClass` | |
| C2 | `extends SomethingElse` (e.g. `lightning/primitiveButton`) | superclass left **unchanged**; the `LightningComponent` import is still injected but unused | `getClassAST` fallback | latent bug |
| C3 | `export default _registerComponent(X, {tmpl:_tmpl})` | `export default X` | `compileClass` | |
| C4 | **Reactive data — any field, `@track` or not** | `this.foo` → **`this.__s.foo`** everywhere: assignments, reads, update exprs, for-loop heads, for-of, if tests, ternaries, computed keys, call args. `this.__s` is an **observable-membrane proxy** whose `valueMutated` calls `forceUpdate()` | `processExpression` / `processElement` | **Not `useState`** — class components + forceUpdate |
| C5 | **`@api` props** | **No dedicated transform.** `getPublicProps()` reads `publicProps` off `_registerDecorators` and threads it into `options.publicProps` — **but nothing ever reads it** (zero reads found). `@api` works only *incidentally*: React props are copied into `__s` by the base class's `updateMembrane()`. Defaults survive as `this.__s.publicProp = "default"` | `getPublicProps` (**result unused**) | dead code |
| C6 | **`@track`** | **Not detected at all.** The whole `_registerDecorators(...)` statement — carrying `publicProps`, `fields`, `track` **and `wire`** — is **deleted** | `removeLWCCode` in **`src/helpers.js`** | see R5.5 |
| C7 | `constructor` | `super(...args)` → `super(_tmpl)`; body processed. If absent, `constructor(){ super(_tmpl) }` is **synthesized** | `convertConstructorBlock` | |
| C8 | **`connectedCallback`** | body **appended into** generated `componentDidMount()` (after `super.componentDidMount(_tmpl)`); original method deleted | `convertLifeCycleMethods` | |
| C9 | **`disconnectedCallback`** | body appended into generated `componentWillUnmount()`; original deleted | `convertLifeCycleMethods` | |
| C10 | **`renderedCallback`** | **renamed** to `componentDidUpdate` | `convertLifeCycleMethods` | fires on mount in LWC but not in React — **semantic mismatch, unaddressed** **[inference]** |
| C11 | **`errorCallback(error, stack)`** | **renamed** to `componentDidCatch`; signature untouched — LWC's `(error, stack)` vs React's `(error, errorInfo)` mismatch **not addressed** | `convertLifeCycleMethods` | |
| C12 | Internal calls to the above | `this.renderedCallback()` → `this.componentDidUpdate()` via `lifeCycleMap` | `processCallExpression` | |
| C13 | **`render()`** (LWC template switching) | **Not handled.** A new `render()` is unconditionally appended → **two `render` methods**, appended one silently wins | `buildRenderMethod` | **real defect, reproduced in committed `class.test.js.snap`** |
| C14 | Generated `render()` | `const prox = Object.assign({}, this, this.__s); prox.__proto__ = this.__proto__; return _tmpl(prox);` — flattens state+instance and re-attaches the prototype so **getters** resolve. Source comment: *"maybe extending `this` like this is not okay?"* | `buildRenderMethod` | |
| C15 | **Getters / setters** | bodies processed like methods (`this.x`→`this.__s.x`); `kind` preserved. Reach the template via C14's `__proto__` trick | `convertMethods` → `convertMethod` | |
| C16 | **`this.template.*`** | → `this.template.current.*` (React ref). `this.template.host.x` special-cased: `host` dropped → `this.template.current.x` | `processExpression`, `processCallExpression` | |
| C17 | **`this.dispatchEvent(new CustomEvent(...))`** | → `this.template.current.dispatchEvent(new CustomEvent(...))` — a **real DOM CustomEvent on the root node**, *not* a React callback prop. Parents subscribe via `addEventListener` (T19) | `processCallExpression` | |
| C18 | `this.add/removeEventListener` | → `this.template.current.…` | `processCallExpression` | |
| C19 | Styles wiring | appends `componentDidMount(){ super.componentDidMount(_tmpl) }` and `componentWillUnmount(){ super.componentWillUnmount(_tmpl) }` | `buildStyles` | |
| C20 | **Import rewriting** | the **first** `import … from 'lwc'` → `import React from "react"`; all remaining `'lwc'` imports **deleted**; `_registerDecorators(...)` deleted. **Nothing else is rewritten** — `lightning/*` imports survive verbatim | `removeLWCCode` in **`src/helpers.js`** | |

On C20: the sample app's `packages/sample-app/rollup.config.js` instead feeds `lwc-components-lightning`
and `ui-lightning-community` through the **same** lwc2react `include` globs — i.e. **base components are
recursively converted, not mapped to React equivalents.** There is no `lightning/*` → React component map anywhere.

---

## R5.4 Scoped CSS

| Phase | Behaviour | Location |
|---|---|---|
| Compile | `.css` files returned **byte-identical** — asserted with `toBe(code)` in `packages/core/tests/css.test.js`. LWC's `stylesheet(hostSelector, shadowSelector, nativeShadow)` function form is preserved | `src/compiler.js` |
| Compile | every element gets the `shadowAttribute` prop injected (T17) | `src/template-compiler.js` |
| Runtime | `addLocalStyles()` calls each stylesheet fn with `'[' + hostAttribute.toLowerCase() + ']'` and `'[' + shadowAttribute.toLowerCase() + ']'`, `nativeShadow = null`; creates a `<style>` element and **appends it to `document.head`**. `cleanupLocalStyles()` removes on unmount | `src/LightningComponent.js` |

**Caveats:** synthetic shadow only — **no Shadow DOM**, styles are global and rely entirely on attribute
selectors. Nothing dedupes: N mounted instances inject N `<style>` tags.

---

## R5.5 `@wire` — exactly where and why it stops short

This is a **hard stop with no partial support, no TODO, and no error path**. Three independent places kill it:

1. **`packages/core/src/compiler.js`, first lines of `compile()`** — any module id containing **`wire-service`**
   (and `@lwc/engine/dist/engine.js`) is replaced with the literal `export default undefined`.
   **The wire runtime is stubbed out of the bundle entirely.**
2. **`packages/core/src/helpers.js`, `removeLWCCode()`** — the entire `_registerDecorators(...)` statement is
   spliced away. LWC compiles `@wire(adapter, config)` into the **`wire` key of that very object**.
   **The wire metadata is destroyed.**
3. **`packages/core/src/class-compiler.js`, `getPublicProps()`** — reads **only** the `publicProps` key.
   There is **no code path anywhere in the repo that reads `wire`, `track`, or `fields`.** A grep for `wire`
   across all 7 source files returns exactly one hit: the `wire-service` stub in `compiler.js`.

**Net effect: `@wire` fails silently.** Decorated properties become plain `this.__s.x = undefined` and never
populate. No thrown error, no warning, no code comment. The only acknowledgement anywhere is the README's
"What is not working: 1. Wire adapters".

**Why it stops there — [inference]:** wire is not a syntax problem, it is a *runtime data-layer* problem.
Every other rule in this repo is a local AST rewrite; wire would require reimplementing the LWC wire service,
the adapter protocol, reactive config recomputation, and then Apex/LDS/UI-API transports behind it. That is a
different project, so the author stubbed the module and shipped the POC. **This is precisely the boundary our
project has to cross that lwc2react did not** — and it is the strongest signal in this repo about where the
real work is.

**Corollary [inference]:** because wire is the vehicle for Apex/LDS, and because no import rewriting exists
for `@salesforce/apex/*`, `@salesforce/schema/*`, `@salesforce/label/*`, `@salesforce/resourceUrl/*`,
`@salesforce/user/*`, those imports pass through untouched and fail at bundle time unless the host happens to
provide modules by those names.

---

## R5.6 Explicit list — constructs lwc2react does NOT attempt

### Template directives
- **`lwc:if` / `lwc:elseif` / `lwc:else`** — post-date the code (LWC v2, 2022 vs. master Dec 2020). Not referenced anywhere.
- **`iterator:name`** — **[inference]** LWC lowers it to `api_iterator` too, so it won't throw, but the transform emits a plain `.map(param => …)` supplying the raw array item. The iterator wrapper (`.value`, `.index`, `.first`, `.last`) will be `undefined` at runtime. **Silently wrong, not caught.**
- **`lwc:dynamic`** — **not in git master.** Present only in the npm 0.6.5 build (see R5.7).
- `lwc:dom="manual"`, `lwc:ref`, `lwc:spread`, `lwc:external`, `lwc:component` / `lwc:is`, `lwc:on`, `lwc:inner-html`, `lwc:slot-data`, `lwc:render-mode`, `lwc:preserve-comments` — **no handling at all**.
- `<template>` fragments as loop roots, HTML comments, SVG namespacing (`svgMap` is dead code).

### JS / decorators
- **`@wire`** (R5.5).
- **`@track`** — erased with the rest of `_registerDecorators`.
- **`@api` on methods** — public methods callable by a parent; nothing exposes them.
- `@api` setters as a public API surface.
- `static delegatesFocus`, `static renderMode`, `static stylesheets`.
- **LWC `render()` template switching** — actively broken (C13), not merely unimplemented.
- `LightningElement` surface beyond `template` / `dispatchEvent` / `add|removeEventListener`: **`this.refs`**, `this.hostElement`, `this.shadowRoot`; `dispatchEvent` `composed`/`bubbles` retargeting (options pass through, but there is no shadow boundary).
- Module-scope side effects other than the `lwc` import and `_registerDecorators`.

### Salesforce platform modules — **zero references in the codebase**
`@salesforce/label`, `@salesforce/schema`, `@salesforce/apex`, `@salesforce/resourceUrl`, `@salesforce/i18n`,
`@salesforce/user`, `lightning/navigation`, `lightning/messageService`, `lightning/uiRecordApi`.

### Tooling
- Source maps: master returns `map: null`. (npm 0.6.5 fabricates one that hardcodes `id.indexOf('sample-app')` — demo-grade.)

---

## R5.7 Deltas in npm `lwc2react@0.6.5` vs git master

The published package is built from source **never committed to any branch** (`fixes` and `fix-build` are both
older, v0.2.0). Read from the extracted tarball's `lib/` **[verified-web]**:

- **`api_dynamic_component`** (i.e. **`lwc:dynamic`**) handled — same path as `api_element` with the component-style props offset.
- **`api_flatten`** handled → `Array.prototype.flat.call([...])`, in both `recurseElementTree` and `buildChildren`. This is what LWC emits when mixing iterators with static siblings — **its absence in master is a likely source of `cannot process: api_flatten` throws**.
- `api_iterator` also handled at `recurseElementTree` level, not just as a direct child.
- `LightningComponent.js` **monkey-patches `window.customElements.define`** so defining a custom element instead mounts `ReactDOM.render(React.createElement(Component), this)` into it — enabling the **reverse** interop direction.
- `index.js` emits sourcemaps via the `source-map` package.
- `class-compiler.js`, `helpers.js`, `compiler.js`, `dataMaps.js` are **functionally identical** to master — including the `wire-service` stub and the commented-out native-event branch. **Wire support is absent in 0.6.5 too.**

---

## R5.8 Latent bugs worth stealing as test cases

Found by reading source; several are frozen into committed snapshots. **[verified-web]**

| # | Bug | Location |
|---|---|---|
| B1 | `cleanupEventHandlers` reads `event[3]` where `addEventHandlers` writes/reads `event[2]`. `event[3]` is always `undefined` → `this[undefined].current` **throws on unmount** | `src/LightningComponent.js` |
| B2 | **Duplicate `ref` prop** when the root element also has an event binding — `buildProps` pushes `ref` twice (`topOfTree` branch **and** `hasEvents` branch). Visible verbatim in `events.test.js.snap` | `src/template-compiler.js` |
| B3 | **`for:each` over a nested path breaks.** `buildChildren` builds the iteratee as `child.arguments[0].object.name + '.' + child.arguments[0].property.name` — works only for exactly `$cmp.list`; `$cmp.a.b` yields `undefined.b` | `src/template-compiler.js` |
| B4 | **Handler references in a constructor get state-mangled**: `this.template.addEventListener('x', this.performSearch)` → `…addEventListener("something", this.__s.performSearch)`. Committed in `events.test.js.snap` | `src/class-compiler.js` |
| B5 | `convertMethods` builds new `methodDefinition` nodes and discards the returned array; only works because `convertMethod` mutates bodies in place | `src/class-compiler.js` |
| B6 | The codebase's only TODO: *"each attribute in this map needs to be audited, many of the keys are actually kebab case"* | `src/dataMaps.js` ~line 210 |

---

## R5.9 What we should and should not take

| Take | Why |
|---|---|
| **Slot-children-as-a-keyed-object** (T8–T10) | The cleanest idea in the repo. `{"": …, "header": …}` maps directly onto React named-slot-as-prop, and R4 gives us `Slot.slotName` and the child's `slot` attribute to build it precisely. |
| The `.map()` shape for `for:each` (T5) | Standard, correct. Our R4 `ForEach{expression,item,index}` supplies all three names cleanly. |
| `key: api_key(…)` → `key:` (T6) | Confirms `key` maps 1:1 to React's `key`. R4 gives it as the `Key` **directive**, easier still. |
| The **bug list** (R5.8) | Free regression tests. B3 (nested iteratee) and B2 (duplicate ref) are exactly the mistakes a naive codegen makes. |
| The **wire boundary** (R5.5) | Best available evidence for where the real difficulty is. Plan for it as a first-class subsystem, not a codemod rule. |

| Do **not** take | Why |
|---|---|
| **Compiling post-LWC-codegen JS** (R5.1) | Destroys attribute/property distinction, slot names, and source locations, and couples to unversioned codegen internals. R4's AST is strictly better. |
| **Events via refs + `addEventListener`** (T19) | A workaround for information they'd already lost. We have `listeners[].name` — emit real `onClick`. |
| **`this.__s` observable-membrane + `forceUpdate`** (C4) | Class components + whole-object proxy invalidation. Modern target is hooks/`useState` or a signals store. |
| Ignoring the attribute/property split (T15) | R4 §4.4 shows it's real and recoverable; discarding it is a correctness loss. |
| `renderedCallback` → `componentDidUpdate` (C10) | Semantically wrong on first render. Needs `useEffect` with no dep array, or `componentDidMount` + `componentDidUpdate`. **[inference]** |

---

# Sources

## Fetched and used for R4

- https://github.com/salesforce/lwc/issues/2432 — "Make `@lwc/template-compiler` produce a stable AST"
- https://api.github.com/repos/salesforce/lwc/issues/2432/timeline — closure by PR #2518
- https://api.github.com/repos/salesforce/lwc/pulls/2518 — "refactor(template-compiler): refactor ast shape", merged 17 Dec 2021
- https://raw.githubusercontent.com/salesforce/lwc/master/packages/%40lwc/template-compiler/src/shared/types.ts — current AST types on `master`
- https://raw.githubusercontent.com/salesforce/lwc/master/packages/%40lwc/template-compiler/src/config.ts — current Config options
- https://raw.githubusercontent.com/salesforce/lwc/master/packages/%40lwc/template-compiler/README.md — documented API surface
- https://github.com/salesforce/lwc/releases/tag/v9.0.0 — v9 breaking changes
- https://registry.npmjs.org/@lwc/template-compiler — versions and dist-tags

## Fetched and used for R5

Verified by me directly:
- https://api.github.com/repos/blittle/lwc2react — repo metadata (exists, not archived, master branch, 6 stars, pushed 2023-01-06)
- https://api.github.com/repos/blittle/lwc2react/git/trees/master?recursive=1 — full 189-file tree

Fetched by the mining subagent (file tree independently cross-checked against my own fetch above):
- GitHub API: `/repos/blittle/lwc2react` · `/git/trees/master?recursive=1` · `/git/trees/fixes?recursive=1` · `/git/trees/fix-build?recursive=1` · `/commits?per_page=10` · `/branches` · `/branches/master` · `/issues?state=all&per_page=100`
- `https://raw.githubusercontent.com/blittle/lwc2react/master/` + `README.md`, `packages/core/package.json`, `packages/core/.babelrc`, `packages/core/src/{index,compiler,class-compiler,template-compiler,helpers,dataMaps,LightningComponent}.js`, `packages/core/tests/{bindings,class,composition,css,events,lifecycles,template-conversion}.test.js`, `packages/core/tests/__snapshots__/{bindings,class,composition,events,lifecycles,template-conversion}.test.js.snap`, `packages/sample-app/rollup.config.js`, `packages/sample-app/src/index.js`, `packages/sample-app/src/modules/my/searchBar/searchBar.js`, `packages/sample-app/src/modules/my/popularCategories/popularCategories.js`
- `https://raw.githubusercontent.com/blittle/lwc2react/fixes/packages/core/package.json`
- `https://raw.githubusercontent.com/blittle/lwc2react/fix-build/packages/core/package.json`
- https://registry.npmjs.org/lwc2react · https://registry.npmjs.org/lwc2react/0.6.5
- `https://registry.npmjs.org/lwc2react/-/lwc2react-0.6.5.tgz` — downloaded, extracted, all 7 `lib/*.js` read

### 404s / negative results (recorded deliberately)
- `https://api.github.com/repos/blittle/lwc2react/git/trees/main?recursive=1` — **404, no `main` branch exists.** Any `raw.githubusercontent.com/.../main/...` URL will 404 for the same reason.
- **No blog post by Bret Little about lwc2react was found** in web search — only third-party aggregator pages echoing the README.

## Local ground truth (installed package, v8.28.2)

- `node_modules/@lwc/template-compiler/package.json`
- `node_modules/@lwc/template-compiler/dist/index.d.ts`
- `node_modules/@lwc/template-compiler/dist/config.d.ts`
- `node_modules/@lwc/template-compiler/dist/shared/types.d.ts`
- `node_modules/@lwc/template-compiler/dist/shared/ast.d.ts`
- plus 4 executed probe scripts + `walk-demo.mjs` (outputs quoted inline above)
