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
    proposals/         Service catalog, section parsing, generation prompts,
                       PDF, line-item normalization, types
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

### Auth

`src/proxy.ts` is the Next.js middleware. Next 16 renamed `middleware.ts` to
`proxy.ts` — both names are recognised, but having both files present is a hard
build error, so there is exactly one and it lives here.

It is deny-by-default: `/login`, `/api/auth/*`, and `/api/webhooks/*` are
public, and everything else requires a session. Webhooks are public because
they authenticate with an HMAC signature rather than a session cookie.

Every API route handler then calls `requireUser()` or `requireAdmin()` from
`src/lib/auth/guard.ts`, which resolves the caller's `agent_profiles` row and
returns 401 (no session) or 403 (no profile, deactivated, or not an admin).
Both use the request-scoped SSR client, so everything they return is still
subject to RLS — the guard is defence in depth, not the boundary.

The service-role client (`src/lib/supabase/service.ts`) bypasses RLS and is
confined to `/api/webhooks/*`. `src/lib/auth/route-coverage.test.ts` fails the
build if it appears anywhere else, or if any route handler is left unguarded.

### API routes

| Group | Routes |
| --- | --- |
| Leads | `/api/leads`, `/leads/list`, `/leads/assign`, `/leads/work-queue` |
| Discovery | `/api/discover`, `/api/enrich`, `/api/enrich-bulk`, `/api/exports` |
| Imports | `/api/imports` (admin bulk), `/api/my/imports` (agent self-sourced) |
| Outreach | `/api/outreach`, `/outreach/sequences`, `/outreach/templates` |
| Proposals | `/api/proposals`, `/proposals/generate`, `/proposals/send` |
| SMS | `/api/sms/send`, `/api/sms/status`, `/api/webhooks/twilio/sms` |
| Voice | `/api/voice/call`, `/api/my/voice-phone`, `/api/webhooks/twilio/voice/bridge`, `/api/webhooks/twilio/voice/status` |
| Shared | `/api/shared/stats`, `/shared/action-items`, `/shared/activity`, `/shared/search` |
| Config | `/api/agents`, `/api/smart-lists`, `/api/saved-searches` |

### Core tables

**Pipeline.** `leads` is a prospect. Around it: `agent_profiles`,
`outreach_sequences`, `outreach_templates`, `proposals`, `activity_log`,
`import_jobs`, `enrichment_jobs`, `saved_searches`, `smart_lists`,
`google_places_cache`.

**Communication.** `sms_messages` logs every SMS, sent or blocked.
`voice_calls` (migration `00021_twilio_voice_calls.sql`) logs every
click-to-call attempt — including the ones suppressed by the kill switch,
which are history too. Neither stores a recording.

**Revenue** (migration `00016_revenue_core.sql`). `leads` used to be prospect,
contact, and customer at once, which breaks as soon as a client signs twice,
upgrades, churns, or comes back. That is now split:

```
leads ──sourced──▶ accounts ──▶ deals ──▶ deal_milestones
                                  │  └──▶ payments
                                  ▼
                       commission_entries ──▶ payout_batches
```

| Table | What it is |
| --- | --- |
| `accounts` | A business once it is a customer. `lead_id` records where it came from, nullable |
| `deals` | One signed contract. Many per account |
| `deal_milestones` | Stages for a project billed in parts |
| `payments` | Money actually received |
| `commission_entries` | Append-only ledger. The only truth about what an agent is owed |
| `payout_batches` | One payout run to one agent |
| `attributions` | Who gets credit for a lead, and until when |

Four invariants this schema exists to hold:

1. **The rate is snapshotted on the deal.** `deals.commission_rate_bps` is
   captured at signing and a `CHECK` requires it once the deal leaves draft.
   Changing an agent's `default_commission_rate_bps` never reprices history.
2. **`received_at` and `cleared_at` are separate.** Commission accrues off
   `cleared_at`; the gap between them is the refund and chargeback buffer.
   Collapsing them would pay commission on money that can still reverse.
3. **The ledger is append-only.** A trigger refuses every `DELETE` and every
   `UPDATE` except one: attaching an unbatched entry to a payout batch
   (`NULL` → value, once). Corrections are new reversing rows, never edits.
   Clawbacks are negative `amount_cents`, and a `CHECK` keeps the sign and the
   `entry_type` in agreement.
