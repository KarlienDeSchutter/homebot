# Homebot — Architecture

> Personal home management platform. Four planned apps sharing a common stack, built one at a time.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser / PWA                        │
│   Vite + React + TypeScript + TanStack + Tailwind + shadcn  │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP (OData-inspired JSON API)
┌─────────────────────────▼───────────────────────────────────┐
│                      FastAPI backend                        │
│   /api/grocery/…   /api/meal/…   /api/finance/…             │
│   SQLAlchemy (async) + APScheduler + odata-query            │
└──────┬──────────────────┬──────────────────────────────────┘
       │                  │
┌──────▼──────┐    ┌──────▼──────────────────────────────────┐
│   SQLite    │    │         Automation layer                 │
│ (dev/local) │    │   Playwright workers (one per store)     │
│  Postgres   │    │   CatalogSyncWorker  CartFillService     │
│  (staging/  │    └──────────────────────────────────────────┘
│   prod)     │
└─────────────┘
```

### Four planned apps

| App | Status | Core automation |
|---|---|---|
| **Grocery** | Building now | Colruyt Collect & Go cart fill |
| **Meal planner** | Planned | AI recipe discovery; generates grocery lists |
| **Finance** | Planned | Budgeting; stock tracking |
| **Home projects** | Planned | Renovation / maintenance planning |

Each app gets its own:
- FastAPI router (`/api/grocery/`, `/api/meal/`, …)
- SQLAlchemy models in a dedicated module
- Frontend pages under a shared React app

---

## 2. Layers

### 2.1 Frontend (PWA)

Single Vite + React PWA, served from `apps/web/`.

```
apps/web/
  src/
    routes/          TanStack Router file-based routes
      grocery/       Grocery-specific pages
      meal/
      finance/
      settings/
    components/      Shared UI components (shadcn wrappers)
    hooks/           Shared TanStack Query hooks
    lib/
      api.ts         Typed fetch wrapper (adds $filter etc.)
```

- TanStack Router for type-safe navigation.
- TanStack Query for server state; cache keys encode OData params.
- Tailwind + shadcn/ui for consistent, accessible UI.
- Service worker (via `vite-plugin-pwa`) for offline read access.

### 2.2 Backend (FastAPI)

Monorepo backend in `backend/`, one Python package.

```
backend/
  app/
    main.py            FastAPI app + router mounts
    db.py              SQLAlchemy async engine + session
    grocery/
      router.py        /api/grocery endpoints
      models.py        SQLAlchemy models
      schemas.py       Pydantic request/response models
      services/
        list_service.py
        catalog_service.py
        ai_match_service.py
        cart_fill_service.py
    meal/              (future)
    finance/           (future)
    workers/
      catalog_sync.py  APScheduler nightly job
    jobs.py            Generic job queue (DB-backed)
```

**API conventions (shared across all apps):**
- OData-inspired: `$filter`, `$top`, `$skip`, `$orderby`, `$count`, `$select`.
- Collection responses: `{ "value": [...], "@odata.count": N }`.
- Resource names: singular (`/list`, `/item`, `/colruyt_product`).
- Errors: `{ "error": { "code": "...", "message": "..." } }`.

### 2.3 Automation Layer

Playwright workers run as async background tasks within the FastAPI process (via APScheduler + asyncio). For production they can be extracted to separate worker processes.

```
CatalogSyncWorker    Scrapes Colruyt product pages nightly
                     → upserts colruyt_product table

CartFillService      Driven by user request (POST /list/{id}/fill-cart)
                     → logs in to Colruyt Collect & Go
                     → adds items to cart
                     → writes job result
```

Both workers share the same SQLAlchemy session factory and report status via the `job` table.

### 2.4 Database

| Environment | DB | Notes |
|---|---|---|
| Local dev | SQLite (WAL mode) | Zero-config, single file |
| Staging / prod | Postgres | FTS, concurrent writes, migrations via Alembic |

Schema migrations managed by **Alembic**. Models defined once in SQLAlchemy; no raw SQL except for FTS index creation.

---

## 3. Shared Patterns

### Job system
All async operations (cart fill, catalog sync, AI matching) create a `job` row and run in the background. The frontend polls `GET /job/{id}` every 2 s for progress. This keeps all APIs fast and makes retries trivial.

### OData-inspired filtering
`odata-query` (PyPI) parses `$filter`/`$orderby`/`$top`/`$skip` query strings and transpiles them to SQLAlchemy expressions. All list endpoints accept these params.

### AI calls
Claude (haiku) is called only as a fallback. Prompts request strict JSON output. Results are always shown to the user for confirmation — never applied silently.

### Playwright stealth
All browser automation uses `playwright-stealth` and human-like timing. Sessions are persisted via cookie files to avoid repeated logins.

---

## 4. Why Grocery First

1. **Self-contained automation target.** One store (Colruyt), one flow (add to cart), clear success criteria.
2. **Validates the automation architecture.** Playwright + job system + nightly sync — if this works, all other automation apps can follow the same pattern.
3. **No upstream dependency.** Grocery doesn't depend on Meal planner; it can stand alone from day one.
4. **Immediate personal value.** Weekly grocery shopping is the highest-frequency chore.

### How other apps integrate later

- **Meal planner** will `POST /grocery/list` with items derived from a weekly meal plan. Grocery app is a pure consumer of that list — no changes needed.
- **Finance** shares only auth and the shared FastAPI app structure; no data dependencies on Grocery.
- **Home projects** is fully independent.

---

## 5. Development Setup

```
homebot/
  apps/
    web/             Vite + React PWA  (bun)
  backend/           FastAPI            (uv / pip)
  SPEC.md            Grocery app spec
  ARCHITECTURE.md    This file
  README.md
```

```bash
# Frontend
cd apps/web && bun install && bun dev

# Backend
cd backend && uv sync && uvicorn app.main:app --reload

# Run Playwright tests (automation)
cd backend && playwright install chromium
```

---

## 6. Non-Goals (Platform Level)

- No multi-user / auth (personal tool; single user assumed).
- No mobile-native app — PWA is sufficient.
- No microservices — monolith until there's a real reason to split.
- No real-time push — polling is good enough for job status.
