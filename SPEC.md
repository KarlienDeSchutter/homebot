# Grocery App — Specification

> First app in Homebot. Automates filling a Colruyt Collect & Go cart from a manually-maintained shopping list.

---

## 1. Scope (v1)

| In scope | Out of scope |
|---|---|
| Manual item entry | Meal-plan-generated lists |
| Colruyt Collect & Go | Other stores |
| Cart fill (Playwright logs in, adds items, user reviews + places order) | Auto-placing order |
| Local catalog mirror scraped nightly | Real-time Colruyt API calls |
| AI-assisted fallback matching | Full AI product discovery |
| Recurring staples management | — |

---

## 2. User Journey

1. User opens the Grocery PWA.
2. User creates a shopping list and adds items (freetext names + optional quantity/unit).
3. The app tries to match each item to a Colruyt product (B: local catalog → C: AI fallback).
4. User reviews matches and confirms or overrides each one.
5. User taps "Fill cart". Playwright opens Colruyt Collect & Go, logs in, and adds all confirmed items.
6. User reviews the cart on the Colruyt site and places the order themselves.

---

## 3. Data Model

```
list
  id            INTEGER PK
  name          TEXT NOT NULL
  created_at    DATETIME
  updated_at    DATETIME

item
  id            INTEGER PK
  list_id       INTEGER FK → list.id
  name          TEXT NOT NULL          -- freetext entered by user
  quantity      REAL
  unit          TEXT                   -- "kg", "stuks", "liter", …
  mapping_id    INTEGER FK → item_mapping.id (nullable)
  is_recurring  BOOLEAN DEFAULT FALSE
  created_at    DATETIME
  updated_at    DATETIME

colruyt_product
  id            INTEGER PK
  colruyt_id    TEXT NOT NULL UNIQUE   -- Colruyt internal product ID
  name          TEXT NOT NULL
  brand         TEXT
  unit_price    REAL
  unit          TEXT
  category      TEXT
  image_url     TEXT
  is_available  BOOLEAN DEFAULT TRUE
  last_seen_at  DATETIME               -- last catalog sync that included this product
  created_at    DATETIME

item_mapping
  id            INTEGER PK
  item_name     TEXT NOT NULL          -- normalized freetext (lowercase, trimmed)
  product_id    INTEGER FK → colruyt_product.id
  match_method  TEXT                   -- "catalog_search" | "ai_match" | "manual"
  confidence    REAL                   -- 0–1, null for manual
  confirmed_by_user  BOOLEAN DEFAULT FALSE
  created_at    DATETIME

catalog_sync_log
  id            INTEGER PK
  started_at    DATETIME
  finished_at   DATETIME
  status        TEXT                   -- "running" | "success" | "failed"
  products_added    INTEGER
  products_updated  INTEGER
  error_message     TEXT

job
  id            INTEGER PK
  type          TEXT                   -- "cart_fill" | "catalog_sync" | "ai_match"
  status        TEXT                   -- "pending" | "running" | "done" | "failed"
  payload       JSON                   -- input params
  result        JSON                   -- output / error details
  created_at    DATETIME
  updated_at    DATETIME
```

---

## 4. Hybrid Matching Architecture

Two-stage matching pipeline runs when an item has no confirmed mapping:

```
item name (freetext)
       │
       ▼
┌──────────────────────────────────┐
│  Stage B — Catalog search        │
│  (local SQLite full-text search  │
│   on colruyt_product.name)       │
└──────────────────────────────────┘
       │              │
  match found?       no
       │              │
       ▼              ▼
  return top 5   ┌──────────────────────────────────┐
   candidates    │  Stage C — AI fuzzy match         │
                 │  Send item name + top-N product   │
                 │  names to Claude (haiku).         │
                 │  Returns ranked list + rationale. │
                 └──────────────────────────────────┘
                              │
                         return top 5
                          candidates

User reviews candidates → confirms one → saved as item_mapping (confirmed_by_user=true)
```

- **Stage B** runs synchronously (< 100 ms).
- **Stage C** runs as a background job if B returns nothing. User is notified when results arrive.
- Confirmed mappings are reused for the same `item_name` in future lists (cache-and-reuse pattern).

---

## 5. API Design

**Convention:** OData-inspired. All collection endpoints return `{ value: [...], "@odata.count": N }`.
Query params: `$filter`, `$top`, `$skip`, `$orderby`, `$count`, `$select`.

**No `$metadata` endpoint** — no suitable FastAPI-native library exists; can be added later as handcrafted EDMX.

### Base URL: `/api`

#### Lists

| Method | Path | Description |
|---|---|---|
| `GET` | `/list` | List all shopping lists |
| `POST` | `/list` | Create a list |
| `GET` | `/list/{id}` | Get a list (includes item count) |
| `PATCH` | `/list/{id}` | Update list name |
| `DELETE` | `/list/{id}` | Delete list and all items |

#### Items

| Method | Path | Description |
|---|---|---|
| `GET` | `/list/{id}/item` | List items in a list |
| `POST` | `/list/{id}/item` | Add an item |
| `GET` | `/list/{id}/item/{item_id}` | Get an item |
| `PATCH` | `/list/{id}/item/{item_id}` | Update item (name, qty, unit, mapping) |
| `DELETE` | `/list/{id}/item/{item_id}` | Delete item |

#### Cart automation

| Method | Path | Description |
|---|---|---|
| `POST` | `/list/{id}/fill-cart` | Start a cart fill job for this list |

#### Catalog