4. **There is no balance column anywhere.** An agent's unpaid balance is
   `SUM(amount_cents) WHERE payout_batch_id IS NULL`. A corrected balance with
   no history behind it is an argument you cannot win with someone whose
   income it is. A test asserts no `balance*` column exists.

Internal agents and external referral partners are one table with a different
`agent_profiles.partner_type` — one commission engine, not two.

RLS is enabled on all 23 tables, with role- and ownership-aware policies
(migration `00015_rls_role_scoping.sql`). No policy evaluates to a bare `true`.

| Caller | Access |
| --- | --- |
| Admin | Everything |
| Agent | Select/update their own assigned leads. No insert, no delete, and cannot reassign a lead away from themselves |
| Agent (child records) | outreach_sequences, activity_log, proposals, sms_messages scoped through the parent lead's assignment |
| Agent (voice_calls) | Read their own calls and calls on their leads. No write of any kind — `request_voice_call()` creates rows, Twilio's webhook updates them |
| Agent (config tables) | Read-only; admins write |
| Anyone | Orphaned tables (`growth_*`, `site_configs`, `lead_audits`, `automation_logs`) are admin-only |

Policies resolve identity through three `SECURITY DEFINER` helpers in the
`private` schema — `current_agent_id()`, `is_admin()`, and `owns_lead()`.
They are definer functions specifically so that an `agent_profiles` policy can
check the caller's role without selecting from `agent_profiles` and recursing.

Two things worth knowing:

- **`agent_profiles.id` is not `auth.uid()`.** `id` is the table's own primary
  key and is what `leads.assigned_to` references; `user_id` is the link to
  `auth.users`. Matching on the wrong one silently breaks every ownership check.
- **Teammate names come from `public.agent_directory`**, a view exposing only
  `id`, `display_name`, and `is_active`. Agents can read their own
  `agent_profiles` row and nothing more.

Deactivating an agent (`is_active = false`) revokes access immediately: the
helper functions stop resolving them and every ownership predicate goes false.

## Agent-facing surfaces

| Route | What it is |
| --- | --- |
| `/my/queue` | The daily driver. Assigned leads, soonest action first. Keyboard-first and optimistic |
| `/my/pipeline` | Their deals by stage, with earned and expected shown separately |
| `/my/commissions` | The ledger, with CSV export |
| `/my/import` | Upload leads they sourced themselves, credited as self-sourced |
| `/leads/[id]` | Adds Convert to Account |

**Scoped by RLS, not by a filter.** None of these queries carry an
`assigned_to = me` clause. They come back scoped because the policies say so.
`supabase/tests/agent-tools.test.ts` runs the *exact unscoped SQL* these pages
issue, as two different agents, and asserts each one is scoped anyway — so a
policy regression fails the build instead of leaking a teammate's rows.

### /my/queue

`j`/`k` move, `c` logs a call, `e` an email, `n` a note, `d` sets the next
action, `s` advances the stage, `↵` opens the lead. Shortcuts are suppressed
while a text field has focus. Every action writes to `activity_log`, and every
action is optimistic — on failure the row is rolled back and the error shown,
because an optimistic UI that leaves a failed write on screen is worse than no
optimism at all.

Placing a real Twilio call is the one action with no shortcut: it is a labelled
button on rows that have a phone number, behind a confirmation dialog naming
the business. `c` still opens the log-a-call composer it always has. A keystroke
that rings a stranger's phone is not something anyone should be able to hit by
accident.

### /my/pipeline

Earned and expected are separate columns and are never summed. **Earned** is
what the ledger holds; **expected** is a forecast off the contract value that
pays nothing until a payment clears. An uncapped retainer shows a per-month
figure rather than a fabricated lifetime total, and a deal with no rate
snapshot shows a dash rather than a guess.

### Convert to Account

Agents have SELECT-only on `accounts` and `deals` and keep it that way — direct
INSERT would let an agent write their own `commission_rate_bps`. Conversion
runs through `public.convert_lead_to_account()`, a `SECURITY DEFINER` function
that reads the rate from the owning agent's profile server-side. **There is no
rate parameter**, and that absence is the security property.

It creates the account and a **draft** deal, resolves the winning attribution
(admin override first, then earliest non-expired first touch), marks the lead
won, and logs the conversion. An admin reviews the contract value and signs.
Credit goes to the lead's owner, not to whoever clicked — so an admin
converting on an agent's behalf does not take the commission.

