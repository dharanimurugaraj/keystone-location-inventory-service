# Keystone Location Inventory Service

A backend REST API that manages product inventory across multiple warehouse locations, implements a warehouse selection algorithm, and handles a full checkout lifecycle with atomic stock reservation and payment callbacks.

---

## Features

- **Product & location management** — CRUD for products (unique SKU) and warehouse locations (city, state, pincode service zones, priority).
- **Per-location inventory** — Track `stock` and `reserved` counts independently; `available = stock − reserved` is always derived, never stored.
- **Warehouse selection** — Two-step algorithm selects the best fulfillment location for a delivery address.
- **Atomic checkout creation** — Warehouse selection, stock reservation, and checkout record creation execute in a single Prisma transaction with a conditional `updateMany` guard to prevent oversells.
- **Payment callbacks** — `POST /checkouts/:id/payment-success` and `POST /checkouts/:id/payment-failed` update inventory and reservation state atomically within a transaction.
- **Idempotent callbacks** — Repeated success or failure callbacks on an already-settled checkout return 200 OK without mutating state.
- **Standalone reservations** — A separate `/reservations` resource exposes the same stock-guard mechanism for clients that need to manage reservations independently.
- **Swagger UI** — Full OpenAPI documentation auto-generated at `/api-docs`.
- **Health endpoint** — `/health` exposes service and database liveness via `@nestjs/terminus`.
- **Unit tests** — Jest unit tests for all service layers (products, locations, inventory, reservations, checkouts, location-selection).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript 5 |
| Framework | NestJS 10 |
| ORM | Prisma 5 |
| Database | PostgreSQL 16 |
| Containerisation | Docker + Docker Compose |
| API Docs | Swagger / OpenAPI 3 (`@nestjs/swagger`) |
| Testing | Jest + `@nestjs/testing` |

---

## Architecture

```
HTTP Client
     |
     v
+-------------------------------------------------------------+
|                        NestJS App                           |
|                                                             |
|  +----------+  +----------+  +-----------+  +----------+   |
|  | Products |  |Locations |  | Inventory |  |  Health  |   |
|  | Module   |  | Module   |  |  Module   |  |  Module  |   |
|  +----------+  +----------+  +-----------+  +----------+   |
|                                                             |
|  +-------------------------+  +---------------------------+ |
|  |   Reservations Module   |  |     Checkouts Module      | |
|  |   ReservationsService   |  |  CheckoutsService         | |
|  |   (standalone reserve / |  |  LocationSelectionService | |
|  |    release / complete)  |  |  (warehouse algorithm)    | |
|  +-------------------------+  +---------------------------+ |
|                        |                                    |
|                  PrismaService                              |
+------------------------+------------------------------------+
                         |
                         v
                   PostgreSQL 16
```

### Modules

| Module | Responsibility |
|---|---|
| **Products** | Create and query products; compute cross-location availability summary. |
| **Locations** | Create and query warehouse locations (city, state, pincodes, priority). |
| **Inventory** | Seed and query per-location stock records (`stock`, `reserved`). |
| **Reservations** | Standalone reservation lifecycle: create (with stock guard), release, complete. |
| **Checkouts** | Orchestrates warehouse selection → atomic reservation → checkout creation → payment callbacks. |
| **Location Selection** | Stateless, read-only service implementing the two-step warehouse selection algorithm. |

---

## Database Design

```
Product --< Inventory >-- Location
              |
              +--< Reservation --< Checkout
```

| Model | Key Fields | Notes |
|---|---|---|
| **Product** | `id` (UUID), `name`, `sku` (unique), `description` | SKU enforced unique at DB level. |
| **Location** | `id`, `name`, `city`, `state`, `pincodes[]`, `priority`, `isActive` | `pincodes` is a PostgreSQL text array. `priority` is a positive integer — lower wins. Indexed on `city`, `state`, `isActive`, `priority`. |
| **Inventory** | `id`, `productId`, `locationId`, `stock`, `reserved` | Unique on `(productId, locationId)`. `available` is never stored; always computed as `stock - reserved`. |
| **Reservation** | `id`, `inventoryId`, `quantity`, `status`, `expiresAt`, `completedAt`, `releasedAt` | Status enum: `ACTIVE -> COMPLETED | RELEASED | EXPIRED`. Terminal states are immutable. |
| **Checkout** | `id`, `productId`, `locationId`, `reservationId` (unique FK), `quantity`, `status`, `deliveryPincode/City/State` | Status enum: `PENDING_PAYMENT -> SUCCEEDED | FAILED | ABANDONED | EXPIRED`. |

---

## Inventory Lifecycle

