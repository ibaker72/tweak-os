# tweak-os

The internal operating system for **Tweak & Build**, a product engineering
studio in North Jersey. It runs the outbound sales motion: find local
businesses, score and enrich them, work a queue, send outreach, and generate
proposals.

Deployed at **app.tweakandbuild.com**.

## Who uses it

| Role | Count | What they do |
| --- | --- | --- |
| Admin / owner | 1 | Sees everything, closes deals, runs delivery |
| Sales agent | 2 | Outreach, qualify, close — commission only |

Roles live in `agent_profiles.role` (`admin` | `agent`), keyed to
`auth.users` via `user_id`.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind 4**, **Radix UI** primitives
- **Supabase** — Postgres, Auth, and RLS
- **Zod** for request validation, **Vitest** for tests
- **Anthropic Claude** for outreach copy and proposal drafting
- Google Places / Custom Search for discovery, Resend for email, Twilio for SMS

## Architecture

```
src/
  app/
    (platform)/        Authenticated route group — the app itself
      dashboard/       Stats, action items, recent activity
      leads/           List, detail, discover, import, work queue
      proposals/       Composer, generation, send
      settings/        Agents, templates, smart lists, env status
    api/               25 route handlers (see below)
    login/
  components/
    shell/             AppShell, Sidebar, Topbar, CommandPalette
    dashboard/         Leads table, lead detail, stat cards
    leads/  proposals/ ui/  brand/  shared/
  lib/
    leads/             Scoring, enrichment, discovery, assignment,
                       mutations, queries, smart lists, sequences, CSV
    proposals/         Section parsing, generation prompts, PDF, types
    supabase/          client (browser) / server (SSR) / service (service-role)
    shared/            activity-logger, constants
    sms/  ai/  validators/
  proxy.ts             Auth gate + RBAC on every request
  types/
supabase/migrations/   14 sequential SQL migrations
```

### Request flow

1. `src/proxy.ts` runs on every request. It resolves the Supabase session,
   redirects unauthenticated users to `/login`, returns 401 for unauthenticated
   API calls, and enforces admin-only access on `/api/agents`.
2. Route handlers validate their body and query with Zod (`src/lib/validators`,
   or an inline schema) and return typed errors.
3. Data access goes through one of three Supabase clients:
   - `client.ts` — browser, anon key, RLS applies
   - `server.ts` — SSR/route handlers, anon key + user cookies, RLS applies
   - `service.ts` — service-role key, **bypasses RLS**, server-only
4. Mutations that matter are written to `activity_log` via
   `src/lib/shared/activity-logger.ts`.

### API routes

| Group | Routes |
| --- | --- |
| Leads | `/api/leads`, `/leads/list`, `/leads/assign`, `/leads/work-queue` |
| Discovery | `/api/discover`, `/api/enrich`, `/api/enrich-bulk`, `/api/imports`, `/api/exports` |
| Outreach | `/api/outreach`, `/outreach/sequences`, `/outreach/templates` |
| Proposals | `/api/proposals`, `/proposals/generate`, `/proposals/send` |
| SMS | `/api/sms/send`, `/api/sms/status`, `/api/webhooks/twilio/sms` |
| Shared | `/api/shared/stats`, `/shared/action-items`, `/shared/activity`, `/shared/search` |
| Config | `/api/agents`, `/api/smart-lists`, `/api/saved-searches` |

### Core tables

`leads` (~40 columns) is the center of the schema. Around it:
`agent_profiles`, `outreach_sequences`, `outreach_templates`, `proposals`,
`activity_log`, `import_jobs`, `enrichment_jobs`, `saved_searches`,
`smart_lists`, `google_places_cache`.

RLS is enabled on all 23 tables.

> **Known gap:** every one of those tables currently has a blanket
> `using (true)` policy, dating from when this was a single-operator tool. RLS
> is on, but any authenticated user can read and write every row. This has to
> be replaced with role- and ownership-aware policies before commission agents
> get accounts — see the rules below, which apply to all new work.

## Running locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000
```

Only the three Supabase variables are needed to boot. The rest gate individual
features — a missing key returns a clear "not configured" error rather than
crashing.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, single run |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and build on every
push to `main` and every pull request.

## Migrations

Migrations live in `supabase/migrations/`, numbered sequentially from `00001`.

**Rules:**

1. Migrations are **additive**. Never edit one that has been committed — add a
   new one.
2. Number it as the next in sequence: `00015_your_change.sql`.
3. Every new table gets `alter table ... enable row level security` plus
   explicit policies. Never `using (true)`.
4. Money is stored as `bigint` **cents**. Never float, never `numeric`, and
   never do currency arithmetic on the client.
5. Rates are **basis points** as `integer` (3000 = 30%).
6. All timestamps are `timestamptz`.

Apply them with the Supabase CLI against a linked project:

```bash
supabase db push
```

Or paste a single migration into the SQL editor in the Supabase dashboard.

> Some early migrations (`00004_growth_engine`, `00007_automation_proxy`,
> `00008_audits_and_proposals`) create tables whose application code has since
> been removed. The tables are intentionally left in place — dropping them is a
> separate decision, and orphaned tables cost nothing.

## Conventions

- **Money**: `bigint` cents everywhere, formatted only at the render edge.
- **Rates**: integer basis points.
- **Validation**: every API route Zod-validates its body and query, and returns
  typed errors.
- **Tests**: required for all money math and all accrual logic. No exceptions.
- **RLS**: enabled on every table, with explicit policies.