### Self-sourced imports

Agents source their own leads in a spreadsheet and import them at `/my/import`.
Phase 1's block on agent lead creation is not lifted to make this work: there
is still **no INSERT policy on `leads` or `attributions` for agents**, and
`supabase/migrations/00020_agent_self_sourced_imports.sql` refuses to apply if
one ever appears.

Imports run through `public.import_agent_leads()`, a `SECURITY DEFINER`
function on the same model as the conversion function. **There is no agent
parameter** — the crediting agent comes from `private.current_agent_id()`,
which reads the JWT — so an agent cannot import onto a teammate, and the
route holds the caller's RLS-bound client rather than the service role. The
function reads only whitelisted per-row keys, so an `assigned_to`, `agent_id`,
`source` or rate field smuggled into the payload is never looked at.

Each imported lead is assigned to the caller with `assigned_at = now()` and
gets a matching `self_sourced` attribution row on the standard 90-day expiry.
That row is the point: Phase 5 only drops an agent to the inbound rate when an
explicit `inbound_assigned` attribution exists, so a self-sourced lead needs a
record of its own rather than relying on the absence of one.

Duplicate protection is unchanged — `external_id` when present, otherwise
`business_name` + `state`, both case-insensitive — and deliberately looks at
every lead in the table, not just the caller's. Two agents importing the same
business is exactly the ambiguity this is meant to prevent. Beyond the standard
headers the parser also accepts a research sheet's own column names (`Company`,
`Type`, `Decision Maker`, `Phone Number`, a combined `City, State`); aliases
only ever fill an empty field, so every CSV that imported before still imports
identically.

The admin bulk importer at `/leads/import` is untouched, still admin-only, and
still credits nobody — leads it creates are unassigned and carry no
attribution.

### Outreach

Team `outreach_templates` stay admin-owned. An agent wanting different wording
gets an `agent_template_overrides` row instead of editing the shared copy;
`GET /api/outreach/overrides` returns each template already merged with the
caller's override, alongside the team original so the UI can offer a revert.
`outreach_sequences` is the send log — it now carries `template_id` and
`activity_log_id`, tying a send to the template used and the activity row it
produced. Follow-up reminders write `leads.next_action_date`, which is what
puts the lead back at the top of the queue.

## Click-to-call

One button on a lead places a real phone call, and the agent's personal number
never reaches the prospect.

```
agent presses "Call via Twilio"
        │
        ▼
POST /api/voice/call  { lead_id }          ← the entire request body
        │
        ▼
request_voice_call(lead_id)                 ← SECURITY DEFINER
   reads the prospect's number from the lead
   reads the agent's callback number from their own profile
   writes a voice_calls row with a random one-off token
        │
        ▼
Twilio Calls API:  To = agent's phone,  From = TWILIO_FROM_NUMBER
        │
        ▼
agent answers ──▶ Twilio fetches /api/webhooks/twilio/voice/bridge?token=…
                     looks the prospect's number up by token
                     returns <Dial callerId="TWILIO_FROM_NUMBER">
        │
        ▼
prospect's phone rings, showing the Tweak & Build number
```

**The design decision:** the client never names a phone number. `lead_id` is
the whole input, and the route rejects a body carrying anything else rather
than ignoring it. Every number the dialer uses is read out of the database
inside a definer function, and the callback URL carries an opaque per-call
token instead of a phone number — so there is no request anyone can craft that
turns the company's caller ID into an open dialer. Twilio's request signature
covers the URL, so a swapped token fails before it is read.

**What agents can do to `voice_calls`:** read their own. That is all. There is
no INSERT, UPDATE or DELETE policy for them, so call history cannot be
rewritten and a call record cannot be conjured with a number of someone's
choosing. `request_voice_call()` creates the row, the agent gets exactly one
write to close it out (`record_voice_call_result()`, which only moves a row out
of `requested`), and everything after that belongs to Twilio's status callback
through the service role.

### Setting an agent's callback number

`agent_profiles.voice_phone` is the phone Twilio rings first. Without it the
button is disabled and says so. Two ways to set it:

- **The agent, themselves** — Settings → Twilio Calling. This goes through
  `set_my_voice_phone()`, a definer function that touches that one column on
  the caller's own row. Agents still have no UPDATE policy on
  `agent_profiles`; widening one would have handed them their own commission
  rate.