| Method | Path | Description |
|---|---|---|
| `GET` | `/colruyt_product` | Search catalog (`$filter=contains(name,'melk')`) |
| `GET` | `/colruyt_product/{id}` | Get a product |
| `POST` | `/catalog_sync` | Trigger a manual catalog sync job |

#### Mappings

| Method | Path | Description |
|---|---|---|
| `GET` | `/item_mapping` | List mappings |
| `POST` | `/item_mapping` | Create/override a mapping |
| `PATCH` | `/item_mapping/{id}` | Update (e.g. confirm) |
| `DELETE` | `/item_mapping/{id}` | Remove mapping (forces re-match) |

#### Jobs

| Method | Path | Description |
|---|---|---|
| `GET` | `/job` | List jobs (`$filter=type eq 'cart_fill'`) |
| `GET` | `/job/{id}` | Get job status + result |

### Response envelopes

Collection:
```json
{
  "value": [...],
  "@odata.count": 42
}
```

Single entity: plain object (no envelope).

Error:
```json
{
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "Item 99 not found in list 3"
  }
}
```

---

## 6. Backend Services

### `ListService`
CRUD for `list` and `item`. Applies OData-style filtering/pagination via `odata-query` (SQLAlchemy backend).

### `CatalogService`
- `search(query: str, limit: int) -> list[ColruytProduct]` — FTS on local catalog.
- `get_product(colruyt_id: str) -> ColruytProduct`.

### `CatalogSyncWorker`
- Scheduled nightly via APScheduler.
- Playwright scrapes the Colruyt Collect & Go product listing pages.
- Upserts `colruyt_product` rows; marks stale products `is_available=False`.
- Writes a `catalog_sync_log` entry.
- Failure detection: if scrape errors, logs failure and sends a notification (log + optional push notification).

### `AIMatchService`
- Called when Stage B returns no candidates.
- Sends item name + up to 50 candidate product names to Claude (claude-haiku-4-5).
- System prompt: strict JSON output, ranked list of `{ product_id, confidence, rationale }`.
- Result stored in `job.result`; frontend polls `/job/{id}` for completion.

### `CartFillService`
- Receives a list ID.
- Validates all items have a confirmed mapping.
- Launches Playwright with stored Colruyt session cookies.
- For each item: navigates to product page, adds to cart.
- Reports per-item success/failure back to `job.result`.
- Never places the order — leaves cart open for user review.

---

## 7. Frontend (PWA)

**Stack:** Vite + React + TypeScript + TanStack (Router, Query, Table, Form) + Tailwind + shadcn/ui

### Screens

| Screen | Route | Purpose |
|---|---|---|
| Lists | `/` | All shopping lists; create / delete |
| List detail | `/list/:id` | Items + match status; trigger cart fill |
| Item match | `/list/:id/item/:itemId/match` | Review candidates, confirm or override |
| Job status | `/job/:id` | Live cart fill progress |
| Settings | `/settings` | Colruyt credentials; catalog sync status |

### Key UI behaviours
- Match status badge per item: `unmatched` / `pending AI` / `matched` / `confirmed`.
- Bulk confirm: user can confirm all AI matches at once if confidence > 0.8.
- Cart fill button disabled until all items are confirmed.
- Job status screen polls `/job/{id}` every 2 s; shows per-item progress.
- Offline-capable: TanStack Query cache + service worker for viewing existing lists offline.

---

## 8. Technology Choices

| Concern | Choice | Rationale |
|---|---|---|
| Frontend | Vite + React + TypeScript | Fast DX, PWA plugin, ecosystem |
| State / data fetching | TanStack Query | OData-style params map directly to query keys |
| Routing | TanStack Router | Type-safe routes |
| UI | Tailwind + shadcn/ui | Utility-first + accessible components |
| Backend | Python + FastAPI | Async, type-safe, easy Playwright integration |
| ORM | SQLAlchemy (async) | Works with odata-query filter transpiler |
| OData filtering | `odata-query` (PyPI) | Parses `$filter`/`$orderby`/`$top`/`$skip` → SQLAlchemy |
| DB (dev) | SQLite | Zero-config, single file |
| DB (prod) | Postgres | Full-text search, concurrent writes |
| Automation | Playwright (Python) | Official async API, stealth plugin |
| Catalog scraping | Playwright | Handles JS-rendered pages |
| AI matching | Anthropic Claude (haiku) | Fast + cheap for structured matching tasks |
| Background jobs | APScheduler | Lightweight, in-process scheduling |
| Packaging | uv + pyproject.toml | Modern Python packaging |

---

## 9. Key Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Colruyt site changes break scraper | Medium | High | Detect scrape failures early; alert user; fallback: manual product search |
| Anti-bot measures block Playwright | Medium | High | playwright-stealth; human-like delays; session cookie reuse; fail gracefully |
| Product catalog goes stale | Medium | Medium | Nightly sync; `last_seen_at` age warnings in UI |
| AI match hallucinations | Low | Medium | AI only suggests; user always confirms before cart fill |
| Playwright adds wrong quantity | Low | High | Post-fill diff: compare expected vs actual cart contents |
| SQLite write contention (sync + API) | Low | Low | WAL mode; migrate to Postgres for production |

---

## 10. Out of Scope (Future Iterations)

- Meal-plan integration → auto-generate grocery lists from weekly menus
- Recurring staples: items added automatically each week
- Multi-store support (Delhaize, Aldi)
- Price comparison across stores
- Order history and spend tracking
