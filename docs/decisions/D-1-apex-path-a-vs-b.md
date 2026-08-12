# D-1 — Apex: Path A or Path B

**Status:** Proposed — Path A recommended. Path B requires explicit written
sign-off (`CLAUDE.md`: *"Do not implement Apex→Java Path B without an explicit
written decision."*)

**Trigger:** the stated goal became *"one Apex class to one Spring Boot class"*,
alongside *"one LWC to one React component"*. The LWC half is already 1:1 and
shipping. The Apex half is not one decision — it is two very different
projects wearing the same sentence.

---

## The two paths

### Path A — Spring Boot calls Salesforce  ← recommended

One Spring class per Apex class. The business logic moves to Java; SOQL and
DML become Salesforce API calls. **Salesforce remains the system of record.**

- Fits the architecture already chosen: the BFF on ECS Fargate (research/16)
  *becomes* these Spring services. This is not new infrastructure.
- Solves the blocker in research/15 — `@AuraEnabled` is not externally
  callable, so something server-side has to bridge it regardless. Spring Boot
  is a legitimate answer to that; it is the same BFF with the logic moved in.
- The platform keeps enforcing what it enforces today: triggers, flows,
  validation rules, rollups, sharing, FLS.
- Reversible. A class can move back, or never move, one at a time.

### Path B — data migrates off Salesforce

SOQL and DML become JPA/SQL against a new database. Salesforce stops being the
system of record.

`research/01` Part 12 rates this **~15%** and calls it *"needs its own
programme."* The reason is not the Java translation, which is the tractable
part. It is this:

> **The Apex source contains no record that triggers, flows, validation rules,
> and rollups exist.**

Read a class, convert it faithfully, and every one of those silently
disappears. The output compiles, passes its tests, and is missing the half of
the behaviour that was never written in Apex. That is the same failure shape
this project has spent its effort eliminating everywhere else — code that is
plausible, green, and wrong — except at a scale where the oracle cannot see it,
because the missing behaviour was never in the source to begin with.

---

## Recommendation

**Path A.** Not as a compromise — as the option that matches the stated goal.
"One Apex class to one Spring Boot class" is fully achievable under Path A. The
1:1 mapping is the same. What differs is only where the data lives, and Path B
buys nothing extra for the migration while taking on the org's entire invisible
behaviour surface as an unscoped risk.

Path B may still be right as a *destination*. It is not a step.

## What this means concretely

| | Path A | Path B |
|---|---|---|
| 1 Apex class → 1 Spring class | ✅ | ✅ |
| SOQL becomes | Salesforce API call | JPA / SQL |
| Triggers, flows, validation rules | keep working | **silently lost** |
| FLS / sharing | platform-enforced | **our problem, entirely** |
| System of record | Salesforce | new database |
| Reversible per class | ✅ | ❌ |
| research/01 confidence | Path A ~45% | **Path B ~15%** |

## Consequences of choosing A

- The BFF and the Spring services are the same thing. No separate component.
- The generated Apex REST facade (`apex/generate-facade.js`) becomes a
  *transition* mechanism: it bridges Apex that has not moved yet. Classes
  migrate to Spring one at a time, and the facade shrinks as they do.
- Governor limits are replaced by Salesforce **API** limits, which are
  org-wide and not increased by adding ECS tasks (`CLAUDE.md` rule 8).
  Moving logic to Java does not remove the ceiling; it moves it.

## If Path B is chosen anyway

Then before any conversion, an inventory of the org's invisible behaviour is a
hard prerequisite — triggers, flows, validation rules, rollups, duplicate and
assignment rules, formula fields. Not as documentation, as a **gate**. The
census already inventories Apex reachable from LWC; it does not yet inventory
any of these, and converting without them is a leap of faith rather than a
migration.

## Open

Awaiting research/17 (Apex→Spring Boot: what converts mechanically, what is
lost, what tooling exists) before committing to an implementation plan.
