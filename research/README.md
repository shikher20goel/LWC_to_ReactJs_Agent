# Research

Read in numerical order.

| # | Doc | What it answers |
|---|---|---|
| 01 | architecture-v2 | **What to build.** Pipeline, contracts, oracle, kill criteria, confidence table. Supersedes v1. |
| 02 | agentic-engineering-best-practices | **How to build it.** Context engineering, skills, tools, topology, evals — from Anthropic primaries plus Horthy/Huntley. |
| 03 | next-steps-and-research-plan | **What to find out next.** 13 research prompts, census spec, sequencing, gates. |
| 04 | clusterA-oracle-feasibility | R1–R3. Off-platform rendering, wire mocking, tree diffing. |
| 05 | s1-spike-results | The spike that proved it. 14 assertions, 3 design corrections. |

## Versioning

Never overwrite. When the census contradicts a document — and it will, that's
the point — write `-v3` and keep the old one. The Part 0 changelog in `01-v2`
only means something if v1 still exists to compare against.

## Canonical source

These files also live in Google Drive (folder `LWCToReactJsResearch`). Git is
canonical; Drive is for reading.

## Provenance

Sourced from Drive on 11 Aug 2026. Drive titles drifted from repo filenames;
the mapping below is per `08 — Folder Manifest`:

| Drive title | → repo path |
|---|---|
| LWC-to-React-Agentic-Migration-BestPractices-v2.md | `01-architecture-v2.md` |
| 02-agentic-engineering-best-practices.md | `02-agentic-engineering-best-practices.md` |
| 03 — Next Steps & Research Plan (v1.1, post-spike) | `03-next-steps-and-research-plan.md` |
| R1-R3 Oracle Feasibility — … | `04-clusterA-oracle-feasibility.md` |
| S-1 SPIKE RESULTS — Oracle Feasibility: PASS | `05-s1-spike-results.md` |
| 07 — SETUP-RUNBOOK (full, executable) | `../SETUP-RUNBOOK.md` |

**Doc 03 is v1.1** (post-spike, marks S-1 complete) — newer than the v1.0
referenced by the runbook. Drive-only docs not mirrored here: `00 — Research
Index & Status`, `06 — Setup Runbook (how to use)`, `08 — Folder Manifest`.

**Not yet present:** `00-architecture-v1-superseded.md`. The manifest keeps it
out of Drive deliberately — its value is being diffable against v2 in Git.
Retrieve it from the originating chat to complete the versioning story above.