- **An admin, for someone else** — `POST /api/admin/team` with
  `{ action: "update", agent_id, voice_phone: "+18622984988" }`.

US numbers can be typed any way; anything else needs full E.164. A `CHECK`
constraint and `private.normalize_phone()` (a SQL mirror of the TypeScript
normaliser) keep the stored value dialable.

### The kill switch

`TWILIO_VOICE_ENABLED` defaults to `false` and is deliberately **not** coupled
to `SMS_SENDING_ENABLED` — A2P approval and voice billing are unrelated events,
and turning one on must never turn the other on. While it is false no Twilio
request is made at all, the attempt is still recorded with status `disabled`,
and the UI says the call was not placed.

### What a call does not do

- **It does not mark the lead contacted.** `lifecycle_status` and
  `contacted_at` are untouched by every path here. A ringing phone is not a
  conversation, and an accepted API request is certainly not one. The activity
  trail records `lead.call_attempted`, `lead.call_connected` or
  `lead.call_not_connected` and stops there. "Log Call" remains the way to say
  contact happened, and is unchanged.
- **It does not record.** No recording parameter is ever sent, no recording
  column exists, and migration `00021` fails if one is ever added.
- **It does not auto-dial.** One lead at a time, from an explicit button press
  behind a confirmation dialog. In `/my/queue` the `c` shortcut still opens the
  log-a-call composer it always has — no keystroke rings a phone.

### Live testing

The Twilio account is suspended for billing, so live calls cannot complete
yet. Twilio rejects the Calls API request, the app records the call as `failed`
with Twilio's own message, and the lead page shows it. That is the designed
behaviour for this state, not a bug — and it is why the application logic is
tested end to end against mocked Twilio responses rather than a live account.

## The commission engine

`src/lib/commissions/` turns cleared payments into ledger entries. It is the
highest-risk code in the app, so the arithmetic is isolated from everything
that touches a database:

| File | Role |
| --- | --- |
| `calculate.ts` | **Pure.** No database, no clock, no network. All the money math |
| `accrue.ts` | Loads state, calls the planner, writes what is missing |
| `clawback.ts` | Refunds and chargebacks — reuses the same planner |
| `balances.ts` | Read models: unpaid, payable-now, lifetime, per-deal |
| `payouts.ts` | Batch open entries, stamp them, mark paid |

The rules it implements:

1. Commission accrues when a payment **clears**, never when a deal is signed.
   A payment with `received_at` set and `cleared_at` null accrues nothing —
   that gap is the refund window.
2. `payable_at = cleared_at + 30 days` (Net 30).
3. The rate applied is `deals.commission_rate_bps`, snapshotted at signing. The
   agent's current default is not an input to the calculation at all.
4. Milestone projects accrue per milestone as each clears.
5. Recurring deals accrue one entry per cleared month, checked against
   `recurring_cap_months` first. A null cap accrues indefinitely; a reached cap
   writes nothing and records why.
6. A refund writes a negative `clawback` entry. It never edits or deletes the
   original — the ledger trigger refuses both. A clawback larger than the
   balance carries negative against future earnings rather than clamping.
7. Cents-only integer math, rounded half-up **once**, at the final step.

### Why one planner handles both directions

`planDealLedger` computes what the ledger *should* contain and returns the
difference from what it does contain. Accrual and clawback are the same
function because two code paths for "money in" and "money back" would
eventually disagree about rounding, and that disagreement shows up as a cent
nobody can account for.

For one-time deals the total is always `rate x (net cleared basis)` and each
entry is a step toward it. Three uneven milestones therefore sum to exactly the
same total as one payment for the whole amount, and a full refund returns the
balance to precisely zero — both fall out of the same arithmetic rather than
being special-cased. (Naive per-payment rounding genuinely drifts: at 30%, a
build split `[1, 1, 99998]` cents totals 29,999 instead of 30,000.)

Idempotence has two independent layers: the planner only ever plans the
difference, and a partial unique index on
`commission_entries(payment_id) WHERE entry_type = 'earned'` makes a duplicate
impossible even if two sweeps overlap.

### Running it

