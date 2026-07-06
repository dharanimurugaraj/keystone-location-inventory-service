# PRD — Location-Based Inventory Reservation Service

## 1. Project Overview

### Problem Statement
A product can be stocked across multiple warehouse locations. During checkout, the system must reserve stock from exactly one suitable location before payment completes. Payment can later resolve as successful, failed, or user-dropped/abandoned. Across every one of these outcomes — including retries, expiries, and concurrent requests — inventory numbers (stock, reserved, available) must never drift out of sync.

### Goal
Build a NestJS backend service that:
- Manages products, locations, and per-location inventory.
- Runs a checkout lifecycle that reserves stock from a single location, then resolves via payment success, failure, or abandonment (with expiry).
- Guarantees inventory correctness under concurrent access and duplicate/idempotent requests.
- Implements a deterministic, spec-exact location selection algorithm.

### Success Criteria
- Inventory invariants (`available = stock - reserved`) hold at all times, across all state transitions.
- No overselling or over-reservation under concurrent checkouts.
- Idempotency keys prevent duplicate reservations; payload mismatches on reused keys are rejected.
- Location selection follows the exact preference order specified (service zone → fallback chain).
- All required automated test cases pass.
- Service is Dockerized, documented (Swagger + README), and deployable.

---

## 2. Functional Requirements

The service must support the following operations:

1. **Create Product** — register a new sellable product.
2. **Create Location** — register a new warehouse/fulfillment location (with city, state, pincode service zones, priority, active flag).
3. **Add Inventory** — add stock for a product at a specific location.
4. **Start Checkout** — begin a checkout for a given product, quantity, and delivery pincode.
5. **Reserve Inventory** — as part of checkout creation, select one qualifying location and reserve the requested quantity from it.
6. **Mark Payment Successful** — convert a checkout's reservation into a sale.
7. **Mark Payment Failed** — release a checkout's reservation immediately.
8. **Mark Payment User-Dropped / Abandoned** — mark checkout abandoned; reservation is held pending expiry.
9. **Expire Abandoned Checkouts** — after a retry window elapses, release reservations for abandoned checkouts (via a job or explicit trigger endpoint).
10. **Query Product Availability** — return total/available stock for a product across all locations (and optionally per location).
11. **Query Location-Level Inventory** — return stock, reserved, and available quantities for a product at a specific location, or all products at a location.

---

## 3. Business Rules

### Core Invariant
```
available = stock − reserved
```
This must hold true for every product-location inventory record, at all times, regardless of concurrent operations.

### Reservation (Checkout Creation)
- A checkout **must** reserve stock from a location before payment can be attempted.
- Reservation increases `reserved` and decreases `available` for the chosen location — `stock` is untouched at this point.
- Reservation happens atomically with location selection; no partial reservations, no splitting across locations.

### Payment Success
- Converts the reservation into a completed sale.
- `stock` is decremented by the reserved quantity.
- `reserved` is cleared (decremented by the same quantity) for that checkout.
- Net effect: `stock` and `available` both drop by the reserved quantity; `reserved` returns to its pre-checkout baseline for this checkout's contribution.

### Payment Failure
- The reservation is released immediately.
- `reserved` is decremented back; `stock` is untouched.
- `available` returns to its pre-checkout value.
- The checkout is terminal — no further transitions.

### Abandoned Checkout (User-Dropped)
- The reservation is **kept** — stock stays reserved — until the retry window expires.
- This allows the user to retry/resume payment on the same checkout without losing their reserved stock.
- The checkout is not yet terminal; it can still transition to success (retry) or expire.

### Expiry
- Once the retry window has elapsed for an abandoned checkout, the reservation must be released (same effect as a failure).
- Expiry only applies to checkouts currently in the abandoned/user-dropped state.
- Expiry can be triggered by a scheduled sweep or an explicit endpoint call — the assignment requires the capability to expire abandoned checkouts after the window; the exact trigger mechanism is an implementation choice, but must be testable on demand.

### Availability
- Availability is always derived, never stored redundantly in a way that can drift: `available = stock - reserved`.
- Product-level availability aggregates `available` across all locations carrying that product.
- Location-level inventory reports `stock`, `reserved`, and `available` per product per location.

---

## 4. Checkout Lifecycle

```
Create Checkout (product, quantity, pincode, idempotency key)
        ↓
Reserve Inventory (select one location, reserve quantity)
        ↓
   ┌────────────┬─────────────┬───────────────────┐
   ↓            ↓             ↓
Payment      Payment       Payment
Success      Failed        Abandoned (User-Dropped)
   ↓            ↓             ↓
stock -= qty  reserved      reserved stays held
reserved      released      (checkout stays retryable)
cleared       (terminal)         ↓
(terminal)                  Retry window elapses?
                                  ↓ yes
                             Expire → reserved released
                             (terminal)
                                  ↓ no (still within window)
                             Can still resolve to Success or Failed
        ↓
Availability Updates (always reflect current stock/reserved state)
```

