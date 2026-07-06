# Implementation Plan

This plan sequences the work into milestones, matching `PRD.md` §11. Each milestone must be completed, validated, and committed before moving to the next — per `CLAUDE.md`'s Development Workflow. Do not start a milestone until the previous one is marked ✅ Done.

---

## Milestone 1 — Project Setup

**Goal:**
- Initialize NestJS
- Configure Prisma
- Configure PostgreSQL
- Docker
- Swagger

**Deliverables:**
- Running application
- Database connection
- Health endpoint

**Validation:**
- `npm run build`
- `npm run test`
- Docker starts

**Commit:**
`chore: initialize project`

**Status:**
⬜ Not Started

---

## Milestone 2 — Core Entities

**Goal:**
- Define `Product`, `Location`, and `Inventory` models in Prisma schema and run initial migration.
- Implement create-product, create-location, and add-inventory endpoints.
- Implement basic location-level and product-level inventory query endpoints (raw stock/reserved only — derived `available` logic comes in Milestone 3).

**Files Expected:**
- `prisma/schema.prisma` (Product, Location, Inventory models + relations)
- `src/products/` (module, controller, service, DTOs)
- `src/locations/` (module, controller, service, DTOs)
- `src/inventory/` (module, controller, service, DTOs)

**Validation:**
- `npm run build`
- `npm run test`
- Prisma migration applies cleanly against local Postgres
- Manual/Swagger check: create product → create location → add inventory → query returns expected values

**Commit:**
`feat: add product, location, and inventory models`

**Status:**
⬜ Not Started

---

## Milestone 3 — Availability Logic

**Goal:**
- Implement `available = stock - reserved` as a consistently derived value (not a stored/duplicated field).
- Wire this into the product-availability and location-inventory query endpoints from Milestone 2.

**Files Expected:**
- `src/inventory/inventory.service.ts` (availability derivation logic)
- `src/products/products.service.ts` (aggregate availability across locations)
- Unit tests for availability derivation

**Validation:**
- `npm run build`
- `npm run test`
- New tests confirm `available` always equals `stock - reserved` after seeded data changes

**Commit:**
`feat: implement derived availability calculation`

**Status:**
⬜ Not Started

---

## Milestone 4 — Location Selection Engine

**Goal:**
- Implement the location selection algorithm as an isolated, testable module: service-zone match (lowest priority number wins ties) → fallback chain (same city → same state → any active location).
- No reservation side-effects yet — this milestone only selects a location given product, quantity, and pincode.

**Files Expected:**
- `src/checkouts/location-selection.service.ts` (or equivalent isolated module)
- Unit tests covering PRD.md §5 examples (service-zone hit, insufficient stock at preferred location, city fallback, state fallback, any-active fallback, no-match error)

**Validation:**
- `npm run build`
- `npm run test`
- All location-selection test cases from PRD.md §10 pass

**Commit:**
`feat: implement location selection engine`

**Status:**
⬜ Not Started

---

## Milestone 5 — Checkout Creation + Reservation

**Goal:**
- Implement checkout creation: accepts product, quantity, delivery pincode; runs the Milestone 4 selection engine; reserves stock atomically from the chosen location.
- Introduce the checkout state model (`PENDING_PAYMENT`, `SUCCEEDED`, `FAILED`, `ABANDONED`, `EXPIRED`).

**Files Expected:**
- `prisma/schema.prisma` (Checkout model + relations, migration)
- `src/checkouts/checkouts.module.ts`, `checkouts.controller.ts`, `checkouts.service.ts`
- DTOs for checkout creation

**Validation:**
- `npm run build`
- `npm run test`
- Checkout reserves stock and reduces `available` (PRD.md §10 case)
- Insufficient-stock case returns a clear error and reserves nothing

**Commit:**
`feat: implement checkout creation and inventory reservation`

**Status:**
⬜ Not Started

---

## Milestone 6 — Idempotency Layer

**Goal:**
- Add idempotency key handling to checkout creation: same key + same payload returns the existing checkout; same key + different payload is rejected.
- Ensure the check is race-safe under concurrent identical requests.

**Files Expected:**
- `src/checkouts/checkouts.service.ts` (idempotency handling)
- Idempotency key storage (field(s) on Checkout, or a dedicated table)
- Tests: idempotent retry returns existing checkout; payload mismatch rejected; concurrent identical requests don't double-reserve

**Validation:**
- `npm run build`
- `npm run test`
- Idempotency test cases from PRD.md §10 pass

