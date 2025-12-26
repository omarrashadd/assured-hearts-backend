# Assured Hearts Backend

Minimal Node/Express API scaffold for Assured Hearts. Keep this repo separate from the frontend.

## Quick start
```bash
npm install
npm run dev
```
API listens on `PORT` (default 3000).

## Environment
See `.env.example` for required variables:
- `PORT` (default 3000)
- `ORIGIN` (CORS allowlist; comma-separated or `*` for all)
- `LOG_LEVEL` (morgan format, e.g., `dev`)
- `DATABASE_URL` (Postgres connection; optional until you wire persistence)

## Routes
- `GET /health` — health check
- `POST /forms/parent` — expects `name, email, phone, children`
- `POST /forms/provider` — expects `name, email, phone, experience`

Responses are JSON. Validation is minimal; extend as needed.

## Render deployment (Web Service)
- Build command: `npm install`
- Start command: `npm run start`
- Env vars: set the same as your `.env` (plus `DATABASE_URL` if using Postgres)
- Optional: add Render Postgres and use its `DATABASE_URL`.

## Next steps
- Add persistence (Prisma + Postgres or another ORM).
- Add email/Slack notifications on form submissions.
- Add rate limiting (e.g., express-rate-limit) and stronger validation.