### Available Stock Formula

```
available = stock - reserved
```

`stock` represents physical units at a location. `reserved` represents units held by active reservations. Neither field is updated until a payment is settled.

### Reservation Flow

```
POST /checkouts  (or POST /reservations)
        |
        +-- SELECT inventory WHERE active + sufficient stock
        |
        +-- TRANSACTION:
               updateMany inventory
               WHERE stock >= reserved + quantity   <- stock guard
               SET reserved += quantity
               -----------------------------------------
               INSERT reservation (status=ACTIVE)
               INSERT checkout (status=PENDING_PAYMENT)
```

If `updateMany` returns `count = 0`, another concurrent request consumed the stock between the read and the write. The transaction is aborted; the client receives an error and should retry.

### Payment Success

```
POST /checkouts/:id/payment-success
        |
        +-- TRANSACTION:
               stock    -= quantity   (units permanently sold)
               reserved -= quantity
               reservation.status = COMPLETED
               checkout.status    = SUCCEEDED
```

### Payment Failure

```
POST /checkouts/:id/payment-failed
        |
        +-- TRANSACTION:
               reserved -= quantity   (stock restored to available pool)
               reservation.status = RELEASED
               checkout.status    = FAILED
```

---

## Warehouse Selection Algorithm

`LocationSelectionService.selectLocation()` implements a two-step selection with a consistent priority tie-break at every tier.

**Pre-filter:** Load all active inventory rows for the product. Keep only rows where `stock - reserved >= quantity`. If none exist, return 422.

**Step 1 — Service Zone Match**
Select candidates whose `location.pincodes` array contains the exact delivery pincode.

**Step 2 — Fallback chain** (evaluated only if Step 1 yields no match, stops at first hit)
1. Same `city` as delivery address.
2. Same `state` as delivery address.
3. Any remaining active location with sufficient stock.

**Tie-break at every tier:** lowest `priority` number wins.

---

## Concurrency Strategy

### `updateMany` Stock Guard

Stock reservation uses a conditional `updateMany` rather than a read-then-write pattern:

```ts
await tx.inventory.updateMany({
  where: {
    id: inventoryId,
    stock: { gte: inventory.reserved + quantity },  // available >= quantity
  },
  data: { reserved: { increment: quantity } },
});
```

This translates to a single atomic `UPDATE ... WHERE` in PostgreSQL. If two concurrent requests target the same inventory row, only one will satisfy the predicate; the other receives `count = 0` and is rejected — preventing an oversell without requiring application-level locking.

### Prisma Transactions

All multi-step mutations (reserve + create reservation + create checkout; payment callbacks) execute inside `prisma.$transaction()`. If any step fails, PostgreSQL rolls back the entire operation.

### Oversell Prevention Summary

| Mechanism | Role |
|---|---|
| `updateMany` predicate | Atomic guard — single SQL statement |
| `prisma.$transaction` | Atomicity across multiple writes |
| Terminal state checks | Idempotency guards prevent double-processing |

---

## Idempotency Strategy

Payment callbacks check the current status before applying any mutation:

- If the checkout is **already in the target state** (e.g., `SUCCEEDED` when calling `payment-success`), the handler returns the existing record with 200 OK — no writes occur.
- If the checkout is **in an incompatible terminal state** (e.g., `FAILED` when calling `payment-success`), the handler returns 409 Conflict.

This protects against duplicate webhook delivery from payment providers.

---

## API Endpoints

### Products

| Method | Path | Description |
|---|---|---|
| `POST` | `/products` | Create a product |
| `GET` | `/products` | List all products |
| `GET` | `/products/:id` | Get product by ID |
| `GET` | `/products/:id/availability` | Availability summary across all locations |

### Locations

| Method | Path | Description |
|---|---|---|
| `POST` | `/locations` | Create a location |
| `GET` | `/locations` | List all locations |
| `GET` | `/locations/:id` | Get location by ID |

### Inventory

| Method | Path | Description |
|---|---|---|
| `POST` | `/inventory` | Add or update inventory for a product at a location |
| `GET` | `/inventory` | List all inventory records |
| `GET` | `/inventory/product/:productId` | Inventory by product |
| `GET` | `/inventory/location/:locationId` | Inventory by location |

### Reservations

| Method | Path | Description |
|---|---|---|
| `POST` | `/reservations` | Create a reservation (atomic stock guard) |
| `GET` | `/reservations/:id` | Get reservation by ID |
| `POST` | `/reservations/:id/release` | Release an active reservation |
| `POST` | `/reservations/:id/complete` | Complete an active reservation |

### Checkouts

