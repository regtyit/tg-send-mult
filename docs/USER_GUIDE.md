# tg-send-mult — User Guide

This guide explains how to operate the app day to day: what each part means, how to run a campaign, and how to troubleshoot common issues. It matches the current codebase (dashboard, CLI, and API).

---

## Table of contents

1. [Mental model](#mental-model)
2. [Before you start](#before-you-start)
3. [Running the application](#running-the-application)
4. [Dashboard walkthrough](#dashboard-walkthrough)
5. [Typical workflows](#typical-workflows)
6. [Accounts: roles, status, and limits](#accounts-roles-status-and-limits)
7. [Proxies and MTProxy](#proxies-and-mtproxy)
8. [Contacts and audience](#contacts-and-audience)
9. [Templates and spintax](#templates-and-spintax)
10. [Campaigns](#campaigns)
11. [Dialogs (simulation)](#dialogs-dialogs)
12. [Verify deliveries](#verify-deliveries)
13. [CLI reference](#cli-reference)
14. [REST API](#rest-api)
15. [Scheduler background jobs](#scheduler-background-jobs)
16. [Troubleshooting](#troubleshooting)
17. [Safety and compliance](#safety-and-compliance)

---

## Mental model

The app separates **who sends** from **who receives**:

| Concept | Where it lives | What it is |
|---------|----------------|------------|
| **Sending account** | Senders page, MongoDB `accounts` | A logged-in Telegram **user session** (phone + encrypted session). These identities deliver messages. |
| **Contact (recipient)** | Contacts page, MongoDB `contacts` | A person you may message — identified by **E.164 phone** or **@username**. Imported from CSV/JSON or added manually. |
| **Template** | Templates page | Message body with placeholders and optional spintax. |
| **Campaign** | Campaigns page | Binds **senders** + **audience** + **template**, then enqueues delivery jobs. |
| **Dialog script** | Dialogs page | Ordered chat lines (A/B) for **simulation** between two senders — not campaign mail. |
| **Dialog preset** | Dialogs → templates | Built-in ready-made scripts (22+); load into builder or session. |
| **Message** | MongoDB `messages` | One outbound attempt: rendered text, status (`queued` → `sent` / `failed`), errors, sender used. |

You do **not** message people by picking @handles on the Senders page. Senders are your outbound Telegram accounts; recipients always come from Contacts.

```text
  [Sender A] ──┐
  [Sender B] ──┼──► Campaign ──► Contact list (by tags or IDs) ──► Telegram users
  [Sender C] ──┘         │
                         └── Template + rate limits + sticky sender choice
```

---

## Before you start

### Requirements

- **Node.js 20+**
- **Python 3** with Telethon (via `npm run setup:python`)
- **MongoDB 7+** (Artix AUR often ships **8.x** — use matching Docker image if containerized)
- **Valkey or Redis 7+** (BullMQ; env vars stay `REDIS_*`)
- **Telegram API credentials** (`api_id` + `api_hash` from [my.telegram.org](https://my.telegram.org)) — per account or global fallback in `.env`
- **MTProxy** (recommended) for CLI login and sending — the CLI requires an explicit proxy for Telegram actions

Install steps are OS-specific:

- [SETUP_UBUNTU.md](SETUP_UBUNTU.md)
- [SETUP_WINDOWS.md](SETUP_WINDOWS.md)
- [SETUP_ARTIX.md](SETUP_ARTIX.md)
- [DOCKER.md](DOCKER.md) — optional all-in-one stack (no separate Mongo/Valkey install)

### Environment essentials

Copy `.env.example` to `.env` and set at minimum:

| Variable | Purpose |
|----------|---------|
| `SESSION_KEY` | 64-character hex key encrypting Telegram sessions in MongoDB |
| `MONGO_URI` | MongoDB connection string |
| `REDIS_HOST` / `REDIS_PORT` | BullMQ backend (Valkey on Artix — same protocol) |
| `API_BASIC_USER` / `API_BASIC_PASSWORD` | Dashboard and API login |

Generate `SESSION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Validate everything:

```bash
npm run setup
```

---

## Running the application

Build once:

```bash
npm run build:all
```

Run **three processes** (development or production):

| Process | Command (dev) | Command (prod) | Role |
|---------|---------------|----------------|------|
| API + dashboard | `npm run dev:api` | `npm run start:api` | HTTP, SPA, REST, Bull Board |
| Worker | `npm run dev:worker` | `npm run start:worker` | Sends messages from queues |
| Scheduler | `npm run dev:scheduler` | `npm run start:scheduler` | Counters, warm-up, inbox sync |

- **Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Queue monitor:** [http://localhost:3000/admin/queues](http://localhost:3000/admin/queues)
- **Health check:** `GET /health` (no auth)

If the worker or scheduler is not running, campaigns will enqueue jobs but messages will not leave the queue (or inbox sync will not run).

### Option B — Docker Compose

See [DOCKER.md](DOCKER.md). Summary:

```bash
npm run docker:doctor    # once: Docker running, buildx, group membership
npm run docker:sync-data # optional: copy host Mongo/Valkey data
npm run docker:build
npm run docker:up
```

Dashboard: **http://127.0.0.1:3048** (not 3000). For API on the host talking to Docker DBs, use `MONGO_URI=mongodb://127.0.0.1:27018/...` and `REDIS_HOST=127.0.0.1` + port **6380**.

Do not run native `mongod`/`valkey` and Docker with the **same data directories** at once.

---

## Dashboard walkthrough

Navigation: **Senders · MTProto · Contacts · Templates · Campaigns · Dialogs · Queues**

### Senders (`/accounts`)

Manage Telegram sessions that **send** mail.

- **Register phone** — creates a DB row; does not log into Telegram by itself. Attach a session via CLI or API afterward.
- **Import tdata / JSON** — import from Telegram Desktop or export files (server paths).
- **Bulk CSV import** — columns: `phone`, `label`, `role`, `sessionPath`, `proxyLabel` (paths on the API server).
- **Role dropdown** — `sender` (default) or `test_recipient`.
- **Status** — `new`, `warming`, `active`, `paused`, `quarantined`, `banned`.
- **Auto-assign MTProxy** — picks a free proxy matching the phone's country (one proxy per account).
- **Per-row actions** — pause/resume, send test, sync inbox, edit limits and sending window.

Login via CLI (recommended first time):

```bash
npm run cli -- auth login --proxy-id <proxyId>
```

### MTProto (`/proxies`)

Manage connection endpoints for senders.

- **MTProxy** — preferred; supports `dd...`, `ee...` (FakeTLS), and 32-hex secrets.
- **SOCKS5** — alternative type.
- **Country code** — ISO-2 (e.g. `DE`); used for auto-assign and policy checks.
- **Test proxy** — optional live check using a sender session (works for MTProto, SOCKS5, and HTTP transport).
- **Bulk import** — paste or upload CSV/JSON with `label`, `type`, `host`, `port`, `country`, `secret`, etc.
- **Test all** — runs connectivity test on every proxy in the database.

**Note:** Campaign **sending** still requires an **MTProxy** whose country matches the sender phone. SOCKS5/HTTP can be tested but are not used for outbound sends under current policy.

Add via CLI:

```bash
npm run cli -- proxies add-mtproto --host <ip> --port <n> --secret <hex> --country <ISO2>
```

You can paste a Telegram proxy link (`tg://proxy?...`) as the host field; the app parses it.

### Contacts (`/contacts`)

People you **message** in campaigns.

- Add one recipient manually (phone or `@username`).
- Import CSV or JSON (file upload or paste) with columns like `phone`, `firstName`, `lastName`, `username`, `tags`.
- Optional `defaultCountry` for phone normalization.
- Tag imports (e.g. `vip,launch`) for campaign audience filtering.
- Search and paginate the contact table.

Recipients are **not** Telegram login sessions.

### Templates (`/templates`)

Reusable message bodies. Create here or via CLI. See [Templates and spintax](#templates-and-spintax).

### Campaigns (`/campaigns`)

Create, start, pause, resume, view results, and verify campaigns.

- Pick **sending accounts** (multi-select or paste phone/@username/id list).
- Define **audience** by tags and/or explicit contact picks.
- Optional **homoglyphs** — random Latin/Cyrillic character substitution.
- **Results** — per-message status after a run.
- **Verify** — end-to-end delivery check using test recipient accounts.

### Dialogs (`/dialogs`)

Simulate natural Q&amp;A between two **senders** or between a sender and a **contact** (trusted recipient).

#### Using a preset (step by step)

A **preset** is a ready-made chat script (who says what, with pauses). It is **not** the same as **Templates** (campaign spintax on the Templates page) or **Use message templates** in the script builder (alternating Q/A templates).

**Fastest path**

1. **Dialogs** → card **Create dialog script** → section **1. Load a human dialog template**.
2. Pick e.g. `Preset: casual coffee check-in` → **Load into form** (lines A/B appear).
3. Scroll to **Start a session** → **Sender A** + **Sender B** (two senders for full chat).
4. **Dialog script or template** → choose the same preset (under *Built-in templates*).
5. **Create session** → in **Sessions** (right): **Start** or **Step**. For auto mode, run `dev:worker` + `dev:scheduler`.

**Also from the top of the page:** **Human dialog templates** → **Choose template** → preview → **Use in new session** (skips loading the builder).

**Optional:** **Add to library** saves the preset under **Saved scripts**. **Save script** in the builder after editing lines.

- **Human dialog templates** — 22 built-in casual scripts (EN + RU). Filter chips, preview, then **Use in new session** or **Add to library**.
- **Scripts** — manual turn list (`side` = `a` or `b`, `text`, delays) or **template pairs** (question/answer templates × rounds).
- **Sessions** — pick sender A, peer (another sender or contact), script, and **manual** or **automatic** run mode.
- **Step / Start** — executes the next message; auto mode uses the scheduler and `dialog-turn` queue.
- **Transcript** — shows sent turns and synced inbound messages; **read** badge when the account marked incoming mail read in Telegram (blue checks for the peer).

Side `b` with a **contact** peer only syncs inbox (no outbound from the contact). Use two senders for full two-way simulation.

Import script turns via CSV/JSON: columns `side`, `text`, `delaySecMin`, `delaySecMax`.

CLI (see **Dialog simulation** below):

```bash
npm run cli -- dialog scripts presets list
npm run cli -- dialog scripts presets apply-all
npm run cli -- dialog scripts list
npm run cli -- dialog sessions create --script <id> --account-a <ref> --peer-account <ref>
npm run cli -- dialog sessions start <sessionId>
```

---

## Typical workflows

### A. First sender and test message

1. Add an MTProxy on the MTProto page (or CLI).
2. Log in:
   ```bash
   npm run cli -- auth login --proxy-id <proxyId>
   ```
3. Confirm session on Senders page (status moves toward `warming`, then `active`).
4. Send test:
   ```bash
   npm run cli -- send-test --account <id> --to me --text "hello"
   ```

### B. Import audience and run a campaign

1. Import contacts (CSV on Contacts page or CLI):
   ```bash
   npm run cli -- contacts import recipients.csv
   ```
2. Create a template:
   ```bash
   npm run cli -- templates create --name welcome --body "Hi {firstName}, {thanks|cheers}!"
   ```
3. Ensure senders are `active` or `warming` with sessions and proxies.
4. Create and start campaign:
   ```bash
   npm run cli -- campaign create --name launch-1 --template <templateId> \
     --accounts <senderId1>,<senderId2> --tags launch
   npm run cli -- campaign start <campaignId>
   ```
5. Keep **worker** and **scheduler** running. Monitor Bull Board or campaign results.

### C. QA with test recipients

1. Log in extra accounts; set role to `test_recipient`:
   ```bash
   npm run cli -- accounts set-role <accountId> test_recipient
   ```
2. Import those phones as contacts (same numbers as the test accounts).
3. Run a small campaign to those contacts.
4. Verify:
   ```bash
   npm run cli -- campaign verify <campaignId>
   ```

See [Verify deliveries](#verify-deliveries) for how matching works.

---

## Accounts: roles, status, and limits

### Roles

| Role | Sends campaigns? | Inbox synced? | Use case |
|------|------------------|---------------|----------|
| `sender` | Yes | Yes (scheduler) | Production outbound accounts |
| `test_recipient` | Never | Yes (forced on verify) | QA — confirm messages arrived |

Setting `test_recipient` also ensures a matching contact row exists for that phone.

### Status lifecycle

```text
new  ──► warming  ──► active
              │           │
              │           ├── paused (manual)
              │           ├── quarantined (errors / PEER_FLOOD)
              │           └── banned (auth invalid / phone banned)
```

- **warming** — new sessions; run **one dialog script per calendar day** for **3 days** (account timezone), plus at most **1 campaign message/day** to new contacts. Scheduler runs lightweight `get_state` checks; promotes to **active** when `WARMUP_DAYS` have passed **and** three warm-up script days are recorded (`WARMUP_DAYS`, `WARMUP_MSGS_PER_DAY`, `WARMUP_SCRIPTS_PER_DAY` in `.env`).
- **paused** — manual stop; not eligible to send.
- **quarantined** — temporary block after severe errors.
- **banned** — session dead or phone banned; requires re-auth or removal.

### Sender eligibility for campaigns

A sender must satisfy **all** of:

- Saved session (`sessionEnc` not empty)
- Role `sender` (or unset, defaults to sender)
- Status `active` or `warming`
- Health score ≥ 0.5
- No active `floodWaitUntil` or `quarantineUntil`

If you start a campaign with no eligible senders, start fails with a detailed pool error.

### Health score

Rolling counters (`sent24h`, `failed24h`, `floodWait24h`, `peerFlood24h`) feed the score; the scheduler resets them daily per account timezone. **MTProxy transport errors** (timeouts, connection reset, TLS/proxy handshake failures mapped as `network`) are **not** counted as delivery failures for health, because they reflect connectivity, not the sender account itself. **Proxy policy** errors (no MTProxy assigned, wrong country) are also excluded.

After fixing a bad proxy, use **More → Restore health** on the Senders page (or `POST /api/accounts/:id/restore-health`) to clear the rolling counters and recompute the score so the account can rejoin the pool immediately.

### Per-account limits (editable on Senders page)

| Setting | Default (from `.env`) | Meaning |
|---------|----------------------|---------|
| `msgsToNew` / day | 80 | Cap on messages to new contacts per day |
| `ratePerHour` | 20 | Hourly send rate |
| Sending window | 09:00–22:00 | Local time window per account timezone |
| Timezone | `Europe/Moscow` | Used for window and daily reset |

The scheduler resets daily counters when the calendar day changes in each account's timezone.

---

## Proxies and MTProxy

**Policy:** one MTProxy (or proxy) per sending account. Auto-assign skips proxies already linked to another account and prefers higher `healthScore`.

**Country matching:** when assigning manually or automatically, proxy country should match the phone's country (derived from E.164).

**FakeTLS (`ee...` secrets):** included in `npm run setup:python` (`TelethonFakeTLS` in `python/requirements.txt`). After pulling updates, re-run `npm run setup:python` or rebuild the Docker image.

| Secret prefix | Transport |
|---------------|-----------|
| `dd...` | MTProxy randomized intermediate |
| `ee...` | FakeTLS (needs TelethonFakeTLS) |
| 32 hex chars | MTProxy abridged |

CLI Telegram commands (`auth login`, `send-test`, etc.) require `--proxy-id`, or `TELEGRAM_PROXY_ID`, or `TG_MTPROXY_*` in `.env`.

---

## Contacts and audience

### Import formats

**CSV** — header row with flexible column names:

```csv
phone,firstName,lastName,tags
+79991234567,Anna,,vip
@someuser,Bob,,launch
```

**JSON** — array of objects with the same fields.

Phone numbers are normalized to E.164 when possible (`defaultCountry` optional on API import). Usernames must match Telegram rules (5–32 chars, `[a-zA-Z][a-zA-Z0-9_]{3,31}`).

### Audience in campaigns

A campaign audience is the union of:

1. **Tags** — contacts whose `tags` array intersects the campaign tag list.
2. **Explicit contact IDs** — optional hand-picked recipients.

At least one contact must resolve or enqueue will produce nothing useful.

### Sticky sender

When a contact gets a first successful send from sender X:

- `assignedSenderId` is stored on the contact.
- Future campaigns reuse X if X is in the campaign's sender pool.
- If X is not in the pool, the link is cleared and a new sender is picked (even distribution among eligible senders).

---

## Templates and spintax

### Placeholders

| Token | Source |
|-------|--------|
| `{firstName}`, `{lastName}`, `{name}` | Contact fields |
| `{phone}` | `phoneE164` |
| `{username}` | Contact username |
| `{anyKey}` | `contact.extras.anyKey` from import |

### Spintax

- `{optionA|optionB|optionC}` — random choice.
- `{Joe,Moe}` — comma-separated choice (same mechanism).

Example:

```text
Hi {firstName}, {I'm reaching out|quick note} from {Acme|Our team}.
```

### Homoglyphs (campaign option)

When enabled on a campaign, some Latin letters may be replaced with visually similar Cyrillic characters at a configurable probability. This is a **variance** tool, not a guarantee against detection.

---

## Campaigns

### Lifecycle

```text
draft ──start──► running ──pause──► paused ──resume──► running
                    │
                    └── finished (all jobs processed) or failed (start error)
```

- **Start** resolves audience, validates sender pool eligibility, enqueues one job per contact (subject to dedup).
- **Pause** stops picking new jobs; in-flight jobs may still complete.
- **Resume** sets status back to running (does not re-enqueue already processed contacts unless logic re-triggers).

### Deduplication rules

1. **Same campaign + contact** — only one message per pair.
2. **Same contact + text hash globally** — identical rendered content is never sent twice to the same contact across campaigns.

### What happens when a job runs

1. Pick sticky/eligible sender from pool.
2. Render template for contact (spintax + placeholders + optional homoglyphs).
3. Check sending window, daily/hourly limits, health.
4. Send via Telethon bridge through account's proxy.
5. Record message status; on success, persist sender link.
6. On `FLOOD_WAIT` / `PEER_FLOOD` / auth errors — backoff, quarantine, or mark failed per error mapping.

Monitor progress: campaign **Results** in the dashboard, `GET /api/campaigns/:id/results`, or Bull Board queues.

---

## Verify deliveries

Verification answers: *"Did messages from this campaign show up in test recipients' inboxes?"*

**Requirements:**

- At least one account with role `test_recipient` and a saved session.
- Test recipient phones exist as **contacts** that received campaign messages.
- Worker/scheduler have had time to send; verify can force inbox sync.

**Process:**

1. Force-sync inbox for every `test_recipient` (marks dialogs read in Telegram).
2. For each **sent** message in the campaign, find the contact's phone.
3. Match a test account with the same phone.
4. Search stored `inbound_replies` for the rendered message text.

**CLI:**

```bash
npm run cli -- campaign verify <campaignId>
```

**API:** `POST /api/campaigns/:id/verify`

**Response fields:**

| Field | Meaning |
|-------|---------|
| `totalSent` | Messages marked sent in this campaign |
| `testRecipients` | Test accounts with sessions |
| `observable` | Sent messages where a matching test account exists |
| `verified` | Observable messages found in inbox sync |
| `missing` | Observable but not found (delivery or sync issue) |

Verification only covers contacts that have a corresponding `test_recipient` account. Production recipients without test accounts are not automatically verified.

---

## CLI reference

Invoke as `npm run cli -- <command>` or `npm run tg -- <command>`.

### Authentication

```text
auth login [-p +phone] [--proxy-id <id>] [--api-id <n>] [--api-hash <h>]
auth import-session -p +... -s <fileOrString> [--proxy-id <id>]
auth import-tdata -p +... --tdata <path> [--json <path>] [--proxy-id <id>]
auth import-json --json <path> [-p +...] [--proxy-id <id>]
auth import-mtp -p +... --dc <1-5> --auth-key-hex <512 hex> [--proxy-id <id>]
```

### Proxies

```text
proxies add-mtproto --host <host> --port <n> [--secret <hex>] [--country <ISO2>]
proxies list
```

### Accounts

```text
accounts list
accounts pause <id> | resume <id>
accounts set-role <id> <sender|test_recipient>
accounts verify-login [--accounts "<refs>"]
accounts sync-inbox [--accounts "<refs>"]
```

Account refs: internal MongoDB id, `+E.164` phone, or `@telegramUsername`.

### Messaging and data

```text
send-test --account <ref> --to <peer> --text "..."
contacts import <file.csv|json>
templates create --name <n> --body "..."
campaign create --name <n> --template <id> --accounts <ids> [--tags ...] [--homoglyphs]
campaign start <id> | pause <id> | resume <id> | stats <id> | verify <id>
```

### Dialog simulation

```text
dialog tick [--limit <n>] [--concurrency <n>] [--dry-run]

dialog scripts list | show <id> | delete <id>
dialog scripts create -n <name> --json <turns.json>
dialog scripts import -n <name> [--csv <file> | --json <file>]
dialog scripts presets list
dialog scripts presets list [--lang en|ru] [--category social|work|support|logistics]
dialog scripts presets show <slug>
dialog scripts presets apply <slug> [--replace]
dialog scripts presets apply-all [--replace]

dialog sessions list [--status <s>] [--limit <n>]
dialog sessions show <id>
dialog sessions create (--script <id> | --preset <slug>) --account-a <ref> [--peer-account <ref> | --peer-contact <id>] [--run-mode auto|manual]
dialog sessions start <id> | pause <id> | step <id> | stats
dialog sessions bulk-start [--status draft] [--run-mode auto] [--limit <n>]
```

Preset slugs (partial): `coffee-catchup`, `work-handoff`, `weekend-plans-ru`, `walk-after-work`, `movie-pick`, `delivery-ru`, `docs-check-ru`, … — run `npm run cli -- dialog scripts presets list` for the full list.

---

## REST API

Base URL: `http://localhost:3000/api`  
Auth: HTTP Basic (`API_BASIC_USER` / `API_BASIC_PASSWORD`)

### Accounts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/accounts` | List senders |
| POST | `/accounts` | Register shell account |
| PATCH | `/accounts/:id` | Update role, status, limits, proxy, device profile |
| DELETE | `/accounts/:id` | Remove account |
| POST | `/accounts/:id/session` | Attach encrypted session string |
| POST | `/accounts/:id/send-test` | Send one test message |
| POST | `/accounts/:id/inbound-replies/sync` | Force inbox sync |
| POST | `/accounts/:id/assign-mtproxy` | Manual or auto proxy assign |
| POST | `/accounts/:id/restore-health` | Reset rolling health counters and recompute score |
| POST | `/accounts/assign-mtproxy-auto` | Bulk auto-assign |
| POST | `/accounts/import-tdata` | Import Telegram Desktop session |
| POST | `/accounts/import-json` | Import JSON session export |
| POST | `/accounts/bulk-import` | CSV bulk import (`phone`, `sessionPath`, …) |

### Proxies, contacts, templates

| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PATCH/DELETE | `/proxies`, `/proxies/:id` | CRUD |
| POST | `/proxies/:id/test` | Live connectivity test |
| POST | `/proxies/import` | Bulk CSV/JSON import |
| POST | `/proxies/test-all` | Test every proxy |
| POST | `/contacts/import` | CSV or JSON body |
| GET | `/contacts` | List or paginate (`paginated=true`) |
| DELETE | `/contacts/:id` | Remove contact |
| GET/POST/DELETE | `/templates`, `/templates/:id` | CRUD |

### Campaigns and messages

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/campaigns` | List / create |
| POST | `/campaigns/:id/start` | Start |
| POST | `/campaigns/:id/pause` | Pause |
| POST | `/campaigns/:id/resume` | Resume |
| POST | `/campaigns/:id/verify` | Delivery verification |
| GET | `/campaigns/:id/results` | Per-message breakdown |
| GET | `/messages` | Filter by campaign, account, contact, status |
| GET | `/inbound-replies` | Synced dialog messages (`readAt` when marked read) |

### Dialog simulation

| Method | Path | Description |
|--------|------|-------------|
| GET/POST/DELETE | `/dialog-scripts`, `/dialog-scripts/:id` | Script CRUD |
| GET | `/dialog-scripts/presets` | List built-in templates (`?lang=en`, `?category=social`) |
| GET | `/dialog-scripts/presets/:slug` | Full template with all turns (preview) |
| POST | `/dialog-scripts/presets/apply` | Add one preset (`{ slug, replace? }`) |
| POST | `/dialog-scripts/presets/:slug/apply` | Add preset by URL slug |
| POST | `/dialog-scripts/presets/apply-all` | Add all presets (`replace` optional) |
| POST | `/dialog-scripts/import` | Import turns CSV/JSON |
| GET/POST | `/dialog-sessions` | List / create session (`scriptId` or `presetSlug`) |
| POST | `/dialog-sessions/:id/start` | Start (auto enqueues turns) |
| POST | `/dialog-sessions/:id/step` | Manual next turn |
| POST | `/dialog-sessions/:id/pause` | Pause |
| POST | `/dialog-sessions/:id/resume` | Resume auto |
| GET | `/dialog-sessions/:id/transcript` | Turns + inbound for UI |

### Other

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness (no auth) |
| GET | `/metrics` | Prometheus counters |
| — | `/admin/queues` | Bull Board UI |

---

## Scheduler background jobs

| Schedule | Task |
|----------|------|
| Every minute | Reset daily counters (per account timezone); sync inbound replies (batch) |
| Every 15 min | Warm-up `get_state` for `warming` accounts |
| Every 5 min | Promote `warming` → `active` when 3 warm-up script days are done and `warmingFinishesAt` has passed |

Inbound sync stores recent dialog text in `inbound_replies` for analytics and verification.

---

## Troubleshooting

### Campaign won't start — "No eligible sending account"

Check each sender in the pool on the Senders page:

- Has a session (logged in or imported)?
- Status `active` or `warming` (not `paused` / `quarantined`)?
- Role `sender`?
- Health score not below 0.5?
- No active flood-wait or quarantine timestamp?

The error message lists per-account reasons.

### Messages stuck in `queued`

- Is **worker** running?
- Is Redis reachable?
- Check Bull Board for failed jobs and retry counts.
- Sender in flood-wait? Check account row and logs.

### `FROZEN_METHOD_INVALID` on send or login

Telegram may restrict new or recently changed sessions until you use the **official Telegram app** (mobile/desktop), complete verification prompts, and wait. See [TELEGRAM_SPAM_AND_LIMITS.md](TELEGRAM_SPAM_AND_LIMITS.md#frozen-sessions-frozen_method_invalid).

### Auth errors / `banned` status

- Session revoked or phone banned — re-import or replace account.
- `api_id` / `api_hash` must match the app that created the session.

### Proxy errors

- One proxy per account — resolve conflicts on MTProto page.
- Country mismatch — proxy ISO-2 must match phone country for assign.
- Test proxy from dashboard with a sender that has a session.

### Verify shows `missing` > 0

- Test recipient role and phone match contact phone exactly?
- Campaign message status `sent` (not failed)?
- Allow time for send + sync; run verify again.
- Text mismatch if homoglyphs/spintax differ between send and stored reply.

### Production won't start

With `NODE_ENV=production`, default credentials (`admin` / `changeme`) and passwords shorter than 12 characters are rejected. Set strong `API_BASIC_*` values.

### Setup doctor fails

```bash
npm run setup
```

Fixes: valid `SESSION_KEY`, Mongo running, Valkey/Redis PONG (`valkey-cli ping` or `redis-cli ping`), Telethon importable (`npm run setup:python`).

### API error `ECONNREFUSED 127.0.0.1:27017`

MongoDB is not running. On Artix: `npm run mongod:local` or see [SETUP_ARTIX.md](SETUP_ARTIX.md). If data was used by Docker, fix ownership: `sudo chown -R "$USER:$USER" ~/var/mongodb/data ~/var/mongodb/logs`.

### Docker Mongo exits immediately (exit 62)

Host data is MongoDB **8.x** but the image was `mongo:7`. Use `mongo:8.2` in `docker-compose.yml` or a fresh volume. See [DOCKER.md](DOCKER.md).

### Dialog presets dropdown empty

API must be running and reachable. Check browser auth, then `GET /api/dialog-scripts/presets`. Restart `dev:api` after upgrades.

---

## Safety and compliance

This software **slows down and observes** bulk sending; it does **not** make unsolicited mass messaging safe or permitted.

- Respect recipient consent and local law (marketing, privacy, telecom rules).
- Follow [Telegram Terms of Service](https://telegram.org/tos).
- Use separate proxies per sender, conservative limits, and warm-up for new accounts.
- Test with `test_recipient` accounts before large audiences.

Technical background: [TELEGRAM_SPAM_AND_LIMITS.md](TELEGRAM_SPAM_AND_LIMITS.md).

---

## Related docs

- [README](../README.md) — project overview and quick start
- [SETUP_UBUNTU.md](SETUP_UBUNTU.md) · [SETUP_WINDOWS.md](SETUP_WINDOWS.md) · [SETUP_ARTIX.md](SETUP_ARTIX.md)
- [DOCKER.md](DOCKER.md)
- [TELEGRAM_SPAM_AND_LIMITS.md](TELEGRAM_SPAM_AND_LIMITS.md)