Checkout states: `PENDING_PAYMENT` (just reserved) → `SUCCEEDED` | `FAILED` | `ABANDONED` → (if `ABANDONED`) `EXPIRED`.

Only `PENDING_PAYMENT` and `ABANDONED` are non-terminal. `SUCCEEDED`, `FAILED`, and `EXPIRED` are terminal — no further transitions allowed once reached.

---

## 5. Location Selection Logic

When a checkout is created, exactly one location is chosen to fulfill the full requested quantity. No splitting across locations. Selection order:

**Step 1 — Service Zone Match**
Consider only active locations whose service zone covers the delivery pincode **and** that have enough available stock to fulfill the full quantity.
- If multiple qualify, pick the one with the **lowest priority number** (lower number = higher preference).

**Step 2 — Fallback (only if no service-zone location qualifies)**
Consider active locations that can fulfill the full quantity, checked in this exact order, stopping at the first tier that yields a match:
1. Same city as the delivery address.
2. Same state as the delivery address (if no same-city match).
3. Any active location (if no same-state match).

If no location — service zone or fallback — can fulfill the full quantity, checkout creation must fail with a clear "insufficient stock" error; no reservation is made.

### Examples
- **Example A (service zone hit):** Pincode 560001 is served by Location A (priority 1) and Location B (priority 2), both with enough stock. → Location A is chosen (lowest priority number).
- **Example B (service zone, insufficient stock at preferred):** Location A serves the pincode but only has 2 units in stock; the order needs 5. Location A is not eligible. If Location B also serves the pincode and has 5+ units, Location B is chosen.
- **Example C (fallback to city):** No location's service zone covers the pincode. Delivery city is "Pune". Location C is in Pune with enough stock → Location C is chosen, even if a service-zone check was attempted first and failed.
- **Example D (fallback to state):** No city match in Pune. Location D is elsewhere in the same state ("Maharashtra") with enough stock → Location D is chosen.
- **Example E (fallback to any active):** No city or state match. Any active location with enough stock is chosen (if multiple, an implementation-defined deterministic tie-break, e.g. lowest priority number, is acceptable).

---

## 6. Idempotency

- Checkout creation accepts an **idempotency key** supplied by the client.
- **Same key, same payload:** returns the original checkout (already created), without creating a new reservation. Safe to retry on network failures.
- **Same key, different payload:** the request is rejected with a clear error (e.g. 409 Conflict) — the key is already bound to a different request body and cannot be reused for a different intent.
- **New key:** proceeds as a normal new checkout creation.
- The idempotency check and the reservation must be atomic with respect to each other — a race between two identical requests using the same key must not create two reservations.

---

## 7. Concurrency Requirements

- **No overselling:** the sum of all `sold` (via successful payments) plus currently `reserved` quantities for a location must never exceed that location's `stock`.
- **No over-reservation:** two concurrent checkout requests targeting the same location must not both succeed in reserving more than the location's current `available` quantity.
- **Transaction safety:** every operation that reads and then mutates inventory (reserve, success, failure, expiry) must happen inside a single atomic transaction, using a locking or optimistic-concurrency strategy strong enough to prevent lost updates under parallel requests.
- **Idempotency + concurrency:** two simultaneous requests with the same idempotency key must not both create separate reservations — one must win, and the other must observe/return the winner's result.
- Practical requirement only — no need to explain database internals in depth, just ensure the chosen approach (e.g. row-level locking, `SELECT ... FOR UPDATE`, or a serializable transaction, or an atomic conditional update) demonstrably prevents the race conditions above.

---

## 8. API List

| Method | Endpoint (suggested) | Description |
|---|---|---|
| POST | `/products` | Create a new product |
| POST | `/locations` | Create a new location |
| POST | `/inventory` | Add inventory for a product at a location |
| POST | `/checkouts` | Start a checkout (reserves inventory from a selected location) |
| POST | `/checkouts/:id/payment-success` | Mark checkout payment successful |
| POST | `/checkouts/:id/payment-failed` | Mark checkout payment failed |
| POST | `/checkouts/:id/payment-abandoned` | Mark checkout payment user-dropped/abandoned |
| POST | `/checkouts/expire` | Trigger expiry sweep for abandoned checkouts past the retry window |
| GET | `/products/:id/availability` | Query product-level availability |
| GET | `/locations/:id/inventory` | Query location-level inventory |

Exact route names/verbs are implementation choices; behavior must match the operations above.

---

## 9. Data Model

Entities and relationships only — no schema/DDL.

