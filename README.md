# tg-send-mult

Multi-account Telegram bulk-sender service (MTProto via Telethon) with a Node.js
backend, a Vuetify dashboard, and BullMQ-based queues. Supports per-account
proxies, anti-spam pacing, sticky receiver–sender binding, dialog-aware inbox
sync, and end-to-end campaign verification.

> Local-only by default. The repo does not ship Docker/Compose. You bring your
> own MongoDB and Redis (local or hosted).

---

## Stack

- **Node.js 20 + TypeScript 5** — server / worker / scheduler / CLI
- **MTProto via Telethon** — `python/tg_worker/run.py`, called from Node over
  stdio JSON. Supports MTProxy (`dd...` and FakeTLS `ee...` via TelethonFakeTLS),
  SOCKS5, and direct connection.
- **MongoDB 7 + Mongoose** — accounts, contacts, campaigns, messages, proxies,
  delivery events, inbound replies.
- **Redis 7 + BullMQ** — per-account send queues + Bull Board UI.
- **Fastify v5** — API (Basic Auth) + static dashboard.
- **Nuxt 3 + Vuetify 3** — SPA dashboard, served from `src/apps/api/public`.
- **Vitest** — 140+ unit tests, no live Telegram required.

---

## Setup by OS

Pick the guide that matches your machine, finish it, then jump to the
[End-to-end test workflow](#end-to-end-test-workflow) below.

- Ubuntu / Debian: [docs/SETUP_UBUNTU.md](docs/SETUP_UBUNTU.md)
- Windows 10 / 11 (PowerShell): [docs/SETUP_WINDOWS.md](docs/SETUP_WINDOWS.md)
- Artix Linux (OpenRC): [docs/SETUP_ARTIX.md](docs/SETUP_ARTIX.md)

All three guides follow the same shape:
1. Install Node 20+, Python 3, MongoDB, Redis.
2. Create `python/.venv` and install Telethon (`npm run setup:python`).
3. Fill `.env` (`SESSION_KEY`, MongoDB / Redis URIs, dashboard credentials).
4. Build (`npm run build:all`) and run the three dev processes.

---

## Concepts

### Account roles
Every Telegram account in the DB has a `role`:

- **`sender`** (default) — used for delivering campaigns. Eligible for the
  campaign sender pool.
- **`test_recipient`** — never sends. Used for verifying that messages actually
  arrived: its inbox is force-synced and matched against campaign sends.

Set/change the role in the dashboard (Senders page) or via CLI:

```bash
npm run cli -- accounts set-role <accountId> test_recipient
```

### Sticky receiver–sender binding
A receiver is bound to a sender on first delivery. Future campaigns reuse the
same sender for that contact, so a receiver never sees messages from two
different sender accounts. Implemented in
`src/modules/multi/stickyAssignment.ts`.

### Cross-campaign deduplication
Identical text + recipient is never sent twice — even across campaigns. The
project plan’s rule "хеширование текста + userId" is enforced in
`campaignEnqueue.ts`.

### Dialog-aware inbox sync
A scheduler tick periodically pulls each sender's recent dialogs (incoming and
outgoing messages) into MongoDB (`inbound_replies` collection). Force-sync from
CLI or web also marks dialogs as read in Telegram so the receiver sees blue
checks (imitates a normal user reading conversations).

### MTProxy with FakeTLS
The bridge picks the correct Telethon transport per secret type:

| Secret prefix | Transport                                       |
|---------------|-------------------------------------------------|
| `dd...`       | `ConnectionTcpMTProxyRandomizedIntermediate`    |
| `ee...`       | `TelethonFakeTLS.ConnectionTcpMTProxyFakeTLS` (requires `pip install TelethonFakeTLS` in `python/.venv`) |
| `32 hex`      | `ConnectionTcpMTProxyAbridged`                  |

---

## End-to-end test workflow

Goal: prove that messages actually reach receivers.

1. **Login senders.** Use `auth login`, `auth import-session`, or
   `auth import-tdata` to add real Telegram accounts that will send.
2. **Login test recipients.** Same import flow, but mark each account as
   `test_recipient`:
   ```bash
   npm run cli -- accounts set-role <accountId> test_recipient
   ```
   Or use the role dropdown on the Senders page in the dashboard.
3. **Add the same phones as contacts.** Import a CSV with the test recipient
   phones (E.164) so they appear in `contacts`. Tag them e.g. `qa`.
4. **Create a campaign with that audience.**
   ```bash
   npm run cli -- templates create --name welcome --body "hi {firstName}, {Joe,Moe} here"
   npm run cli -- campaign create --name qa-run --template <templateId> \
     --accounts <senderId1>,<senderId2> --tags qa
   npm run cli -- campaign start <campaignId>
   ```
5. **Run dev processes** so the campaign is dispatched:
   ```bash
   npm run dev:api
   npm run dev:worker
   npm run dev:scheduler
   ```
6. **Verify delivery** when the campaign finishes (CLI):
   ```bash
   npm run cli -- campaign verify <campaignId>
   ```
   Or web: open Campaigns → Verify on the campaign row. Verify forces an inbox
   sync on every test_recipient and prints how many messages from this campaign
   were observed in their dialogs.

The output looks like:
```json
{
  "campaignId": "...",
  "totalSent": 2,
  "testRecipients": 2,
  "observable": 2,
  "verified": 2,
  "missing": 0
}
```

---

## CLI

