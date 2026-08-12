# AccountController → AccountControllerService

**Path:** A — Salesforce remains the system of record (decision D-1)
**Source:** `AccountController.cls`  ·  **Sharing:** `with sharing`  ·  **API:** `62.0`
**Methods:** 1 (1 read, 0 write)

## A human must still do

- [ ] Translate each method body. The generated bodies route through the
      Apex REST bridge — correct as a transition, not as a destination.
- [ ] Decide sharing and FLS explicitly. On-platform the platform enforced
      them; here nothing does until someone writes it.
- [ ] Replace `Map<String,Object>` with real DTOs where the shape is known.
- [ ] Write tests from the Apex tests' INTENT, not by porting them
      (research/01 R-4).

## Flagged

- **[security]** apiVersion 62.0 is BELOW v67.0, so this class runs in SYSTEM MODE on-platform — FLS and object permissions are not enforced by default. Do not assume the Java equivalent inherits user-mode safety just because the platform default changed.
- **[injection]** Apex bind variables (:var) structurally prevent SOQL injection. They do NOT survive the move to API query strings, which creates a bug class Apex did not have. Any query built in Java must parameterise or escape explicitly — this is new attack surface, not a port of an old one.
- **[limits]** Governor limits invert rather than vanish. The 6 MB heap and 50k-row caps were free capacity planning that failed as a catchable LimitException. Without them an oversized result becomes an ECS task OOM-kill that takes concurrent requests down with it.
- **[types]** Modelled as Map<String,Object> rather than invented DTOs: Account. Guessing a DTO shape from a type name produces plausible-wrong code that is expensive to unpick.
- **[state]** `static` means OPPOSITE things in the two languages. In Apex it is per-TRANSACTION and discarded afterwards; in Spring it is per-JVM and shared across every concurrent request. Any Apex static state ported literally becomes a cross-request data leak that only appears under load. Keep the Spring service stateless.