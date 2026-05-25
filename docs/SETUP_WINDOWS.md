# Setup on Windows 10 / 11

All commands below assume **PowerShell 7+**. If you prefer WSL, follow
[SETUP_UBUNTU.md](SETUP_UBUNTU.md) inside the WSL distribution instead.

**Alternative:** [DOCKER.md](DOCKER.md) — full stack in containers (dashboard **http://127.0.0.1:3048**).

---

## 1. Tooling

Install once via [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install Git.Git
```

Verify:

```powershell
node -v        # v20.x
python --version
git --version
```

---

## 2. Redis

Native Redis on Windows is officially deprecated, but two production-grade
options work well:

### Option A — Memurai (recommended for Windows)

[Memurai](https://www.memurai.com/) is a Redis-compatible Windows server.

```powershell
winget install Memurai.MemuraiDeveloper
```

It registers a Windows service. Test:

```powershell
"PING" | redis-cli
# or via Memurai Tools shortcut
```

### Option B — Redis under WSL2

```powershell
wsl --install -d Ubuntu
```

Then inside WSL:

```bash
sudo apt update && sudo apt install -y redis-server
sudo service redis-server start
redis-cli ping     # PONG
```

In Windows `.env` set `REDIS_HOST=127.0.0.1` if WSL forwards localhost (Windows
11 does so by default for `localhost`), or use the WSL IP from `wsl hostname -I`.

---

## 3. MongoDB 7

Install MongoDB Community as a service:

```powershell
winget install MongoDB.Server
```

The installer creates the `MongoDB` Windows service listening on `127.0.0.1:27017`.
Verify:

```powershell
"db.runCommand({ping:1})" | mongosh mongodb://127.0.0.1:27017/tg_send_mult
```

(Or use MongoDB Atlas and set `MONGO_URI` accordingly.)

---

## 4. Clone + install JS deps

```powershell
git clone <your fork or this repo>
cd tg-send-mult
npm install
cd web ; npm install ; cd ..
```

---

## 5. Python venv (Telethon bridge)

```powershell
npm run setup:python
```

This creates `python\.venv` and installs `python\requirements.txt`.

FakeTLS MTProxy (`ee...` secrets) is installed automatically via `npm run setup:python`.

If `TG_PYTHON` in `.env` is left blank or set to `python` / `python3`, the
bridge auto-detects `python\.venv\Scripts\python.exe`. Otherwise, set
`TG_PYTHON=C:\path\to\python\.venv\Scripts\python.exe`.

> Pure path note: keep `TG_PYTHON` value double-escaped or single-quoted, e.g.
> `TG_PYTHON=C:/Users/you/repo/python/.venv/Scripts/python.exe` (forward
> slashes work in `.env` and avoid escaping issues).

---

## 6. `.env`

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the hex line into `SESSION_KEY=` in `.env`. Then set:

- `MONGO_URI=mongodb://127.0.0.1:27017/tg_send_mult`
- `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`, `REDIS_PASSWORD=` (or your value
for Memurai/WSL Redis)
- `API_BASIC_USER` and `API_BASIC_PASSWORD` (do not keep `admin/changeme`)
- Optional global Telegram fallback: `TG_API_ID=`, `TG_API_HASH=`. Prefer
per-account.

Sanity-check:

```powershell
npm run setup
```

---

## 7. Build + run

```powershell
npm run build:all
npm test
```

Three PowerShell terminals (or use Windows Terminal panes):

```powershell
npm run dev:api
npm run dev:worker
npm run dev:scheduler
```

- Dashboard: [http://localhost:3000](http://localhost:3000) (Basic Auth from `.env`)
- BullMQ UI: [http://localhost:3000/admin/queues](http://localhost:3000/admin/queues)

---

## 8. First account + send-test

```powershell
npm run cli -- auth login
npm run cli -- accounts list
npm run cli -- send-test --account <id> --to me --text "hello"
```

Then continue with the [User guide](USER_GUIDE.md) or the
[End-to-end verification workflow](../README.md#end-to-end-verification-workflow) in the README.

---

## Troubleshooting

- `**mongosh`/`redis-cli` not found.** Install Mongo Shell separately (`winget install MongoDB.Shell`) or use Memurai Tools.
- **Telethon import errors at first run.** Re-run `npm run setup:python`. On
some Windows installs you may need
`python\.venv\Scripts\pip.exe install --upgrade pip`.
- **Long path errors (Telethon, web build).** Enable long paths:
`git config --system core.longpaths true` and the Windows long-path policy
in `gpedit.msc` (or via registry).
- **Anti-virus quarantining `.venv`.** Add the repo folder as an exclusion.

