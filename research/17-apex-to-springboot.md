# 17 — Apex → Spring Boot (Java): what actually converts, what cannot, and what is silently lost

**Date:** 12 Aug 2026
**Status:** research, not a decision
**Reads on from:** `01-architecture-v2.md` (Path B confidence ~15%), `15-offplatform-data-access.md` (`@AuraEnabled` is not externally callable), `16-aws-ecs-architecture.md` (BFF on ECS Fargate chosen)
**Question it answers:** the team's stated goal is "one Apex class → one Spring Boot class". Is that a real engineering plan, and under which of the two paths?

---

## 0. BOTTOM LINE UP FRONT

1. **There are three paths, not two.** The team framed A (Java calls Salesforce) vs B (data migrates). The cheapest path — **Path 0: don't convert the Apex at all, re-expose it** via `@InvocableMethod` / `@RestResource` and call it from the BFF — is already documented in `15 §2.1–2.3` and beats both for most classes. Any recommendation that ignores Path 0 is arguing about the wrong thing.

2. **The single most important asymmetry:** under **Path A, the invisible half still runs**. Your Java `insert` goes over the REST API, hits the platform save pipeline, and triggers/flows/validation rules/rollups/sharing recalculation all fire — for free, correctly, with no discovery required. Under **Path B they all stop, silently, with no compile error and no failing test.** Everything else in this document is downstream of that one sentence.

3. **Path A's cost is different, not zero.** It loses *transactionality* (there is no rollback across multiple REST calls), it loses *in-transaction read-your-writes* semantics, it converts governor limits into API limits (which are org-wide and shared with every other integration), and it introduces **SOQL injection**, a bug class that Apex bind variables structurally prevented.

4. **Path B's real problem is not the code, it's the epistemics.** You can get a *complete inventory* of triggers, flows, validation rules and rollups out of the Metadata API in an afternoon. What you cannot get is their *semantics and interaction order* — and for **managed packages you cannot read the source at all**. That is a hard ceiling on knowability, not a budget problem.

5. **Apex→Java is not a syntax problem, it is a semantics problem.** `==` on `String` is **case-insensitive** in Apex and reference-identity in Java. Apex `static` variables are a per-transaction cache; a Spring singleton's static field is shared across every request thread in the JVM. Both convert cleanly, compile cleanly, and are wrong.

6. **Governor limits do not disappear under Path B — they invert.** The 6 MB heap cap and 50,000-row cap were *load-bearing safety rails*. Remove them and the same code that threw a catchable `LimitException` in Apex now OOM-kills an ECS task and takes every concurrent request with it.

7. **Prior art is thin but real and recent.** Salesforce migrated its own Own Archive managed package — **275 Apex classes, 3,537 files, planned 2 years, delivered in 4 months** — with AI-driven refactoring plus human review. It is strong evidence for *method* (leaf-to-root dependency ordering, transformation rules, rewrite tests from intent). It is **not** evidence for feasibility here: the target was Salesforce Core, which already has a multi-tenant data layer, and the write-up says **nothing** about SOQL, DML, triggers, FLS, or governor limits.

8. **There is no production-grade Apex→Java converter in 2026.** The only OSS candidate, `tzmfreedom/apex2java`, is a WIP Go project with ~10 commits and 0 stars. The state of the art is LLM transformation under human review — which is exactly what Salesforce itself did.

