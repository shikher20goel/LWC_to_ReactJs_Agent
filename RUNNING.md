# How to run this

Every command below was executed and its exit code verified before this file
was written. If one behaves differently for you, that is a real bug — say so.

**Requires Node 22+** (developed on 24). First time only:

```bash
npm run setup
```

### This installs OFFLINE — no npm registry access needed

The company network cannot reach the npm registry, so **every dependency ships
in `vendor/npm-cache`** (35 MB, 532 packages) and `.npmrc` makes `offline=true`
the default. A plain `npm ci` works with the network cable unplugged; verified
by wiping `node_modules` and reinstalling with `--offline`, which *fails* if
anything tries to reach out.

`--offline` is used rather than `--prefer-offline` deliberately: prefer-offline
silently falls back to the network, so it works on a laptop with internet and
then fails in CI. Better to fail here, where the message is actionable.

**The one real limitation — platform-specific binaries.** Four packages ship
native `.node` files, and the cache holds the **win32-x64** builds:
`@rolldown/binding`, `@rollup/rollup`, `lightningcss`. All four come from
**Vite, which is only used by `npm run preview`**.

So:

| | Windows | Linux / macOS |
|---|---|---|
| Core pipeline — tests, census, codemod, oracle, styles, apex | ✅ works offline | ✅ works offline (pure JS) |
| `npm run preview` | ✅ | ❌ needs its native deps for that platform |

To add another platform, run `npm run vendor:refresh` **on that platform** with
network access once, and commit the additional cache entries. The cache is
additive — it does not need re-creating.

---

## The gate

```bash
npm test
```

**140 tests, 13 suites, ~4s.** Green means the oracle, codemod, shim, census,
CSS converter and Apex facade all work. This is the check that matters; if it
fails, nothing below is trustworthy.

---

## The five things you will actually use

| Command | What it does | Exit |
|---|---|---|
| `npx jest generated.react --silent=false` | **Watch the oracle prove a conversion.** Renders the original LWC and the generated React against identical fixtures and prints both boundary trees. | 0 |
| `npm run generate` | **LWC → React.** Writes `react/generated/*.jsx` plus `*.module.css`. | **1** if any component has review items |
| `npm run census` | **The project gate.** Tiers every component M/A/H, evaluates kill criteria, reports off-platform readiness. | 0 clear · **1** Tier-H > 35% · **2** parse failures |
| `npm run styles` | **SLDS → CSS mapping report** → `docs/slds-mapping-report.md`. | **1** if any class is unmapped |
| `npm run preview` | Renders the generated React at **http://localhost:8080**. | runs until stopped |

### Exit codes are deliberate

These are meant for CI, so they fail loudly rather than reporting quietly:

- **`generate` exits 1** when a component needs review. That is *information,
  not a failure* — `recordEditFormStaticContact` exits 1 because it correctly
  **refused** to convert a Tier-H component.
- **`census` exits 2** when the parse rate drops below 100%. A census that
  silently skips 8% of bundles understates every tier percentage, so the gate
  could read "clear" on a project that should stop.
- **`styles` exits 1** on an unmapped class, because an unmapped class is a
  silent visual regression.

---

## The rest

```bash
npm run corpus          # census + generate against the real third-party corpus
npm run fixtures:check  # fixture shape + provenance (no real customer data)
npm run apex:facade     # generate the read-only Apex REST bridge
npm run codemod         # codemod tests, verbose
npm run test:verbose    # full suite with console output
```

Any of the source-scanning commands take a path:

```bash
node census/run.js <path-to-a-force-app>
node codemod/generate.js <source-root> <out-dir>
node codemod/styles-report.js <source-root> [preset]
```

---

## Running it against your own org

This is the step that turns every number here into a real one.

```bash
sf project retrieve start --metadata LightningComponentBundle --target-org <your-alias>
sf project retrieve start --metadata ApexClass --target-org <your-alias>
```

Drop the result into `force-app/main/default/`, then:

```bash
npm run census     # your real Tier-H %, and what the backend workstream costs
npm run generate   # how many of YOUR components convert clean
```

> ⚠️ **Retrieve from a Developer, Dev Pro, or scratch org.** Those are
> metadata-only. Full and Partial Copy sandboxes contain real customer data,
> and per `CLAUDE.md` rule 7 that must never enter this repo — git history
> makes it effectively irreversible.

---

## Reading the output

**`npm run census`** ends with the two things that decide the project:

```
GATE Tier-H > 35%:   clear (8.3%)          <- can kill the project
OFF-PLATFORM READINESS
  Apex methods needing re-exposure : 10    <- backend workstream
  Components blocked on backend    : 26  19.7%
```

That 19.7% is the **critical path**. A converted component cannot ship before
its data path exists, so backend work gates UI work, not the reverse.

**`npm run generate`** prints per component either `clean` or its review items.
`[tier-h]` and `[platform-escalate]` are **correct refusals** — no tool could
do better. `[missing-dependency]` and `[unmapped-import]` are our gaps.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm test` fails on a fresh clone | dependencies not installed | `npm install` |
| Preview shows an old version | a stale Vite server is holding the port | kill it; we start with `--strictPort` so it fails loudly rather than silently moving to 8081 |
| Preview looks unstyled | expected — **SLDS is deliberately not loaded** | that is the test: styles come from `shim/runtime.css` + generated modules |
| `generate` exits 1 | a component needs review | read the items; most are correct refusals |
| `census` exits 2 | a bundle failed to parse | the listed diagnostics; percentages are untrustworthy until fixed |

---

## What is NOT here

Being explicit so nothing reads as more finished than it is:

- **No agent loop runs.** The codemod is deterministic. The LLM-driven agent is
  step 8 of the build order and is not built.
- **No skills** (`skills/` is empty, deliberately — they come after evals find
  real gaps).
- **The BFF does not exist.** `shim/transport-bff.js` is the client half; the
  server on ECS is not written.
- **Tier-A is barely tested.** The corpus is 12% Tier A and clean sample apps
  are not representative. **Treat every conversion rate here as an upper
  bound.**
