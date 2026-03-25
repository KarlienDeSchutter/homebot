# Homebot

Personal home management platform — meal planning, groceries, finance, and more.

## Stack

- **Frontend:** Vite + React + TypeScript (PWA) + TanStack (Router, Query, Table, Form)
- **Backend:** Python + FastAPI + SQLAlchemy (async) + `odata-query`
- **Browser automation:** Playwright + stealth
- **DB:** SQLite (dev) → Postgres (prod) + Alembic migrations
- **UI:** Tailwind + shadcn/ui
- **AI:** Anthropic Claude (haiku) — product matching fallback

## Apps

| App | Status | Description |
|---|---|---|
| **Grocery** | In progress | Manual lists → auto-fill Colruyt Collect & Go cart |
| **Meal planner** | Planned | AI-powered recipe discovery, weekly planning |
| **Finance** | Planned | Budgeting, stock tracking |
| **Home projects** | Planned | Renovation / maintenance planning |

## Docs

- [`SPEC.md`](SPEC.md) — Grocery app: data model, API, matching architecture, risks
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Overall system design, layer overview, shared patterns

## Development

```bash
# Frontend
cd apps/web && bun install && bun dev

# Backend
cd backend && uv sync && uvicorn app.main:app --reload

# Install Playwright browsers (first time)
cd backend && playwright install chromium
```

## API conventions

All endpoints follow OData-inspired conventions:

- Singular resource names (`/list`, `/item`, `/colruyt_product`)
- Query params: `$filter`, `$top`, `$skip`, `$orderby`, `$count`, `$select`
- Collection responses: `{ "value": [...], "@odata.count": N }`