| Method | Path | Description | Status |
|---|---|---|---|
| `POST` | `/checkouts` | Start checkout (select warehouse + reserve) | 201 |
| `GET` | `/checkouts/:id` | Get checkout by ID | 200 |
| `POST` | `/checkouts/:id/payment-success` | Mark payment successful (idempotent) | 200 |
| `POST` | `/checkouts/:id/payment-failed` | Mark payment failed (idempotent) | 200 |

### Utility

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service and database liveness |
| `GET` | `/api-docs` | Swagger UI |

---

## Local Development

### Option A — Docker (recommended)

```bash
# Copy environment file
cp .env.example .env

# Start PostgreSQL and the app (migrations run automatically on startup)
docker compose up --build

# API:     http://localhost:3000
# Swagger: http://localhost:3000/api-docs
# Health:  http://localhost:3000/health
```

### Option B — npm (requires a running PostgreSQL instance)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit DATABASE_URL in .env to point to your PostgreSQL instance

# 3. Run migrations
npx prisma migrate dev

# 4. Start in watch mode
npm run start:dev
```

### Migrations

```bash
# Apply pending migrations
npx prisma migrate dev

# Open Prisma Studio (visual DB browser)
npm run prisma:studio
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | Environment name |

---

## Testing

```bash
# Run all unit tests
npm test

# Run with coverage report
npm run test:cov

# Run in watch mode
npm run test:watch

# Run e2e tests
npm run test:e2e
```

Unit test coverage includes: `ProductsService`, `LocationsService`, `InventoryService`, `ReservationsService`, `CheckoutsService`, and `LocationSelectionService`.

---

## Assumptions

1. **`available` is not stored** — it is always computed as `stock - reserved`. Storing a derived column risks inconsistency under concurrent writes.
2. **Delivery pincode match is exact** — the algorithm compares the pincode string verbatim against the `pincodes[]` array. Prefix or range matching was not specified.
3. **Warehouse selection is read-only** — `LocationSelectionService` only selects; it does not modify state. This keeps selection outside the transaction and makes it independently testable.
4. **Payment callbacks are caller-driven** — there is no internal payment polling or timeout scheduler. The service trusts the caller to deliver the correct event.
5. **Reservation expiry is schema-ready but not enforced** — the `expiresAt` field exists on `Reservation`, but an expiry scheduler is not implemented (see Future Improvements).
6. **Single-location fulfillment** — a checkout is fulfilled entirely from one warehouse. Split-shipment across multiple locations was out of scope.
7. **No authentication** — the assignment did not specify an auth layer; all endpoints are unauthenticated.
8. **`priority` is a positive integer** — lower numbers indicate higher priority. The PRD did not define the allowed range.

---

## Trade-offs

| Decision | Rationale |
|---|---|
| **`updateMany` guard instead of `SELECT FOR UPDATE`** | A conditional `UPDATE ... WHERE` is a single round-trip and avoids explicit row-level locking. `SELECT FOR UPDATE` adds a lock acquisition step and increases contention under high concurrency. |
| **`stock` and `reserved` as separate columns** | Decoupling physical stock from held units allows payment failures to restore availability by decrementing only `reserved`, without touching `stock`. Auditing is also straightforward. |
| **Location selection outside the transaction** | The selection query is read-only. Placing it outside the transaction reduces lock-hold time; the stock guard inside the transaction handles the race. |
| **Standalone `Reservations` resource** | Exposes the stock-guard logic through its own endpoints for clients that manage reservations independently (e.g., a warehouse management system). |
| **Terminal state check for idempotency** | Checking for a terminal state before applying a mutation is simpler and cheaper than a distributed lock. It is sufficient because a checkout cannot simultaneously be in two states in a relational database. |

---

## Future Improvements

- **Reservation expiry scheduler** — A background job (e.g., NestJS `@nestjs/schedule`) that finds `ACTIVE` reservations past their `expiresAt` and transitions them to `EXPIRED`, releasing reserved stock.
- **Distributed locking** — A Redis-based lock (e.g., Redlock) on `inventoryId` would reduce optimistic-retry failures by serialising concurrent requests for the same inventory row under very high load.
- **Redis caching** — Cache product availability reads to reduce database load on the hot path.
- **Event-driven architecture** — Publish domain events (`ReservationCreated`, `CheckoutSucceeded`) to a message broker (Kafka / SQS) to decouple downstream consumers such as notifications, analytics, or ERP sync.
- **Observability** — Structured logging (e.g., `pino`), distributed tracing (OpenTelemetry), and metrics (Prometheus) for production readiness.
- **Authentication & authorisation** — JWT-based auth or API key validation via a NestJS guard.