```text
tg auth login [-p +phone] [--proxy-id <id>] [--api-id <n>] [--api-hash <h>]
tg auth import-session -p +... -s <fileOrString> [--proxy-id <id>]
tg auth import-tdata -p +... --tdata <path> [--json <path>] [--proxy-id <id>]
tg auth import-json --json <path> [-p +...] [--proxy-id <id>]
tg auth import-mtp -p +... --dc <1-5> --auth-key-hex <512 hex>
tg proxies add-mtproto --host <ip|domain> --port <n> [--secret <hex>] [--country <ISO2>]
tg proxies list
tg accounts list | pause <id> | resume <id>
tg accounts set-role <id> <sender|test_recipient>
tg accounts verify-login [--accounts "<refs>"]
tg accounts sync-inbox [--accounts "<refs>"]   # force inbox read + mark-read
tg send-test --account <ref> --to <peer> --text "..."
tg contacts import <file.csv|json>
tg templates create --name <n> --body "..."
tg campaign create --name <n> --template <id> --accounts <ids> [--tags ...] [--homoglyphs]
tg campaign start <id> | pause <id> | resume <id> | stats <id>
tg campaign verify <id>                        # E2E delivery check
```

Templates support placeholders and choice spintax:
- `{firstName}`, `{lastName}`, `{name}`, `{phone}`, `{username}`, plus any
  field from `contact.extras`.
- `{A|B|C}` and `{Joe,Moe}` randomly pick one option per render.

---

## REST API

Mount: `/api`, Basic Auth from `.env`.

Highlights:

- `GET /api/accounts`, `POST /api/accounts`, `PATCH /api/accounts/:id`
  — supports `role: "sender" | "test_recipient"`.
- `POST /api/accounts/:id/send-test` — quick deliverability check from a sender.
- `POST /api/accounts/:id/inbound-replies/sync` — force inbox read + mark-read
  for one account.
- `POST /api/accounts/:id/assign-mtproxy` / `POST /api/accounts/assign-mtproxy-auto`.
- `GET /api/inbound-replies?accountId=...&limit=...` — read what was captured.
- `POST /api/campaigns`, `GET /api/campaigns`.
- `POST /api/campaigns/:id/start` | `pause` | `resume`.
- `POST /api/campaigns/:id/verify` — runs the same flow as the CLI verify.
- `GET /api/messages` — paginated (with `paginated=true&skip=&limit=`).
- `GET /metrics` — Prometheus-style counters.

BullMQ board: `/admin/queues`.

---

## Architecture

```
src/
  apps/
    api/         Fastify HTTP API + static SPA mount + Bull Board
    worker/      BullMQ workers per account (refreshed dynamically)
    scheduler/   cron: daily counter reset, warm-up, inbound replies tick
    cli/         commander.js CLI (auth, proxies, accounts, campaigns, ...)
  modules/
    auth/        login + session imports (gramJS, Telethon, tdata, JSON, MTProto)
    messaging/   campaignEnqueue, campaignLifecycle, send, syncInboundReplies, verifyCampaign
    multi/       dispatcher (load-aware), stickyAssignment (receiver→sender)
    proxy/       MTProxy policy + country matching
    antilimit/   jitter + sending window guards
    template/    spintax + homoglyph mixer
    contacts/    CSV/JSON import + audience resolver
    dedup/       text hashing
  telegram/     Telethon bridge wrapper, MTProxy normalization, error mapping
  queue/        BullMQ queues + send job processor (FLOOD_WAIT, retries, etc.)
  db/models/    Mongoose schemas
  config/       Zod-validated environment
  util/         shutdown, CLI validators, mongo error helpers
python/
  tg_worker/run.py     Telethon bridge (do not change for the test workflow)
  requirements.txt
web/
  pages/        Vuetify SPA (Senders, Proxies, Contacts, Templates, Campaigns)
  composables/  useApi, useToast, useConfirm, usePolling
tests/         Vitest suites (no live Telegram)
docs/          Setup guides + Telegram limits notes
```

---

## Risks and limits

- Telegram aggressively detects bulk sending. Use:
  - separate per-account proxies (preferably MTProxy in the receiver country),
  - warm-up (`status: warming` is auto-promoted by the scheduler),
  - jittered delays + per-account sending windows,
  - per-account daily caps,
  - homoglyph mixer (Latin/Cyrillic lookalikes) and template spintax to avoid
    identical text.
- `FLOOD_WAIT_X`, `PEER_FLOOD`, `AUTH_KEY_UNREGISTERED`, `PHONE_NUMBER_BANNED`
  are all classified into a domain error type and handled accordingly
  (delay / quarantine / ban). See `src/telegram/errors.ts` and
  `tests/telegram/bridgeErrorToDomain.test.ts`.
- Sessions are encrypted with AES-256-GCM under `SESSION_KEY` (32 bytes hex).

See [docs/TELEGRAM_SPAM_AND_LIMITS.md](docs/TELEGRAM_SPAM_AND_LIMITS.md) for
behavioral guidance.

---

## Development

```bash
npm install
cd web && npm install && cd ..
npm run setup:python
cp .env.example .env
# edit .env (SESSION_KEY at minimum)

npm run setup        # validate env + Mongo + Redis
npm run build:all
npm test
npm run lint
npm run typecheck
```

Three terminals to run the service:

```bash
npm run dev:api
npm run dev:worker
npm run dev:scheduler
```

Dashboard: <http://localhost:3000>. BullMQ UI: <http://localhost:3000/admin/queues>.
