# CLAUDE.md — Implementation Agent Guide

This file governs how the AI coding agent should build this project. Refer to `PRD.md` for full functional/business requirements. This file is about *how* to build, not *what* to build.

## Mission
Implement a correct, well-tested NestJS backend for location-based inventory reservation, where inventory invariants hold under concurrency, checkout state transitions are exact, location selection follows the specified preference order, and idempotency is enforced — all as defined in `PRD.md`.

## Tech Stack
- NestJS
- TypeScript (strict mode)
- PostgreSQL
- Prisma
- Jest
- Docker
- Swagger (OpenAPI docs)

## Engineering Rules
- Follow SOLID principles.
- Use Dependency Injection throughout (NestJS providers, no manual instantiation).
- Strict TypeScript: `strict: true`, no implicit `any`.
- **No `any`** anywhere in source code.
- No duplicated logic — extract shared behavior into services/utilities.
- Keep services small and single-purpose; split when a service accumulates unrelated responsibilities.
- All incoming request bodies validated via DTOs (`class-validator` / `class-transformer`).
- Centralized error handling via a global exception filter — no ad-hoc try/catch scattered across controllers for the same error shapes.

## Inventory Rules
Never violate:
```
available = stock - reserved
```
- Reservation must happen before payment can be marked successful.
- Payment success converts `reserved → sold`: decrement `stock` and `reserved` by the reserved quantity.
- Payment failure releases the reservation: decrement `reserved`, leave `stock` untouched.
- Abandoned (user-dropped) checkouts hold the reservation until expiry — do not release early.
- Expiry of an abandoned checkout releases the reservation exactly like a failure.

## Concurrency Rules
- Always wrap read-then-write inventory operations (reserve, success, failure, expiry) in a database transaction.
- Prevent overselling: never let `sold + reserved` exceed `stock` for a location.
- Prevent duplicate reservations from concurrent identical requests (see idempotency rules below).
- Never mutate inventory fields (`stock`, `reserved`) outside of a transaction — no exceptions, even for "simple" updates.
- Use row-level locking or an equivalent atomic conditional update (e.g. `SELECT ... FOR UPDATE`, or a single conditional `UPDATE ... WHERE available >= qty`) to guard the reservation step against races.

## Idempotency Rules
- Reuse the existing checkout when the same idempotency key is sent with the same payload — do not reserve again.
- Reject the request (clear 409-style error) when the same idempotency key is sent with a different payload.
- The idempotency check must itself be race-safe: two identical concurrent requests with the same key must not both create reservations.

## Coding Standards
- Clean architecture: clear separation between controllers, services, and persistence.
- Organize by feature modules (e.g. `products`, `locations`, `inventory`, `checkouts`), not by technical layer.
- Repository pattern: **not required** for this project. Prisma's client already acts as a sufficiently clean data-access abstraction for this scope; adding a repository layer on top would be extra indirection with no real benefit at this size. Keep Prisma calls inside services (or a thin data-access module per feature if a service grows large) rather than introducing a separate repository layer.
- Meaningful, intention-revealing naming — no `data`, `temp`, `handleStuff`, etc.
- No `TODO` placeholders or stubbed logic left in committed code — every commit should be functionally complete for its milestone.
- Production-quality code only: proper typing, error handling, and input validation on every endpoint.

## Testing Rules
- Every feature/milestone must ship with corresponding tests before moving to the next milestone.
- Cover the full testing checklist in `PRD.md` §10, including concurrency and idempotency edge cases — not just happy paths.
- Prefer integration tests that exercise the real transaction/locking logic (not mocked-out inventory math) for concurrency-sensitive behavior.

## Development Workflow
Work one milestone (from `PRD.md` §11) at a time. For every milestone:
1. Understand the requirements.
2. Briefly explain the implementation approach before writing code.
3. Implement only that milestone.
4. Ensure the project builds successfully.
5. Run tests.
6. Refactor if necessary.
7. Stop and wait for the next prompt.

Never implement future milestones automatically.

## Definition of Done (per milestone)
A milestone is complete only if:
- [ ] Project builds successfully.
- [ ] Existing tests pass.
- [ ] New tests are added where applicable.
- [ ] Swagger documentation is updated.
- [ ] DTO validation is complete.
- [ ] Error handling is implemented.
- [ ] No TODOs or placeholder code remain.

## AI Behaviour
The AI must never:
- Invent business rules.
- Change assignment requirements.
- Modify unrelated modules.
- Generate placeholder implementations.
- Skip validation or tests.
- Continue into future milestones without being asked.

If any requirement is ambiguous, explain the assumption instead of silently choosing one.

## Code Quality Gates
Before completing any milestone, ensure:
- `npm run build` passes
- `npm run lint` passes
- `npm run test` passes

Fix any failures before considering the milestone complete.

## Refactoring Rules
If duplicated business logic appears:
- Refactor before continuing.
- Keep services focused and reasonably sized.
- Extract reusable utilities instead of copying logic.

## Prompt Discipline
- Only generate code for the milestone requested.
- Do not anticipate future milestones.
- Do not modify unrelated files unless required.
- Minimize unnecessary code changes.

## Testing Philosophy
- Every new feature should include tests.
- Prefer integration tests over mocked implementations when validating inventory consistency, transactions, idempotency, and concurrency.
- Never skip concurrency-related tests.

## Git Workflow
- Implement one milestone (from `PRD.md` §11) at a time.
- Run the full test suite before moving to the next milestone — do not proceed on a red suite.
- Use conventional commits (e.g. `feat:`, `fix:`, `test:`, `docs:`, `chore:`), scoped to the milestone being completed.

## Git Support
At the end of every completed milestone, provide:
- Suggested conventional commit message.
- Summary of files created/modified.
- Database migration summary (if any).
- Test summary.

## Done Criteria
The project is complete only when:
- [ ] All functional requirements in `PRD.md` are satisfied.
- [ ] All required tests (per the testing checklist) pass.
- [ ] The application builds and runs via Docker.
- [ ] Swagger/OpenAPI documentation is available and accurate.
- [ ] `README.md` clearly explains setup, testing, and key design decisions (data model, concurrency approach, location-selection logic, trade-offs).
- [ ] The service is deployed and reachable via a live hosted URL.
