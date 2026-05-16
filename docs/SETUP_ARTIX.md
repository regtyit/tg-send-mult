# Infrastructure on Artix Linux (OpenRC)

This project needs **Node.js 20+**, **MongoDB**, and **Redis** running somewhere reachable from your machine. Below is a typical **local** setup on **Artix** (pacman + **OpenRC**, no systemd).

If you already use MongoDB Atlas or a remote Redis, skip the install sections and only set `MONGO_URI` / `REDIS_`* in `.env`.

---

## 1. Base packages

```bash
sudo pacman -Syu
sudo pacman -S git nodejs npm redis
```

Check Node version (need ≥ 20):

```bash
node -v
```

If your repos ship an older Node, use [nvm](https://github.com/nvm-sh/nvm) or another Node 20+ install method.

### Python 3 + Telethon (MTProto bridge)

Node shells out to `python/tg_worker/run.py` using **Telethon**. Arch enables **PEP 668**: do not `pip install` into the system interpreter — use a **venv** under the repo:

```bash
sudo pacman -S python
cd /path/to/tg-send-mult
npm run setup:python
```

This creates `python/.venv` and installs `python/requirements.txt`. The Node bridge uses that interpreter automatically when `TG_PYTHON` is the default `python3` / `python`. Override with `TG_PYTHON=/full/path/to/python` in `.env` if needed.

If you plan to use **FakeTLS MTProxy (`ee...` secrets)**, install the optional package into the same venv:

```bash
python/.venv/bin/pip install TelethonFakeTLS
```

---

## 2. Redis

Install (if not already):

```bash
sudo pacman -S redis
```

Default listen address is in `/etc/redis/redis.conf` (usually `127.0.0.1:6379`). For local dev, defaults match the project’s `.env.example`.

**OpenRC — start now and on boot:**

```bash
sudo rc-update add redis default
sudo rc-service redis start
sudo rc-service redis status
```

Test:

```bash
redis-cli ping
```

Expect `PONG`.

`**.env` (Redis block — defaults are fine for local):**

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
```

If you set `requirepass` in `redis.conf`, put the same value in `REDIS_PASSWORD`.

---

## 3. MongoDB

Official Arch repos often **do not** ship MongoDB; on Artix you usually use the **AUR** or run Mongo in a container.

### Option A — AUR `mongodb-bin` (common on Arch-based systems)

With `paru` or `yay`:

```bash
paru -S mongodb-bin
# or: yay -S mongodb-bin
```

The package may include a **systemd** unit only. On OpenRC you can still run the daemon manually or write a small service. **Simplest for development:** run `mongod` in a terminal.

Create a data directory and config directory (your user can own these):

```bash
mkdir -p ~/var/mongodb/{data,logs}
```

Minimal config file `~/var/mongodb/mongod.conf`:

```yaml
storage:
  dbPath: /home/YOUR_USER/var/mongodb/data
systemLog:
  destination: file
  path: /home/YOUR_USER/var/mongodb/logs/mongod.log
net:
  bindIp: 127.0.0.1
  port: 27017
```

Replace `YOUR_USER` with your username (or use `$HOME` after expanding paths). Start:

```bash
mongod --config ~/var/mongodb/mongod.conf
```

Leave this terminal open, or add an OpenRC `mongod` script later if you want it supervised.

`**.env` (Mongo — matches default URI in the project):**

```env
MONGO_URI=mongodb://127.0.0.1:27017/tg_send_mult
```

The database name `tg_send_mult` is created on first use.

Optional CLI:

```bash
mongosh mongodb://127.0.0.1:27017/tg_send_mult
```

### Option B — MongoDB Atlas (cloud)

Create a free cluster, allow your IP (or `0.0.0.0/0` for testing only), get the SRV connection string, and set:

```env
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/tg_send_mult?retryWrites=true&w=majority
```

### Option C — Podman/Docker

If you prefer containers, run official MongoDB and Redis images and point `.env` at the published ports (`27017`, `6379`). The repo does not ship compose files; this is entirely optional.

---

## 4. Fill `.env`

From the project root:

```bash
cp .env.example .env
```

1. `TG_API_ID` / `TG_API_HASH` (optional in `.env`) — fallback Telegram **app** credentials. Prefer **per-account** `telegramApiId` / `telegramApiHash` in the dashboard, API, or `auth import-json` / `--api-id` / `--api-hash`. The session **must** match the same `app_id` / `app_hash` pair you store for that sender.
2. `SESSION_KEY` — generate a **new** 32-byte hex key (do not use the example zeros in production):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Paste the **single line** into `SESSION_KEY`.
3. `MONGO_URI` — as in section 3 (local or Atlas).
4. `REDIS_*` — as in section 2.
5. `API_BASIC_USER` / `API_BASIC_PASSWORD` — choose credentials for the dashboard (`http://localhost:3000`). Do not leave `admin/changeme` in production.
6. Leave other variables as in `.env.example` unless you know you need to change them.

Telegram **phone / auth key / DC / user id** are **not** set in `.env`; import the account after services are up:

```bash
npm run cli -- auth import-mtp -p '+...' --dc <n> --auth-key-hex '<hex>' [--user-id '<id>']
```

**Sanity-check `.env` + Mongo + Redis** (run anytime after filling `.env`):

```bash
npm run setup
```

---

## 5. Build and run the project

Install JS dependencies and build (API + dashboard):

```bash
cd /path/to/tg-send-mult
npm install
cd web && npm install && cd ..
npm run setup
npm run build:all
```

**Check tests** (no Mongo/Redis required):

```bash
npm test
```

**Terminal 1 — API + static dashboard:**

```bash
npm run dev:api
```

**Terminal 2 — worker:**

```bash
npm run dev:worker
```

**Terminal 3 — scheduler:**

```bash
npm run dev:scheduler
```

- Dashboard: `http://localhost:3000` (Basic Auth from `.env`)
- BullMQ UI: `http://localhost:3000/admin/queues`

**First-time Telegram account** (interactive login instead of import):

```bash
npm run cli -- auth login
npm run cli -- accounts list
npm run cli -- auth import-tdata -p +14155552671 --tdata "/path/to/Telegram Desktop/tdata"
```

---

## 6. Firewall (optional)

If you bind the API to `0.0.0.0` and use a host firewall, open only the port you need (default **3000**). MongoDB and Redis should stay on **127.0.0.1** for a single-machine dev setup.

---

## Quick checklist


| Piece               | Role                          | Typical local check                                  |
| ------------------- | ----------------------------- | ---------------------------------------------------- |
| Redis               | BullMQ queues                 | `redis-cli ping` → `PONG`                            |
| MongoDB             | Accounts, campaigns, contacts | `mongosh` connection OK                              |
| `.env`              | App secrets + service URLs    | No placeholder `SESSION_KEY`; `npm run setup` passes |
| `npm run setup`     | Validates env + Mongo + Redis | All three checks OK                                  |
| `npm run build:all` | Compiles TS + web             | Completes without errors                             |
| Three dev processes | API, worker, scheduler        | Dashboard loads                                      |


If something fails, check: Redis/Mongo really listening on the host/port in `.env`, and that `SESSION_KEY` is 64 hex characters.