**Commit:**
`feat: add idempotency handling for checkout creation`

**Status:**
⬜ Not Started

---

## Milestone 7 — Payment Outcome Transitions

**Goal:**
- Implement payment-success, payment-failed, and payment-abandoned endpoints with the exact inventory mutations per `PRD.md` §3.
- Enforce valid state transitions only (e.g. can't mark a `SUCCEEDED` checkout as `FAILED`).

**Files Expected:**
- `src/checkouts/checkouts.service.ts` (transition methods)
- `src/checkouts/checkouts.controller.ts` (new endpoints)
- Tests: success deducts stock and clears reserved; failure releases reserved; abandoned keeps reserved; invalid transitions rejected

**Validation:**
- `npm run build`
- `npm run test`
- Payment transition test cases from PRD.md §10 pass

**Commit:**
`feat: implement payment success, failure, and abandonment transitions`

**Status:**
⬜ Not Started

---

## Milestone 8 — Expiry Handling

**Goal:**
- Implement expiry of `ABANDONED` checkouts once the retry window has elapsed (per the assumed configurable window in `PRD.md` §12), releasing the reservation exactly like a failure.
- Expose an explicit, callable expiry endpoint/trigger.

**Files Expected:**
- `src/checkouts/checkouts.service.ts` (expiry logic)
- `src/checkouts/checkouts.controller.ts` (expiry endpoint)
- Tests: abandoned checkout retains reservation before window elapses; releases reservation after expiry

**Validation:**
- `npm run build`
- `npm run test`
- Expiry test cases from PRD.md §10 pass

**Commit:**
`feat: implement expiry of abandoned checkouts`

**Status:**
⬜ Not Started

---

## Milestone 9 — Concurrency Hardening

**Goal:**
- Add/verify transactional and locking guarantees around reserve, success, failure, and expiry operations.
- Write concurrency tests simulating parallel checkout attempts against limited stock.

**Files Expected:**
- Updates to `src/checkouts/checkouts.service.ts` and `src/inventory/inventory.service.ts` (transaction/locking strategy)
- Concurrency integration tests (parallel requests via `Promise.all` or equivalent)

**Validation:**
- `npm run build`
- `npm run test`
- Concurrent-checkout test case from PRD.md §10 passes consistently (run multiple times to rule out flakiness)

**Commit:**
`fix: harden concurrency guarantees for inventory reservation`

**Status:**
⬜ Not Started

---

## Milestone 10 — Test Suite Completion

**Goal:**
- Fill any remaining gaps against the full testing checklist in `PRD.md` §10.
- Ensure meaningful coverage, not just happy-path tests.

**Files Expected:**
- Additional/updated test files across `src/**/*.spec.ts` and any integration test directory
- Test coverage summary (can be noted in README or PR description)

**Validation:**
- `npm run build`
- `npm run test`
- `npm run lint`
- Every item in `PRD.md` §10 checklist is covered by at least one passing test

**Commit:**
`test: complete required test coverage`

**Status:**
⬜ Not Started

---

## Milestone 11 — Dockerization & Deployment

**Goal:**
- Finalize Dockerfile / docker-compose for the full stack (app + Postgres).
- Deploy to a free hosting service (e.g. Render) and verify the live URL works end-to-end.

**Files Expected:**
- `Dockerfile`, `docker-compose.yml` (finalized)
- Deployment configuration (e.g. `render.yaml` or dashboard-based config, documented in README)

**Validation:**
- `docker compose up` builds and runs the full stack locally
- Hosted URL responds correctly to health check and core endpoints

**Commit:**
`chore: finalize dockerization and deployment configuration`

**Status:**
⬜ Not Started

---

## Milestone 12 — README & Bonus Frontend (optional)

**Goal:**
- Write the final `README.md`: setup, running, testing instructions, and reasoning behind key decisions (data model, concurrency approach, location-selection logic, trade-offs, assumptions).
- Optionally build the simple frontend playground described in the assignment's bonus section.

**Files Expected:**
- `README.md` (finalized)
- (Optional) `frontend/` or `public/` — simple HTML/JS playground

**Validation:**
- README setup steps work on a fresh clone, first try
- All required links (repo, hosted URL) present and correct
- (If built) Frontend playground exercises create/checkout/payment-outcome/expire/availability flows against the live API

**Commit:**
`docs: finalize README and add bonus frontend playground`

**Status:**
⬜ Not Started