9. **Security is the most likely production incident of the whole programme.** Under Path B, nothing enforces sharing or FLS. Code that returns every row to every authenticated user does not throw, does not fail a test, and passes review because it "looks like the Apex". Compounding this: **as of API v67 (Summer '26) Apex database operations run in user mode by default and `WITH SECURITY_ENFORCED` is removed** — so the security semantics of the class you are converting depend on the API version it was saved at, which you must read per class.

10. **Recommendation: Path A, with a Path 0 majority.** "One Apex class → one Spring class" is achievable *shape-wise* under Path A and is a **fiction** under Path B, because in Path B one Apex class expands into a Spring class *plus* the fragments of N triggers, M flows and K validation rules that used to run around it. I would rate Path B at or below `01`'s ~15% — the discovery work is a programme in its own right, and I found nothing in 2026 that changes that.

---

## 1. The three paths, stated precisely

| | Path 0 — re-expose | Path A — Java calls Salesforce | Path B — data migrates |
|---|---|---|---|
| Where business logic lives | Apex, unchanged | Spring Boot service | Spring Boot service |
| System of record | Salesforce | Salesforce | New database |
| SOQL becomes | still SOQL | REST `/query`, Composite, GraphQL, Bulk | JPA/JPQL/SQL |
| DML becomes | still DML | sObject/Composite REST writes | JPA persist/merge |
| Triggers, flows, VRs, rollups | run | **still run** | **stop** |
| Sharing / FLS | platform-enforced | platform-enforced *if* per-user OAuth | **you build it** |
| Governor limits | apply per call | apply per call **plus** org API limits | gone; replaced by JVM/DB limits |
| Transactionality | Apex transaction | none across calls (Composite Graph only) | Spring `@Transactional` |
| "1 Apex class → 1 Spring class" | N/A | plausible | fiction |
| Discovery burden | none | low | **the whole project** |

**Path 0 is not a compromise, it is the default.** Per `15 §2.3`, `@InvocableMethod` is additive (annotate the existing method, add wrapper types), the endpoint shape is uniform enough for the BFF to drive it from a registry, and the codemod can emit call sites mechanically. Reserve conversion for classes where you *want* the logic in Java: pure computation, orchestration, anything you plan to reuse off-platform.

---

## 2. Apex → Java language mapping

### 2.1 What converts mechanically (a codemod can do this)

| Apex | Java / Spring | Notes |
|---|---|---|
| `public class Foo` | `public class Foo` | Apex methods/classes are **final by default**; `virtual`/`override` are explicit. Converting drops that guarantee — add `final` deliberately. |
| `List<T>` | `java.util.List<T>` / `ArrayList` | Apex `List` is a **class, not an interface**. |
| `Set<T>` | `LinkedHashSet<T>` | Apex `Set` preserves insertion order in practice; `HashSet` does not. Use `LinkedHashSet` to avoid ordering diffs. |
| `Map<K,V>` | `LinkedHashMap<K,V>` | Same reasoning. |
| `Integer`, `Long`, `Double`, `Boolean` | same | `Integer` is 32-bit in both. |
| `Decimal` | `BigDecimal` | **Not** mechanical — see 2.2. |
| `String` | `String` | **Not** mechanical — see 2.2. |
| `Date`, `Datetime`, `Time` | `LocalDate`, `Instant`/`ZonedDateTime`, `LocalTime` | Apex `Datetime` is UTC-backed with user-TZ display methods. Pin `ZoneId` explicitly; do not use `LocalDateTime`. |
| `Blob` | `byte[]` | |
| `Id` | a value type, **not** `String` | See 2.2. |
| inner class | static nested class | Apex inner classes "behave like a static Java inner class but don't require the `static` keyword" — so emit `static`. |
| custom exception `class FooException extends Exception` | `class FooException extends RuntimeException` | Apex has **no checked exceptions**; extending `Exception` in Java would force `throws` clauses everywhere and change every call site. Use `RuntimeException`. |
| `System.debug()` | SLF4J `log.debug()` | |
| `@TestVisible` | package-private + `@VisibleForTesting` | |
| interfaces, enums, properties | direct equivalents | Apex properties `{ get; set; }` → fields + accessors or Lombok. |

Not available in Apex and therefore never present in the source: **custom generic types and custom annotations**. That means the converted Java will be generics-poor and annotation-poor — idiomatic Java would refactor it, which is a *deliberate* second pass, not part of the conversion.

### 2.2 The semantic traps — these compile, and they are wrong

These are the highest-value items in this whole document, because each one produces a silent behaviour change that no compiler and no naive test will catch.

**1. `==` on `String` is case-insensitive in Apex.**
```apex
String a = 'haha'; String b = 'HAHA';
if (a == b) { /* THIS RUNS */ }
```
In Java, `a == b` is reference identity — almost always `false`. A mechanical transliteration of `if (status == 'Closed')` to `if (status == "Closed")` is wrong twice over. Correct target is `equalsIgnoreCase`, **not** `equals`. A codemod that emits `.equals()` for every Apex `==` on strings will introduce case-sensitivity bugs into logic that never had them.

**2. `Map`/`Set` string keys are case-SENSITIVE in Apex — the opposite of `==`.**
So `mySet.contains('haha')` is `false` when the set holds `'HAHA'`, in the same class where `==` said they were equal. This asymmetry means you cannot apply one blanket rule; each site needs classification. Java `HashMap`/`HashSet` happen to match Apex here, so **map/set key handling converts correctly and string comparison does not** — the reverse of what a reviewer's intuition expects.

**3. The Apex *language* is case-insensitive.** Identifiers, field references (`acc.name` == `acc.Name`), method names. Java is not. Any Apex that relies on this (and codebases with mixed casing conventions do, accidentally) will fail to compile — which is the *good* failure. The bad case is dynamic field access by string name, where Apex `sObject.get('name')` works and your Java map lookup does not.

**4. `==` on sObjects compares field values, not references.** `acc1 == acc2` is a deep-ish value comparison in Apex. In Java it is identity. Every such comparison must become an explicit field-by-field or `equals()` implementation, and you must decide whether `Id` alone counts.

**5. `Id` is not a `String`.** 15-character (case-sensitive) and 18-character (case-safe) forms both exist and both round-trip through the API. Apex `Id` equality handles the 15↔18 relationship; `String.equals` does not. If Path B stores Ids as `varchar`, you inherit a data-quality problem where the same record has two representations. **Decide the canonical form (18-char) and normalise at every boundary.**

**6. `Decimal` division.** Apex `Decimal` division produces a scale derived from the operands and rounds half-up by default; `BigDecimal.divide` throws `ArithmeticException` on a non-terminating expansion unless you pass a `MathContext`. Every division in converted currency logic is a latent `ArithmeticException` or a rounding drift. This is exactly the class of bug a differential oracle (§7) catches and a unit test does not.

**7. `static` means something completely different.**
This is the one that killed Salesforce's own migration schedule. In Apex, a `static` variable is scoped to **one transaction** — it is the idiomatic request-scoped cache and recursion guard:
```apex
public class TriggerGuard { public static Boolean alreadyRan = false; }
```
In Spring, that same field on a singleton bean is **shared across every request thread in the JVM, for the lifetime of the task**. Result: cross-tenant data leakage, non-deterministic behaviour under load, and a bug that never reproduces locally. Salesforce's own write-up names this directly — static methods and "shared global state" "conflicted with Core's multi-tenant environment," risking "memory, isolation, and performance issues," and their fix was transformation rules that generated "object-oriented service layers with dependency injection" rather than direct syntax conversion.
**Codemod rule: every Apex `static` mutable field becomes either a request-scoped bean, a `ThreadLocal`, or an explicit parameter. Never a Java `static`. Flag every one for human review.**

**8. Apex transactions are single-threaded; Java is not.** No Apex code you convert contains any synchronisation, because none was needed. Nothing in the conversion adds it. Every shared structure is now a race.

**9. Null semantics.** Apex `'x' + null` yields `'xnull'` (same as Java), but Apex arithmetic on a null `Integer` throws `NullPointerException` at the *unboxing* point in Java, whereas Apex throws a `NullPointerException` too — this one is largely equivalent. The divergence is in collections: Apex `Map.get(missingKey)` returns `null` and Apex code routinely relies on that; Java `Optional`-ising it during conversion changes control flow. Don't.

### 2.3 `Database.*` methods

| Apex | Path A | Path B |
|---|---|---|
| `insert`/`update`/`delete`/`upsert` | REST sObject POST/PATCH/DELETE, or sObject Collections | `EntityManager.persist/merge/remove` |
| `Database.insert(list, false)` — **partial success**, returns `SaveResult[]` with per-row errors | sObject Collections / Composite with `allOrNone=false` — same semantics, preserved | **No equivalent.** JPA is all-or-nothing per transaction. You hand-roll per-row try/catch + error accumulation, and you lose the batching. High-frequency silent behaviour change. |
| `Database.setSavepoint()` / `rollback()` | **No equivalent.** Composite Graph is all-or-nothing *within one graph* only. | Spring `@Transactional` + JDBC savepoints — actually *better* than Apex here |
| `Database.getQueryLocator()` (Batchable source, up to 50M records) | Bulk API 2.0 query job | Spring Batch `JdbcCursorItemReader` / keyset pagination |
| `Database.upsert(list, ExternalId__c)` | REST upsert by external ID (`PATCH /sobjects/Obj/ExtId__c/value`) — preserved | `ON CONFLICT` / merge — you must build the unique index yourself |
| `Database.convertLead`, `Database.emptyRecycleBin`, `Database.merge` | dedicated REST resources exist | **No equivalent whatsoever.** Lead conversion is a multi-object platform behaviour (Lead→Account+Contact+Opportunity, field mapping, ownership, workflow). Reimplementing it is a project. |
| `Database.executeBatch` | n/a | Spring Batch job launcher |
| `Approval.process()` | Process Approvals REST | **No equivalent.** Approval processes are declarative config; see §4. |
| `Messaging.sendEmail` | Salesforce email API, or move to SES | SES / SMTP |
| `Limits.getQueries()` etc. | meaningless — delete | meaningless — delete, or replace with Micrometer counters |

**The transactionality cliff (Path A).** Apex gave you one implicit transaction spanning arbitrary DML. Path A gives you: one REST call = one transaction. Composite Graph gives all-or-nothing across up to 500 subrequests, but **governor limits apply cumulatively across all subrequests in a composite call** and exceeding any one aborts the whole request. Any Apex method that did `insert A; insert B; if (bad) rollback;` needs either (a) restructuring into one Composite Graph, (b) an idempotent compensating action, or (c) acceptance of partial failure. **Budget this per method; it is not mechanical.**

### 2.4 Governor limits: they do not disappear, they change owner

Documented per-transaction Apex limits (Apex Developer Guide):

| Limit | Sync | Async |
|---|---|---|
| SOQL queries | 100 | 200 |
| SOQL rows retrieved | 50,000 | 50,000 |
| SOSL queries | 20 | 20 |
| DML statements | 150 | 150 |
| DML rows | 10,000 | 10,000 |
| CPU time | 10,000 ms | 60,000 ms |
| Heap | 6 MB | 12 MB |
| Callouts | 100 | 100 |
| Cumulative callout timeout | 120 s | 120 s |
| `@future` invocations | 50 | 0 (from batch/future) |
| `System.enqueueJob` | 50 | 1 |
| `sendEmail` calls | 10 | 10 |

**Path A — limits multiply rather than vanish.**
- If you call Apex (Path 0 style) over Invocable/Apex REST, **all standard Apex governor limits still apply per call** (`15 §2.2`).
- You now *also* consume the **org-wide daily API allocation**: Enterprise ≈ 100,000 + 1,000 per full licence; Unlimited/Performance ≈ 100,000 + 5,000 per licence, on a **rolling 24-hour** window, shared across REST, SOAP, Bulk and Connect. This is a *shared* budget with every ETL job and integration in the company. A chatty BFF is an org-wide outage risk, not just a slow app.
- **Concurrency:** max 25 concurrent long-running (>20 s) requests in production.
- **Shape limits:** Composite = 25 subrequests (max 5 queries/collections); Composite Graph = 500 subrequests but each graph is its own transaction; GraphQL = 10 subqueries per query, 2,000 records per subquery, default page 10.
- **Net effect: bulkification becomes MORE important, not less.** In Apex it was a coding standard; in Path A it is a cost and availability control.

**Path B — limits vanish and reappear as worse failure modes.** [inference, but well-grounded]

| Apex limit | Path B replacement | Failure mode when hit |
|---|---|---|
| Heap 6 MB | ECS task memory | `OutOfMemoryError` / task OOM-kill → **all concurrent requests die**, not just the offender |
| 50,000 query rows | nothing | unbounded result set, GC death spiral, or 10-minute query |
| CPU 10 s | ALB idle timeout (default 60 s) | 504 to the user; the thread keeps burning |
| 100 SOQL / 150 DML | HikariCP pool size | connection-pool exhaustion → cascading failure across unrelated endpoints |
| per-transaction isolation | none | one bad request degrades the whole task |

The governor limits were doing free capacity planning for you. **Path B must add: result-set caps, statement timeouts, per-request time budgets, connection-pool sizing, circuit breakers, and load tests.** None of that appears in a "convert one class" estimate.

### 2.5 Async: `@future` / Queueable / Batchable / Schedulable

| Apex | Naive mapping | Why the naive mapping is wrong | What to actually do |
|---|---|---|---|
| `@future` | `@Async` | `@future` is **durable** — Salesforce queues it and it survives; `@Async` lives in an in-JVM `ThreadPoolTaskExecutor` and **dies when the ECS task is replaced** (deploy, scale-in, spot reclaim). | SQS + a consumer, or a transactional outbox. `@Async` only for genuinely fire-and-forget, loss-tolerant work. |
| `Queueable` (chaining, `enqueueJob`) | `@Async` | Same durability loss, plus Queueable chaining implies ordering | SQS FIFO queue, or Step Functions for chains |
| `Batchable` (`start`/`execute`/`finish`, scopes, up to 50M records, per-scope limit reset) | Spring Batch | Structurally the closest match — `start`→`ItemReader`, `execute`→`ItemProcessor`/`ItemWriter` chunk, `finish`→`JobExecutionListener` | Spring Batch, with chunk size = Apex scope size initially |
| `Schedulable` + `System.schedule` | `@Scheduled` | On ECS with N tasks, `@Scheduled` fires **N times**. Silent duplicate execution. | EventBridge Scheduler → single invocation, or ShedLock for distributed locking |
| `Database.Stateful` | Spring Batch `ExecutionContext` | Apex serialises state between chunks automatically | explicit `ExecutionContext` promotion |
| Platform Events / CDC subscribers | — | Pub/Sub API from Java, or EventBridge integration | keep on-platform where possible |

**`Test.stopTest()` flushed async work synchronously.** Nothing in JUnit does this. Every async test needs `Awaitility` or a synchronous test executor — see §7.

### 2.6 Exceptions

- Apex has **no checked exceptions**; custom exceptions must be named `*Exception`. → `RuntimeException` subclasses (see 2.1).
- `DmlException` carries per-row detail: `getDmlIndex`, `getDmlFieldNames`, `getDmlStatusCode`, `getDmlMessage`. Path A can preserve this (the REST error body has `errorCode`/`fields`); **Path B has no equivalent and you must design an error model that carries field names and stable status codes**, or every "this field is required" message in the UI regresses to a stack trace.
- `LimitException` is **uncatchable** in Apex by design. Any Apex `catch (Exception e)` you convert was *never* catching limit failures; in Java, `catch (Exception e)` will now swallow things Apex let kill the transaction. **Codemod: flag every broad catch.**
- `AuraHandledException` is meaningless off-platform — it becomes an HTTP status + error body (`15 §2.2`).
- `System.assert*` outside tests → do not convert to `assert` (disabled by default in the JVM); use explicit throws.

### 2.7 Tests — `Test.startTest` has no JUnit equivalent, and the reason matters

`Test.startTest()`/`stopTest()` do two things: (a) reset governor limits so the code under test gets a fresh allocation, and (b) **force queued async work to execute synchronously before `stopTest()` returns**. (a) is irrelevant off-platform. (b) is load-bearing and has no JUnit analogue.

| Apex test construct | Spring Boot equivalent | Fidelity |
|---|---|---|
| `Test.startTest/stopTest` limit reset | nothing needed | n/a |
| `Test.stopTest()` async flush | `Awaitility.await()`, or a synchronous `TaskExecutor` bean in the test profile, or `JobLauncherTestUtils` | partial — you must choose per test |
| `@isTest(SeeAllData=false)` isolation | Testcontainers + `@Sql` + `@Transactional` rollback | good (Path B) |
| test data factory | Instancio / test fixtures | good |
| `Test.setMock(HttpCalloutMock)` | WireMock / `MockRestServiceServer` | good — and **essential** for Path A |
| `System.runAs(user)` | `@WithMockUser` | **misleading**: it tests *your* authorisation code. Apex's `runAs` tested the *platform's* enforcement. Not the same assertion. |
| `Test.isRunningTest()` | test profiles | fine |
| 75% coverage deploy gate | JaCoCo in CI | equivalent, and you choose the number |
| `Test.getStandardPricebookId()`, `Test.loadData` | n/a | delete |

`01` R-4's position (extract intent, regenerate) is corroborated by Salesforce's own migration: they "extracted their logical intent and rewrote test suites in Java to validate new behavior rather than legacy structure." **Do not attempt to port Apex tests.**

---

## 3. SOQL

### 3.1 Path A — SOQL stays SOQL (this is the cheap part)

The query *text* is largely portable. `[SELECT Id, Name FROM Account WHERE Industry = :ind]` becomes an HTTP GET of `/services/data/v67.0/query?q=...`. Choose per shape:

| Shape | API | Why |
|---|---|---|
| single query, <2,000 rows | REST `/query` | simplest; `nextRecordsUrl` for paging |
| includes deleted/archived (`ALL ROWS`) | `/queryAll` | |
| several independent queries per screen | **Composite** | "the entire series counts as just one API call" — kills the request waterfall you otherwise create by moving off-platform |
| precise field selection / relationship traversal | **GraphQL** | honours OLS+FLS per context user; UI-API-family object restrictions apply |
| record + layout + picklists (LDS parity) | **UI API** | `15 §2.5` — the shim's data contract survives intact |
| >100k rows, offline/ETL | **Bulk API 2.0** | async job, don't do it in a request thread |

**What breaks in Path A:**
- **Bind variables die, and SOQL injection is born.** `:accountId` has no REST equivalent — you build a query string. Apex bind variables made injection structurally impossible for static SOQL. **Every converted query is now a potential injection site.** Mitigation: a query-builder with parameter escaping (equivalent of `String.escapeSingleQuotes`), never string concatenation, and a lint rule. This is a *new* bug class the migration introduces. Put it on the security review.
- **`WITH USER_MODE` / `WITH SECURITY_ENFORCED` become no-ops you should delete** — the REST API already runs as the authenticated user (assuming per-user OAuth, not an integration user; see §5).
- **Parent-child subqueries** return nested JSON with their own `done`/`nextRecordsUrl` — a subquery over 200 children paginates independently. Naive deserialisation silently truncates at 200. **Concrete, common, silent.**
- **Latency.** Each SOQL that used to be an in-org microsecond call is now a WAN round trip from ECS. A method with 8 queries in a loop was merely bad Apex; in Path A it is a 4-second endpoint. `16` covers the caching layer.
- **Ordering.** SOQL without `ORDER BY` has no guaranteed order and the REST API is no different — matters for the oracle (§7).

### 3.2 Path B — there is no clean ORM mapping, and here is exactly where it breaks

An `sObject` is not a row. The gaps, each requiring a decision:

| SOQL / sObject feature | JPA/SQL reality |
|---|---|
| **Formula fields** (queryable like any field) | Not stored. Become a generated column, a view, or app-layer computation — and Salesforce formula semantics (null handling, `BLANKVALUE`, cross-object formulas up to 5 levels, `TEXT()` of a picklist returning the API name) must be reproduced exactly. **Each formula is a small spec you have to reverse-engineer from its expression.** |
| **Roll-up summary fields** (queryable) | Materialised view, or DB trigger, or app-layer recompute. Must decide consistency model: Salesforce recomputes them *inside the save pipeline* (steps 16–17), so they are transactionally consistent. Eventual consistency is a **behaviour change**, not an implementation detail. |
| **Polymorphic lookups** (`Task.WhatId`, `Task.WhoId`, `OwnerId` → User *or* Queue) | No FK is possible. You need a discriminator column + no referential integrity, or table-per-type with a union view. SOQL `TYPEOF ... WHEN ... THEN` has no JPQL equivalent — becomes application-level dispatch. |
| **Parent traversal** `Contact.Account.Owner.Manager.Email` | 3 joins. Mechanical, but N+1 risk is now yours; SOQL did it in one query for free. |
| **Parent-child subquery** `(SELECT Id FROM Contacts)` | `JOIN FETCH` or `@BatchSize` — and note SOQL returns `null` (not an empty list) for a childless parent in some serialisations. Off-by-one-null bugs. |
| **`FOR UPDATE`** | `SELECT ... FOR UPDATE` — actually maps well |
| **`GROUP BY ROLLUP/CUBE`, `HAVING`, `AggregateResult`** | SQL equivalents exist; `AggregateResult`'s dynamic `get('expr0')` becomes typed projections |
| **SOSL** (`FIND {term} IN ALL FIELDS RETURNING ...`) | **No equivalent.** Postgres `tsvector` or OpenSearch. Relevance ranking will differ. Any UI global-search feature is a separate project. |
| **`toLabel()`, picklist labels, translations** | Picklist value sets, labels, translations and dependent picklists are *metadata*. You need a reference-data schema plus an admin UI you did not previously need. |
| **Record Types** | A discriminator column plus per-type layout/picklist/validation behaviour — none of which exists any more |
| **Multi-currency `convertCurrency()`, dated exchange rates** | A currency service + rate table. Non-trivial and audit-relevant. |
| **`ALL ROWS` / `IsDeleted` / recycle bin** | Soft-delete column + a 15-day restore mechanism if the business relies on it |
| **System fields** `CreatedById`, `LastModifiedDate`, `SystemModstamp` | Spring Data JPA auditing — maps well, but `SystemModstamp` vs `LastModifiedDate` differ in Salesforce (system-triggered vs user-triggered) and downstream sync logic often depends on that distinction |
| **Field History Tracking** | Envers or a history table |
| **`WITH USER_MODE`** | **Nothing.** See §5. This is the big one. |
| **18-char Ids** | see §2.2 item 5 |

**Verdict:** Path B's data layer is not "add JPA annotations". It is a data-modelling project whose size is proportional to the org's declarative surface, not to the Apex line count.

---

## 4. THE INVISIBLE HALF

### 4.1 What actually happens when Apex says `insert acc;`

The documented Salesforce order of execution for a single save:

1. Load the original record (or initialise for upsert)
2. Load new field values, perform system validation
3. **Record-triggered flows configured to run before save**
4. **All `before` triggers**
5. System validation steps and **custom validation rules**
6. **Duplicate rules** (blocks the save if the action is block)
7. Save to database (not committed)
8. **All `after` triggers**
9. **Assignment rules**
10. **Auto-response rules**
11. **Workflow rules** (field updates here re-fire before/after update triggers)
12. **Escalation rules**
13. **Process Builder and workflow-launched flows**
14. **Record-triggered flows configured to run after save**
15. **Entitlement rules**
16. **Roll-up summary recalculation on the parent**
17. **Roll-up summary recalculation on the grandparent**
18. **Criteria-based sharing evaluation**
19. Commit
20. Post-commit: emails, queueable jobs, `@future` methods, async flow paths

(During a recursive save, steps 9–17 are skipped — so the behaviour of a nested save is *different from* a top-level save. Any Path B reimplementation that models this faithfully has to model the recursion depth too.)

**One line of Apex triggers up to 18 other things.** A converted Java class contains step 7 and nothing else.

### 4.2 Path A vs Path B, item by item

| Platform behaviour | Path A (Java → REST → Salesforce) | Path B (Java → own DB) |
|---|---|---|
| Before/after triggers | **still run** | gone — must port trigger bodies into the service, in the right order, with the right recursion guards |
| Record-triggered flows (before & after save) | **still run** | gone — flows are XML, not code; must be read and reimplemented |
| Validation rules | **still run** (you get a 400 with the error) | gone — rule formulas must be translated to Bean Validation / service checks. Silent data corruption if missed. |
| Duplicate & matching rules | **still run** | gone — fuzzy matching is a library + tuning project |
| Assignment rules (Lead/Case) | **still run** (needs the assignment-rule header) | gone — routing logic to rebuild |
| Auto-response rules | **still run** | gone |
| Workflow field updates | **still run** | gone (and workflow rules are deprecated as of Dec 2025, so tooling coverage for them is *worsening*) |
| Escalation & entitlement rules, milestones | **still run** | gone — SLA engine to build |
| Roll-up summaries | **still run, transactionally** | gone — see §3.2 |
| Criteria-based sharing recalculation | **still run** | gone — see §5 |
| Formula fields | **still computed** | gone — see §3.2 |
| Approval processes | still available via REST | gone — a workflow engine (Camunda/Flowable) becomes in scope |
| Sharing model (OWD, roles, sharing rules, manual `__Share` rows, teams, territories, implicit account→child sharing) | **enforced**, if per-user OAuth | **gone — you build all of it** |
| FLS, object permissions | **enforced**, if per-user OAuth | gone |
| Required-on-layout fields, dependent picklists, record-type picklist filtering | gone in *both* (these are UI-layer; your React app must reimplement them either way — see `15 §2.5`, UI API returns layout metadata) | gone |
| Platform Events, CDC, Outbound Messages | still fire | gone — every downstream consumer of these breaks |
| Managed-package triggers/flows | **still run — and you never needed to know they existed** | **gone, and you cannot read their source to reimplement them** |
| Standard-object behaviour (Lead conversion, Opportunity stage↔probability, Case escalation, Account hierarchy, activity timeline, Chatter feed tracking, business hours/holidays, fiscal years) | still there | gone — each is a feature to rebuild |
| Setup Audit Trail, Field History, Big Objects | still there | gone |

**Path A also loses things — be honest about them:**
- **Read-your-writes inside a transaction.** Apex code that inserted a record and then read a before-trigger-populated field got the populated value. Path A must re-read over the network, or accept staleness.
- **Atomicity across operations** (§2.3).
- **The ability to see what happened.** Your Java `insert` returns an Id. It does not tell you that a flow just created three related records and changed a field you had in memory. Your in-memory object is now stale and wrong, silently. **[inference] This is Path A's own silent-failure class and it is under-appreciated:** every write should be followed by a re-read of any field the caller will use, or you must explicitly document which fields are trustworthy post-write.

### 4.3 How would a team discover the invisible half?

Split the question, because the two halves have very different answers.

**(a) The INVENTORY — this is tractable. You can get a complete list.**

| Method | Coverage | Cost |
|---|---|---|
| **Metadata API retrieve** with a wildcard `package.xml` (`ApexTrigger`, `Flow`, `ValidationRule`, `WorkflowRule`, `CustomField` incl. formula & rollup, `DuplicateRule`, `MatchingRule`, `AssignmentRules`, `AutoResponseRules`, `EscalationRules`, `ApprovalProcess`, `SharingRules`, `RecordType`, `PermissionSet`, `Profile`) | **Complete for unmanaged metadata.** This is the single highest-value hour of the project. | hours |
| `sfdx-hardis` (free, OSS) — generates a searchable doc site of Flows/Objects/Profiles/Apex with AI-written explanations, visual Flow diffs, and an **Excel data dictionary of objects with fields, validation rules and record types read live from the org** | broad, and the Flow documentation output is genuinely useful | hours–days |
| **Salesforce Code Analyzer** (`sf plugins install code-analyzer`) — PMD for Apex plus a **Flowtest engine that analyses Flows** | code + flow static analysis | hours |
| Spring '26 **Flow "Usage" tab** in the Automation app — bidirectional Flow dependencies natively, no metadata download | flows only, but native and current | minutes |
| Commercial org-intelligence: Gearset Org Intelligence, Elements.cloud, Salto, Sweep | graph-based dependency mapping, hardcoded-ID detection | licence + days |

**(b) The DEPENDENCIES — this is where the tooling is genuinely weak. Do not trust it.**

`MetadataComponentDependency` (Tooling API) is the native answer, and its documented/reported limitations are disqualifying on their own:
- **Beta for several years**, not covered by standard support
- **2,000-record query cap — results truncate with no warning**
- **Direct dependencies only** — a field used in a Flow called by another Flow requires recursive querying you write yourself
- Limited type coverage (ApexClass, ApexTrigger, CustomObject, CustomField, Aura bundles, etc.); **reports and dashboards excluded**

The native "Where is this used?" feature has a documented set of blind spots:
- **dynamic Apex references** built at runtime
- **field usage inside Flow formula resources**
- **hardcoded IDs**
- external systems reading via REST/SOAP
- Workflow Rule dependencies (deprecated Dec 2025)
- **LWC JavaScript field references**
- email-template field consumption
plus the same **2,000-reference limit**.

Every one of those blind spots is a place where a Path B migration drops behaviour on the floor.

**(c) The SEMANTICS — only runtime observation gets you here.**

Static inventory tells you *that* a flow exists. It does not tell you what it does to your data under the inputs your Apex class produces. The empirical method:

1. In a full-copy sandbox, enable debug logs at `Workflow`/`Validation`/`Apex Profiling` verbosity for a test user.
2. Execute a representative set of DML operations (ideally the exact operations your Apex classes perform).
3. Read the resulting **execution tree** — it shows which triggers, flows and validation rules actually fired.
4. Snapshot the affected records before and after; **the field-level delta that your Apex code did not write is, by definition, the platform's contribution.**
5. Repeat per object, per record type, per operation (insert/update/delete/undelete).

**Documented gap:** debug logs **do not include information from actions triggered by time-based workflows.** Anything scheduled or time-delayed is invisible to this method. So is anything that fires only for data shapes your test set doesn't produce.

**Hard ceiling:** managed packages. Their triggers and flows execute inside the save pipeline and their Apex source is not readable. Under Path A that is fine — it keeps working. Under Path B **you cannot reimplement what you cannot read**, and no tool solves this. If the org has meaningful managed packages touching migrated objects, **Path B is not merely expensive, it is under-determined.**

### 4.4 Is Path B knowable, or a leap of faith?

**Knowable:** the inventory (complete), the Apex source (complete), the validation-rule formulas (readable), the flow XML (readable, tediously).
**Not knowable without execution:** interaction order, recursive-save behaviour, which rules fire for which data shapes, time-based automation.
**Not knowable at all:** managed-package behaviour.

So: **Path B is knowable in proportion to how declarative-light and package-free the org is** — which is a question the census must answer *before* anyone estimates. `01`'s ~15% stands. I would add a gate: *if `Flow` + `ValidationRule` + `WorkflowRule` + rollup-field count on the migrated objects exceeds the Apex class count, Path B is not a conversion project, it is a rewrite.* [inference]

---

## 5. Security

### 5.1 What you are converting *from* depends on the class's API version — check this first

This changed very recently and it matters:

- **API v67.0 (Summer '26): Apex database operations run in user mode by default.** Plain SOQL, SOSL and DML now respect the running user's object permissions, FLS and sharing rules.
- **A class with no sharing keyword defaults to `with sharing` at v67.**
- **`WITH SECURITY_ENFORCED` is removed as of v67.0** — use `WITH USER_MODE`.
- **Triggers always run in system mode**, regardless of version.

Consequence for the migration: `without sharing` in a v66 class and an unannotated v67 class have *opposite* defaults. **A codemod must read each class's API version from its `.cls-meta.xml` before deciding what security semantics it is preserving.** Getting this backwards produces either a broken app or a data breach.

Note also the enforcement granularity: user mode enforces FLS *and* sharing together, with no way to enforce only FLS; `Security.stripInaccessible` strips inaccessible fields (returning an `SObjectAccessDecision`) but **does not enforce record-level sharing by itself**.

### 5.2 Path A

Enforcement is Salesforce's — **conditionally.**

- **If** the BFF uses per-user OAuth (each end user's own Salesforce identity), then sObject/Query/UI API/GraphQL calls run as that user and OLS, FLS and sharing are enforced by the platform. This is the safe design and it is what `15 §6.2` recommends.
- **If** the BFF uses a single integration user (the tempting, simpler option), **the platform enforces that integration user's permissions, which are typically broad**. Your Spring service is now a confused deputy: it correctly authenticates the end user and then fetches data as somebody far more privileged. `15 §6.5` names this trap; it remains the most likely way this architecture fails a security review.
- Apex-based routes (Path 0, `@RestResource`/`@InvocableMethod`) inherit the *Apex* rules — the class's own sharing keyword and API version — **not** the caller's. So Path 0 methods need the §5.1 audit individually.
- **Failure mode:** over-broad reads that look correct in every test, because the integration user can see everything the test expects.

### 5.3 Path B

**Nothing enforces anything. You build all of it.** Concretely, what must be rebuilt:

| Salesforce construct | Spring Boot replacement |
|---|---|
| Org-wide defaults (private/read/read-write) | default-deny predicate on every repository query |
| Role hierarchy | closure table or recursive CTE over a manager/role tree |
| Criteria-based & owner-based sharing rules | an ACL table, recomputed on write |
| Manual shares / Apex managed sharing (`__Share` objects) | ACL rows |
| Team/territory/implicit account→child sharing | more ACL rows, more recompute |
| FLS | per-role DTO projection, or column-level filtering; must apply on **read and write** |
| Object permissions (CRUD) | method-level `@PreAuthorize` |
| Sharing recalculation on ownership change | a background job |

Postgres **row-level security** is one credible implementation of the record-level half, at the cost of pushing identity into the DB session. Spring Security ACL is another. Either way it is weeks, not days, and it must be *tested adversarially*, not just functionally.

**The failure mode if nobody does this — state it in the design review verbatim:**
> The converted repository method has no `WHERE` clause for visibility, because the Apex it came from had no `WHERE` clause for visibility, because the platform added one. The endpoint returns every row to every authenticated user. It throws no exception. It fails no test. It passes code review because it looks exactly like the Apex. It will be found by a customer, an auditor, or a bug bounty.

This is the single highest-severity risk in the entire migration, and it exists **only in Path B**.

---

## 6. Prior art and existing tooling — reported honestly

### 6.1 Salesforce's own Apex→Java migration (the one real data point)

Salesforce Engineering, Dec 2025 — migrating the **Own Archive** managed package (a seven-year-old acquired third-party app) into Salesforce **Core** as Core-compliant Java.

**Numbers:** 275 Apex classes; 3,537 files migrated; planned 2 years, delivered in **4 months**; the same team now maintains ~14,000 files (both versions).

**Method — this part transfers directly to our programme:**
- Generated a **complete dependency graph** and migrated **leaf-to-root**: constants and dependency-free utilities first, then upward, "each layer built upon verified implementations."
- Used **transformation rules** that instructed the AI to generate **object-oriented service layers with dependency injection**, rather than direct syntax conversion — specifically to fix the static/shared-global-state problem, which "conflicted with Core's multi-tenant environment."
- Every generated file had to **compile and pass linting** before proceeding.
- Engineers reviewed output at each layer; end-to-end functional validation; bug bashes with external teams; iterative rule refinement.
- **Tests: not ported.** They "extracted their logical intent and rewrote test suites in Java to validate new behavior rather than legacy structure." They planned Selenium UI automation to surface behavioural issues earlier.

**Problems they hit:** undocumented legacy patterns; behaviour "difficult to trace"; files could not be translated independently because meaning lived in the wider context — direct translation produced "incomplete method signatures, ambiguous return values, or partial rewrites that appeared syntactically correct but deviated from expected runtime behavior."

**Their honest caveat:** "AI accelerated translation and reduced development overhead, but correctness required systematic test strategy, human review, and iterative refinement." Initial deployment "revealed functional gaps that surfaced only through hands-on testing."

**Why it is weaker evidence than it looks for *our* problem:**
- The target was **Salesforce Core**, which already provides a multi-tenant data layer, an ORM, and platform services. They did not have to answer "what replaces the save pipeline" — the destination *had* one.
- The source was a **managed package**, i.e. self-contained code they owned, not a customer org with accumulated declarative automation.
- The write-up contains **no discussion of SOQL, DML, triggers, governor limits, sharing or FLS.** The entire invisible-half problem is absent, which strongly suggests it was not their problem.
- **Conclusion: cite it for method (dependency ordering, transformation rules, DI-ification of statics, regenerate tests). Do not cite it as evidence that Path B is feasible.**

### 6.2 Converters and transpilers

| Tool | Reality |
|---|---|
| `tzmfreedom/apex2java` (GitHub) | Written in Go, ~10 commits, **0 stars**, README self-describes as "[WIP]". No evidence of SOQL/DML handling. **Effectively nothing.** |
| CodePorting.ai "Apex to Java" | Commercial, **snippet-level** AI conversion. No org context, no SOQL/DML/metadata awareness. Fine for a method body, useless for a migration. |
| ORMIT™-APEX (Renaps) | **Oracle** APEX, not Salesforce Apex. Frequently a false positive in searches. Ignore. |
| PMD Apex / Salesforce Code Analyzer | Not converters, but the **best available Apex AST/static-analysis substrate**: 40+ Apex rules across 7 rulesets, custom rules supported, CLI-native (`sf code-analyzer run`), plus a Flowtest engine for Flows. **This is what a codemod should be built on.** |
| `apex-jorje` (Salesforce's internal Apex compiler/parser) | Referenced widely but I found **no 2026-current public documentation** for using it as a supported parsing library. Treat as unverified. |

**Honest verdict: no production-grade Apex→Java converter exists in 2026.** The state of the art is LLM-driven transformation under rule-based constraints with human review at every layer — which is precisely what `01`/`02` propose and what Salesforce actually did.

---

## 7. Testing, and whether a differential oracle applies

### 7.1 What the Spring Boot suite looks like

| Layer | Tool | Replaces |
|---|---|---|
| pure logic (calc, string, date, branch) | plain JUnit 5 + AssertJ | the majority of Apex unit tests |
| repository / data layer | **Path B:** Testcontainers Postgres + `@DataJpaTest`. **Path A:** WireMock recording real Salesforce responses | Apex test data factories + SOQL assertions |
| service layer | `@SpringBootTest` slices, mocked repositories | `Test.startTest/stopTest` bodies |
| async | Awaitility, `JobLauncherTestUtils`, sync `TaskExecutor` test profile | `Test.stopTest()` flush |
| authorisation | `@WithMockUser` + **explicit negative tests per role** | `System.runAs` — *and it is not equivalent* (§2.7) |
| contract with the React app | Spring Cloud Contract / Pact | none — this is new |
| coverage | JaCoCo | the 75% deploy gate |
| behaviour parity | **the differential oracle, below** | none — this is new |

Note the two rows that have **no Apex antecedent**: contract tests and parity tests. Both are net-new scope.

### 7.2 Can you run Apex and Java against the same inputs and diff?

**Yes, and it is the strongest quality control available — but only in a specific form, and its most valuable output is not the pass/fail.**

**Design (record/replay, not live dual-run):**

1. **Instrument.** In a full-copy sandbox, wrap each target Apex method so that every invocation records: input arguments (serialised), the pre-state of every record it reads, the return value, and the **DML delta** it produced (records created/updated/deleted with field-level before/after). Debug logs plus a wrapper class get you most of this; `01`/`09` already contemplate a harness of this shape.
2. **Capture** across real usage or a scripted scenario suite. These become versioned JSON fixtures — the golden master.
3. **Replay** against the Java implementation: seed the DB (Path B) or WireMock (Path A) from the recorded pre-state, feed identical inputs, capture return value and DML delta.
4. **Diff** with canonicalisation.

**Canonicalisation is mandatory or the oracle is useless.** Normalise: record Ids (map old→new), `CreatedDate`/`LastModifiedDate`/`SystemModstamp`, auto-numbers, **SOQL result order when the query has no `ORDER BY`** (sort before comparing), floating/decimal scale, and time-zone rendering. `04`/`05` established the tree-diff and canonicalisation machinery for the LWC oracle; the same shape applies.

**What it catches, reliably:** arithmetic and rounding drift (the `Decimal`→`BigDecimal` trap), string comparison case-sensitivity flips, null-handling divergence, off-by-one in collection iteration, branch-condition inversions, date/timezone errors, and missing fields in the DML delta. That is the majority of transliteration defects.

**What it cannot catch — and the crucial reframe:**
Under Path B, the Apex recording's post-state includes everything the platform did (steps 3–18 of §4.1). The Java replay produces only step 7. **So the diff will be dominated by platform-attributable noise.** The naive reaction is "the oracle doesn't work for Path B."

**The correct reaction: that noise is the deliverable.** The set of field changes present in the Apex delta and absent from the Java delta **is a machine-generated, empirical inventory of the invisible half** — for exactly the code paths your users actually exercise. It is better evidence than any static dependency tool, because it is observed rather than declared, and it covers managed packages, which no static tool can read.

**So: run the oracle as a discovery instrument first and a regression gate second.** [inference — I found no published example of anyone using an Apex→Java differential harness this way; the technique is a standard golden-master/characterization-test construction applied to a new domain.] Under Path A the noise mostly disappears (both sides trigger the same platform automation), which makes Path A's oracle a clean pass/fail gate — another point in Path A's favour.

**Limits to state up front:** it only covers code paths you exercise; it needs a full-copy sandbox with representative data; it cannot observe time-based automation (§4.3); and recording production traffic has data-privacy implications that need approval before anyone builds it.

---

## 8. Deliverable

### (a) Path A or Path B, for a team whose goal is "one Apex class → one Spring Boot class"?

**Path A — and for most classes, Path 0 (don't convert at all).**

The team's stated goal is a *shape* goal, and the honest response is that the shape is only achievable under Path A:

- **Under Path A**, one Apex class → one Spring `@Service` is a genuine, defensible mapping. The class keeps its methods, its logic, and its responsibilities; only the data-access lines change from SOQL/DML to a `SalesforceClient` call. That is reviewable, estimable, and codemod-assistable.
- **Under Path B, 1:1 is a fiction.** One Apex class becomes: a Spring service + the ported bodies of every trigger that used to fire around its DML + the translated formulas of every validation rule + a rollup recompute + an authorisation predicate + an ACL recalculation + a schema decision for every polymorphic lookup. The 1:1 count is preserved only by pushing the missing behaviour somewhere nobody counted it — which is precisely how a migration ships a data-integrity incident.

**Concretely, triage the Apex census into four buckets:**

| Bucket | Signature | Action | Share [inference] |
|---|---|---|---|
| **Pure compute** — no SOQL, no DML, no `Schema.`, no `UserInfo` | utilities, calculators, formatters, validators | **Convert to Java.** Genuinely 1:1, high-confidence, oracle-verifiable. Do these first (leaf-to-root, per Salesforce's method). | 15–30% |
| **DTO / wrapper classes** | data holders | **Generate** Java records from the Apex shape. Fully mechanical. | 10–20% |
| **Data access + platform-coupled** | SOQL/DML heavy, `Database.*`, sharing-sensitive | **Path 0 — leave in Apex, re-expose** via `@InvocableMethod` (`15 §2.3`) | 40–60% |
| **Pure CRUD that never needed Apex** | thin wrappers over a query | **Delete.** Call UI API / GraphQL directly (`15 §2.3` category (c) — "usually larger than teams expect and the single biggest cost saver available") | 10–20% |

Adopt Path B **only** for a bounded subdomain that passes an explicit gate: no managed packages touching its objects, declarative surface smaller than the Apex surface, and a differential oracle showing a platform-attributable delta you can fully enumerate. Not org-wide. Not as a default.

### (b) What a codemod can realistically automate vs what needs humans

**Automatable with high confidence:**
- Type and collection mapping (§2.1), including `LinkedHashMap`/`LinkedHashSet` selection for ordering fidelity
- Class/interface/enum/inner-class skeletons; `static` nested emission; `final`-by-default preservation
- Custom exception classes → `RuntimeException` subclasses
- `System.debug` → SLF4J
- DTO/wrapper → Java records
- SOQL string extraction and rewriting into a typed query-builder call (Path A)
- Call-site generation for Path 0 (`@InvocableMethod` registry-driven) — the uniform endpoint shape makes this genuinely mechanical
- JUnit skeleton generation from Apex test method names (skeletons, **not** assertions)
- **Classification and reporting**: which bucket each class belongs to, per-class API version (for §5.1), which classes touch which objects, which objects carry triggers/flows/VRs/rollups

**Automatable as flags, not fixes — machine finds, human decides:**
- Every `==` on `String` (case-insensitive semantics)
- Every `static` mutable field (the multi-tenancy bug)
- Every `Decimal` division (rounding/`ArithmeticException`)
- Every broad `catch (Exception)` (used to not catch `LimitException`)
- Every `Database.*` partial-success call
- Every savepoint/rollback (transactionality cliff)
- Every dynamic SOQL / string-built query (injection)
- Every `without sharing` class, and every unannotated class below v67

**Needs humans, unavoidably:**
- Transaction boundary redesign (§2.3)
- Data model design for polymorphic lookups, record types, picklist metadata (§3.2)
- Formula-field and validation-rule translation (each is a small spec)
- Flow comprehension — flows are XML state machines; reading them is an interpretation task
- The entire authorisation model (§5.3)
- Async durability decisions (§2.5)
- Test intent extraction (`01` R-4, corroborated by Salesforce)
- Deciding what *not* to migrate

Salesforce's own experience is the calibration: AI did the translation, and correctness still "required systematic test strategy, human review, and iterative refinement," with functional gaps surfacing only in hands-on testing — on a codebase with **none** of the org-coupling problems this project has.

### (c) Blunt list of what this adds to project scope

Things not in a "convert the UI components" plan, and not in a "convert one Apex class" estimate:

**Both paths:**
1. Apex census with per-class API version, bucket classification, and object-touch mapping
2. Path 0 re-exposure work: `@InvocableMethod`/`@RestResource` wrappers, wrapper types, new Apex tests, API documentation, and permanent ownership of a public contract (`15 §2.2`: 0.5–1.5 days/method simple, 2–4 days/method complex)
3. A differential recording harness and fixture corpus, plus a privacy sign-off for recording real data
4. Test suite regeneration from intent — the existing Apex tests are worth zero as artefacts and a lot as documentation
5. Contract tests between BFF and React (new discipline, no antecedent)
6. Async durability infrastructure: SQS/outbox, EventBridge Scheduler or ShedLock, Spring Batch jobs
7. Observability that replaces debug logs and governor-limit counters: Micrometer, structured logging, distributed tracing
8. `static`-field audit and DI-ification across the whole converted surface

**Path A specifically:**
9. Salesforce API budget management — the daily allocation is org-wide and shared; you need monitoring and a quota model *before* go-live, or you take out other integrations
10. Caching layer in the BFF (UI API responses are large; every SOQL is now a WAN hop)
11. Request-shape redesign to Composite/GraphQL to kill waterfalls
12. Compensating-action design wherever Apex used savepoints
13. **A SOQL-injection prevention regime** — a bug class the migration creates
14. Per-user OAuth token management, refresh, and mid-session expiry (`15 §3.4`) — the alternative (integration user) is a security finding

**Path B specifically — and this is the honest list:**
15. **A declarative-automation discovery programme**: metadata inventory, flow-by-flow comprehension, validation-rule translation, formula reverse-engineering, runtime execution-tree capture per object per operation
16. **Data model design** for polymorphic lookups, record types, picklists, translations, multi-currency, soft delete, field history
17. **Reimplementation of the save pipeline**: ordering, recursion semantics, before/after equivalents
18. **Rollup consistency engine** (and a decision to accept eventual consistency as a behaviour change)
19. **The entire authorisation model**: OWD, role hierarchy, sharing rules, manual shares, teams/territories, FLS, plus recalculation jobs and adversarial tests
20. **A workflow/approval engine** if approval processes are in scope
21. **Full-text search replacement** for SOQL
22. **Capacity engineering that governor limits used to do for free**: result caps, statement timeouts, pool sizing, circuit breakers, load tests
23. **Every downstream consumer of Platform Events, CDC, Outbound Messages, and reports** — they all break
24. **A resolution for managed packages** — for which there is no technical answer, only a scoping one
25. Dual-run/reconciliation period and cutover plan, because you cannot roll back a data migration

Items 15–25 are why `01` says "needs its own programme." Nothing found in this pass reduces that list.

---

## 9. What I could not verify in 2026

- **`apex-jorje`** as a usable public Apex parser: no current public documentation found. If the codemod needs a real Apex AST, budget a spike on PMD's Apex frontend instead, which is documented and CLI-accessible.
- **Any published Salesforce-org-to-custom-application (Path B) migration with technical detail.** Searches surface CRM-to-CRM migrations (Salesforce→Dynamics, →HubSpot) and vendor case studies. The relevant anecdotes are real but second-hand: a 9-year org with 28 custom objects, 200+ workflow rules and 15 Apex triggers rebuilt on a different data model; a field whose picklist values were hardcoded across dozens of validation rules that "would have failed silently post-migration." **Treat as directionally true, not as a citable engineering account.**
- **Whether `MetadataComponentDependency` has exited Beta or lifted its 2,000-row cap in 2026.** Sources still describe it as Beta with the cap. Re-confirm against the org before relying on it.
- **Exact 2026 Composite subrequest limits.** Multiple sources say 25 subrequests (max 5 queries/collections) and 500 for Composite Graph; `15 §2.4` also flags this as unconfirmed. Confirm against the version-specific doc before designing around it.
- **Whether Heroku Connect's formula/rollup sync limitation has been fixed.** The documented problem (formula changes don't bump `SystemModStamp`, so values silently stop syncing; rollups sync eventually, up to ~30 min) is sourced to 2024 material. If anyone proposes Heroku Connect as the Path B bridge, **verify this first — it is a silent data-correctness bug, not a performance note.**
- **Bucket percentages in §8(a)** are my estimates, not measured. The census must replace them.

---

## 10. Sources

### Fetched and read in full

- https://engineering.salesforce.com/how-ai-driven-refactoring-cut-a-2-year-legacy-code-migration-to-4-months/
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm
- https://developer.salesforce.com/blogs/2022/09/an-introduction-to-apex-for-java-developers
- https://github.com/tzmfreedom/apex2java
- https://gearset.com/blog/salesforce-impact-analysis/

### Surfaced via search; claims quoted from search summaries, not full-page reads — verify before relying on a specific number

- https://products.codeporting.ai/convert/apex-to-java/
- https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_metadatacomponentdependency.htm
- https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/code-analyzer.html
- https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/engine-pmd.html
- https://sfdx-hardis.cloudity.com/
- https://github.com/hardisgroupcom/sfdx-hardis
- https://www.salesforceben.com/new-in-spring-26-how-to-find-salesforce-flow-dependencies/
- https://salesforcebreak.com/2026/03/25/usage-tab-flow-dependencies-at-a-glance/
- https://help.salesforce.com/s/articleView?language=en_US&id=release-notes.rn_apex_default_user_mode.htm&release=262&type=5
- https://www.salesforceben.com/top-8-salesforce-summer-26-features-for-developers/
- https://blog.beyondthecloud.dev/blog/apex-security-and-sharing
- https://developer.salesforce.com/docs/platform/lwc/guide/apex-security.html
- https://developer.salesforce.com/docs/platform/graphql/guide/query-limits.html
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite_graph_limits.htm
- https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_api.htm
- https://knowledgelib.io/business/erp-integration/salesforce-composite-api-capabilities/2026
- https://zhouhu.wordpress.com/2016/07/02/apex-string-case-insensitive-and-id/
- https://th3silverlining.com/2009/06/22/force-com-case-sensitivity/
- https://help.heroku.com/0YVA2DRW/why-are-calculated-fields-not-syncable-in-heroku-connect/
- https://github.com/heroku/roadmap/issues/319
- https://en.wikipedia.org/wiki/Characterization_test
- https://www.codurance.com/publications/2012/11/11/testing-legacy-code-with-golden-master
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_debug_log.htm
- https://help.salesforce.com/s/articleView?id=platform.code_debug_log.htm&language=en_US
- https://www.dench.com/blog/salesforce-migration-guide
- https://www.sweep.io/blog/how-to-run-salesforce-org-discovery-in-hours-not-days
- https://help.salesforce.com/s/articleView?language=en_US&id=000386144&type=1
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite.htm
