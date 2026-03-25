# Homebot 🏠

Personal home management platform — meal planning, groceries, finance, and more.

## Stack
- **Frontend:** Vite + React + TypeScript (PWA) + TanStack (Router, Query, Table, Form)
- **Backend:** Python + FastAPI
- **Browser automation:** Playwright + stealth + captcha solving
- **DB:** SQLite → Postgres
- **UI:** Tailwind + shadcn/ui

## Apps (planned)
- 🍽️ Meal planner — AI-powered recipe discovery, weekly planning
- 🛒 Grocery — auto-generated lists, store automation (Colruyt, Delhaize)
- 💰 Finance — money management, budgeting, stock tracking
- 🏠 Home projects — renovation/maintenance planning

## Development
```bash
# Frontend
cd apps/web && bun install && bun dev

# Backend
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload
```