| Entry point | Auth | Use |
| --- | --- | --- |
| `POST /api/commissions/accrue` | Admin session | Manual sweep, or one deal via `deal_id` |
| `GET /api/cron/commissions/accrue` | `Bearer $CRON_SECRET` | Nightly Vercel cron (07:00 UTC), 7-day lookback |

The cron route is the second and last place the service-role client is allowed
— it has no user to act as — and, like the Twilio webhook, it is exempt from
the session gate because it authenticates on a shared secret instead.
`route-coverage.test.ts` fails the build if either exemption spreads.

## Admin tools

| Route | What it is |
| --- | --- |
| `/admin/commissions` | Every agent's balance, payout batching, mark-paid, manual entries |
| `/admin/revenue` | MRR, new business by month, close rate by agent, commission load |
| `/admin/team` | Rates, classification, payout details, book reassignment |
| `/admin/attribution` | Conflict queue for leads more than one agent claims |

The number `/admin/revenue` exists for is **commission as a share of collected
revenue**. It is what tells you whether the structure is working, and no
individual deal will ever show it — an uncapped recurring rate does its damage
across the book, a month at a time.

### The five settled decisions

1. **Retainers cap at 6 months.** A $3,000/mo retainer pays $5,400 rather than
   $32,400 over three years. Applied as the default inside
   `convert_lead_to_account()`; an explicit cap still wins.
2. **Split credit is not built, but the seam is open.** The ledger's unique key
   is `(payment_id, agent_id)` rather than `payment_id` alone — a no-op with
   one agent per deal, and it removes the painful half of the retrofit. The
   double-pay guarantee is unchanged.
3. **Self-sourced pays more than inbound.** `default_commission_rate_bps` is
   the self-sourced rate; `inbound_commission_rate_bps` applies when an
   explicit `inbound_assigned` attribution is on file. **Absent data keeps the
   higher rate** — nothing creates attributions automatically and agents cannot
   create leads, so a missing row must never quietly cut someone's pay.
4. **`employment_classification`** is a three-state field
   (`contractor_1099` / `employee_w2` / `unset`), not a decision baked into the
   schema. Only the last four TIN digits are stored; the full number belongs
   wherever the 1099 is filed.
5. **Stripe is the payment source, and received is not cleared.**
   `charge.succeeded` writes `received_at` and leaves `cleared_at` null. The
   nightly sweep clears it after `PAYMENT_SETTLEMENT_DAYS` (default 7), and
   never clears a payment that was refunded inside the window.

### Rate changes apply to future deals only

`deals.commission_rate_bps` is snapshotted at conversion and never repriced.
`/admin/team` states this on screen whenever a rate is edited, naming the exact
count of existing deals and the rates they carry, and the change is written to
`activity_log` with both old and new values. A rate change discovered by an
agent reading their own ledger is the worst possible way to find out.

### Reassigning a book

`reassign_agent_book()` moves open leads and active accounts. It deliberately
does **not** touch `deals.closed_by_agent_id` or any `commission_entries` — the
person who closed a deal closed it, and a reassignment that moved someone's
ledger would be indistinguishable from taking it.

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

The RLS suite (`supabase/tests/rls.test.ts`) needs a throwaway Postgres. It
applies every migration to it, then asserts the policies as two different agent
identities. Without `TEST_DATABASE_URL` it skips rather than fails:

```bash
createdb rlstest
TEST_DATABASE_URL=postgresql://localhost/rlstest npm test
```

CI runs it against a `postgres:16` service and fails the build if the suite
skipped — a silently-skipped RLS suite would make a broken policy look green.

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

- **Money**: `bigint` cents everywhere, formatted only at the render edge. The
  older `proposals` table is the one exception: `services_json` and its totals
  are whole dollars, and stay that way.
- **Proposal catalog**: `SERVICE_CATALOG` is a set of scope templates, not a
  price list. Selecting one seeds a line with a suggested amount; the agent sets
  the real one-time price, monthly price, and scope note per client. One-time and
  monthly totals are always kept separate, and the investment section is built
  from the selected lines rather than written by the model. Line items are
  normalized on read (`lib/proposals/services.ts`), so proposals saved by the old
  fixed-package catalog still load, render, and export correctly.
- **Rates**: integer basis points.
- **Validation**: every API route Zod-validates its body and query, and returns
  typed errors.
- **Tests**: required for all money math and all accrual logic. No exceptions.
- **RLS**: enabled on every table, with explicit policies.