- **Product**
  - Represents a sellable item.
  - Has many `Inventory` records (one per location it's stocked at).

- **Location**
  - Represents a warehouse/fulfillment center.
  - Attributes needed for selection logic: active flag, priority number, city, state, and the set of pincodes it serves (service zone).
  - Has many `Inventory` records (one per product stocked there).

- **Inventory**
  - Join entity between `Product` and `Location`.
  - Tracks `stock` and `reserved` for that product at that location (`available` is derived).

- **Checkout**
  - Belongs to one `Product`, references the delivery pincode/city/state, and requested quantity.
  - Once reserved, references exactly one `Location` (the one it reserved from) and the reserved quantity.
  - Tracks its own lifecycle state (pending payment / succeeded / failed / abandoned / expired).
  - Stores the idempotency key and enough of the original request payload to detect payload mismatches on reuse.

**Relationships:**
`Product 1 — N Inventory N — 1 Location`, and `Checkout N — 1 Product`, `Checkout N — 1 Location` (once reserved).

---

## 10. Testing Checklist

- [ ] Checkout reserves stock and reduces available stock.
- [ ] Payment success deducts stock and clears reserved stock.
- [ ] Payment failure releases reserved stock.
- [ ] User-dropped payment keeps stock reserved before expiry.
- [ ] Expired user-dropped payment releases reserved stock.
- [ ] Location selection prefers matching pincode/service zone (lowest priority number wins ties).
- [ ] Fallback selection works when no service-zone location has stock (city → state → any active, in order).
- [ ] Idempotent checkout retry (same key, same payload) returns the existing checkout without reserving twice.
- [ ] Same idempotency key with a changed payload is rejected.
- [ ] Concurrent checkouts cannot reserve more than available stock.
- [ ] Product availability query reflects real-time stock/reserved state.
- [ ] Location-level inventory query returns correct stock/reserved/available.

---

## 11. Milestones

Suggested phased breakdown, each phase a logical set of commits:

1. **Project Scaffolding** — NestJS project setup, TypeScript strict config, Docker skeleton, Swagger wiring, base module structure.
2. **Core Entities** — Product, Location, Inventory models/persistence; create-product, create-location, add-inventory endpoints; location & inventory query endpoints (basic, no derived availability logic yet).
3. **Availability Logic** — Implement `available = stock - reserved` derivation consistently across product and location queries.
4. **Location Selection Engine** — Implement service-zone matching + fallback chain (city → state → any active) as an isolated, testable module.
5. **Checkout Creation + Reservation** — Start-checkout endpoint that runs location selection and reserves stock atomically; introduce checkout state model.
6. **Idempotency Layer** — Idempotency key storage, duplicate-key detection, payload-mismatch rejection, integrated into checkout creation.
7. **Payment Outcome Transitions** — Payment-success, payment-failed, payment-abandoned endpoints with correct inventory mutations per business rules.
8. **Expiry Handling** — Expire endpoint/job for abandoned checkouts past the retry window.
9. **Concurrency Hardening** — Add transactional/locking guarantees around reserve, success, failure, expiry; write concurrency tests (parallel checkout attempts).
10. **Test Suite Completion** — Fill out the full testing checklist above with unit + integration tests.
11. **Dockerization & Deployment** — Finalize Dockerfile/compose, deploy to a free host, verify hosted URL.
12. **README & Bonus Frontend (optional)** — Write up decisions/trade-offs; optionally build the simple frontend playground.

---

## 12. Assumptions

The assignment leaves the following genuinely unspecified; these are the working assumptions for implementation:

- **Retry window duration:** Not specified by the assignment — assumed to be a configurable value (e.g. env variable), defaulting to a short window (e.g. 15 minutes) for an abandoned checkout before it becomes eligible for expiry.
- **Authentication/authorization:** Out of scope. No user accounts, auth tokens, or role-based access are required; all endpoints are assumed to be open/internal for this assignment's purposes.
- **Single-item checkout per request:** Each checkout is for exactly one product and one quantity, as described in the assignment ("Start checkout for a product and quantity"). Multi-item/cart-style checkouts are not in scope.
- **No partial reservations across locations:** Confirmed explicitly by the assignment — a checkout reserves from a single location only; this is a hard rule, not an assumption, and is restated here for clarity.
- **Timezone handling:** All timestamps (checkout creation, expiry calculations) are assumed to be stored and compared in UTC, regardless of the delivery pincode's local timezone.
- **Expiry trigger mechanism:** The assignment requires the *capability* to expire abandoned checkouts after the retry window, but not a specific trigger. Assumed to be exposed as an explicit, callable endpoint (testable on demand) rather than a mandatory background cron job, though a scheduled job may be added as a complement.
- **Tie-breaking in "any active location" fallback:** When multiple locations qualify at the final fallback tier with no further distinguishing criteria given, assumed to break ties by lowest priority number (consistent with the service-zone tie-break rule).
- **Idempotency key scope:** Assumed to be scoped per checkout-creation request only (not reused across other endpoints), and assumed to be a client-supplied string (e.g. header or body field) rather than server-generated.
- **Currency/pricing:** Out of scope — the assignment concerns inventory and reservation state, not pricing, payment amounts, or currency handling.
- **Soft delete / archival of products or locations:** Not addressed by the assignment; assumed unnecessary for this scope. An "active" flag on locations is sufficient to exclude them from selection without full deletion semantics.
