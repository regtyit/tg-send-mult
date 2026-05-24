# Infrastructure on Artix Linux (OpenRC)

This project needs **Node.js 20+**, **MongoDB**, and **Valkey** (or Redis — same protocol) running somewhere reachable from your machine. Below is a typical **local** setup on **Artix** (pacman + **OpenRC**, no systemd).

If you already use MongoDB Atlas or a remote Valkey/Redis, skip the install sections and only set `MONGO_URI` / `REDIS_`* in `.env`.

---

## 1. Base packages

```bash
sudo pacman -Syu
sudo pacman -S git nodejs npm valkey
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

## 2. Valkey (BullMQ backend)

The app speaks the **Redis protocol** (`REDIS_*` in `.env`). On Artix use **[Valkey](https://valkey.io/)** (drop-in; package may also install `redis-cli` as a compatibility shim):

```bash
sudo pacman -S valkey
```

Default listen address is in `/etc/valkey/valkey.conf` (`127.0.0.1:6379`, data in `/var/lib/valkey/`). For local dev, defaults match `.env.example`.

**OpenRC — start now and on boot:**

```bash
sudo rc-update add valkey default
sudo rc-service valkey start
sudo rc-service valkey status
```

Test:

```bash
valkey-cli ping
```

Expect `PONG`.

**`.env` (unchanged variable names — point at Valkey on localhost):**

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
```

If you set `requirepass` in `valkey.conf`, put the same value in `REDIS_PASSWORD`.

> **Redis instead of Valkey:** `sudo pacman -S redis` works the same way (`redis-cli ping`, `REDIS_HOST=127.0.0.1`).

---

## 3. MongoDB

Official Arch repos often **do not** ship MongoDB; on Artix you usually use the **AUR** or run Mongo in a container.

### Option A — AUR `mongodb-bin` (common on Arch-based systems)

With `paru` or `yay`:

```bash
paru -S mongodb-bin
# or: yay -S mongodb-bin
```

This often installs **MongoDB 8.x**. Docker Compose in this repo uses image **`mongo:8.2`** when you bind-mount the same data directory.

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

Shortcut from the repo (foreground):

```bash
npm run mongod:local
```

**If `mongod` exits immediately** — check `~/var/mongodb/logs/mongod.log`. Common after Docker Compose:

```text
Unable to read the storage engine metadata file ... storage.bson
```

Data files are owned by uid **999** (container user). Fix ownership once, then start again:

```bash
sudo chown -R "$USER:$USER" ~/var/mongodb/data ~/var/mongodb/logs
npm run mongod:local
```

Do **not** run native `mongod` and Docker `mongo` on the same `MONGO_DATA_DIR` at the same time.

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

### Option C — Docker Compose (full stack)

See **[DOCKER.md](DOCKER.md)** — `docker compose` runs MongoDB, Valkey, API, worker, and scheduler. Dashboard: **http://127.0.0.1:3048**. Bind your existing data with `MONGO_DATA_DIR` and `VALKEY_DATA_DIR` in `.env` (`npm run docker:sync-data` copies `/var/lib/valkey/dump.rdb`).

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

**Sanity-check `.env` + Mongo + Valkey** (run anytime after filling `.env`):

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

If you bind the API to `0.0.0.0` and use a host firewall, open only the port you need (default **3000**). MongoDB and Valkey should stay on **127.0.0.1** for a single-machine dev setup.

---

## Quick checklist


| Piece               | Role                          | Typical local check                                  |
| ------------------- | ----------------------------- | ---------------------------------------------------- |
| Valkey              | BullMQ queues                 | `valkey-cli ping` → `PONG`                           |
| MongoDB             | Accounts, campaigns, contacts | `mongosh` connection OK                              |
| `.env`              | App secrets + service URLs    | No placeholder `SESSION_KEY`; `npm run setup` passes |
| `npm run setup`     | Validates env + Mongo + Valkey | All three checks OK                                  |
| `npm run build:all` | Compiles TS + web             | Completes without errors                             |
| Three dev processes | API, worker, scheduler        | Dashboard loads                                      |


If something fails, check: Valkey/Mongo really listening on the host/port in `.env`, and that `SESSION_KEY` is 64 hex characters.

---

## Next steps

After the dashboard loads, read the [User guide](USER_GUIDE.md) for senders,
contacts, campaigns, and delivery verification.