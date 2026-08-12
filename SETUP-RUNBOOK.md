# CLAUDE CODE SETUP RUNBOOK
## Scaffold the LWC → React Agent repository, end to end

**How to use this:** open Claude Code in an empty directory and paste the prompt in Part 1. Everything else in this document is reference material Claude Code will need — it is written so the agent can execute it without further input.

**Target repo:** `https://github.com/shikher20goel/LWC_to_ReactJs_Agent` (currently empty)

**Prerequisites on your machine:**
- Node 22 LTS (`node --version` → v22.x)
- `git` configured, and `gh auth login` completed (or SSH keys set up)
- The three research markdown files downloaded from your Claude chat, in `~/Downloads/`

---

# PART 1 — THE PROMPT

Paste this into Claude Code:

```
Read SETUP-RUNBOOK.md in this directory and execute it completely.
Work through the phases in order. After each phase, run the stated
verification and report the result before continuing. Do not skip
verification steps. Do not push to the remote until Phase 6, and ask
me before you do.
If a verification fails, stop and tell me — do not work around it.
```

Save this file as `SETUP-RUNBOOK.md` in the empty directory first.

---

# PART 2 — REPOSITORY LAYOUT

Create exactly this structure. Empty directories get a `.gitkeep`.

```
LWC_to_ReactJs_Agent/
├── CLAUDE.md                        # agent rules — Part 4
├── README.md                        # Part 3
├── .gitignore                       # Part 7
├── .nvmrc                           # "22"
│
├── research/                        # the doc set (human-authored, versioned)
│   ├── README.md                    # index — Part 8
│   ├── 01-architecture-v2.md
│   ├── 02-agentic-engineering-best-practices.md
│   ├── 03-next-steps-and-research-plan.md
│   ├── 04-clusterA-oracle-feasibility.md
│   └── 05-s1-spike-results.md
│
├── oracle/                          # the differential oracle — WORKING, Part 5
│   ├── normalise.js
│   ├── probe.test.js
│   ├── diagnose.test.js
│   └── normalise.test.js
│
├── force-app/                       # LWC source under test
│   ├── main/default/lwc/
│   │   ├── propertySummary/
│   │   └── brokerCard/
│   └── test/jest-mocks/apex/
│
├── catalog/                         # machine-readable mappings (BLOCKING dep)
│   └── base-components.xml          # seed — Part 6
│
├── census/                          # org measurement output (empty for now)
├── shim/                            # @migration/salesforce-runtime (empty)
├── skills/                          # DO NOT POPULATE YET — see CLAUDE.md
├── fixtures/                        # oracle fixtures (empty)
└── docs/
    └── decisions/                   # ADRs for D-1..D-7
```

**Why `skills/` stays empty:** per `02-agentic-engineering-best-practices.md` Part 11, skills are step 6 of 11. They are written only for gaps found empirically by running evals. Writing them now means building for imagined problems.

---

# PART 9 — EXECUTION PHASES

Claude Code: run these in order, verifying each.

### Phase 1 — Scaffold
Create the directory tree from Part 2. Write `README.md`, `CLAUDE.md`, `.gitignore`, `.nvmrc`, `research/README.md`.
**Verify:** `find . -type d -not -path './.git/*' | sort` matches Part 2.

### Phase 2 — Research docs
Copy the markdown files from `~/Downloads/` into `research/` with the numbered names from Part 2. If a file is missing, list which and stop.
**Verify:** `ls research/*.md | wc -l` → 5 (plus README).

### Phase 3 — Oracle
Create `package.json`, `jest.config.cjs`, `sfdx-project.json`, the Apex mock, the two synthetic LWC bundles, `oracle/normalise.js`, `oracle/normalise.test.js`. Run `npm install`.
**Verify:** `npx jest --silent=false` passes and prints a boundary tree containing `◆ Card` and `· h2 "Ocean View Estate"`.
> If `h2` has no text, F4 has regressed — the slotted-content fix is missing. That silently disables `[object Object]` detection. Stop and fix.

### Phase 4 — Catalog
Create `catalog/base-components.xml` from Part 6.
**Verify:** it parses — `node -e "require('fs').readFileSync('catalog/base-components.xml','utf8')"`.

### Phase 5 — Local commit
`git init`, add everything, commit.
**Verify:** `git log --stat` shows one commit, no `node_modules`.

### Phase 6 — Remote (ASK FIRST)
Stop and ask before pushing. Then:
```bash
git remote add origin https://github.com/shikher20goel/LWC_to_ReactJs_Agent.git
git branch -M main
git push -u origin main
```

### Phase 7 — Report
Print: file count, test result, tree output, and the three next actions from Part 10.

---

# PART 10 — WHAT COMES NEXT (do not do these now)

1. **Real-component validation (~1 h).** Drop one LWC from the org into `force-app/main/default/lwc/`, add its Apex mocks + a `moduleNameMapper` entry, run. This converts "synthetic passes" into "your code passes" and is the last thing between you and a genuine go decision.
2. **R6 / R7 research** — census tooling. Before building the census.
3. **The React half of the oracle** — render a hand-written React equivalent, normalise with the same function, diff. First true end-to-end result.

**Not yet:** skills, the Ralph loop, Apex→Java. In that order of "not yet".

---

# PART 11 — TROUBLESHOOTING

| Symptom | Cause | Fix |
|---|---|---|
| `emit is not a function` | `sfdx-lwc-jest` installed globally | Install as local devDependency only |
| Empty boundary tree | Reading `attributes` instead of props | See F1 in `CLAUDE.md` |
| Tree stops at first `lightning-*` | Traversing shadowRoot only | Traverse light DOM too (F2) |
| `h2` renders with no text | Over-aggressive text suppression | Only suppress base-component *shadow* output (F4) |
| `Cannot find module 'c/...'` | LWC bundle folder name ≠ component name | They must match exactly |
| Jest can't resolve `@salesforce/apex/...` | Missing `moduleNameMapper` entry | Add mapping + mock file |

---

> Parts 3–8 (README, CLAUDE.md, oracle source, catalog seed, .gitignore,
> research index) are reproduced as their own files in this repository. This
> saved runbook is condensed to the executable phases and reference tables;
> the canonical full prose lives in the originating Claude chat.
