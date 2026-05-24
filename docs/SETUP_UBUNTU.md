# Setup on Ubuntu / Debian

Tested on Ubuntu 22.04 and 24.04. Equivalent steps work on Debian 12+.

---

## 1. Base packages

```bash
sudo apt update
sudo apt install -y curl git build-essential python3 python3-venv python3-pip
```

### Node.js 20

Use NodeSource or `nvm`. NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x
```

---

## 2. Redis

```bash
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping     # PONG
```

`/etc/redis/redis.conf` is bound to `127.0.0.1:6379` by default. If you set
`requirepass`, mirror it in `.env` as `REDIS_PASSWORD`.

---

## 3. MongoDB 7

Ubuntu's repo does not ship MongoDB. Add the official repo:

```bash
sudo apt install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
  | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
mongosh mongodb://127.0.0.1:27017/tg_send_mult --eval 'db.runCommand({ping:1})'
```

Atlas is fine too — set `MONGO_URI` accordingly.

---

## 4. Clone + install JS deps

```bash
git clone <your fork or this repo>
cd tg-send-mult
npm install
cd web && npm install && cd ..
```

---

## 5. Python venv (Telethon bridge)

```bash
npm run setup:python
```

This creates `python/.venv` and installs `python/requirements.txt` (Telethon,
cryptography, etc).

If you plan to use **MTProxy with FakeTLS (`ee...` secrets)**, install the
optional package into the venv:

```bash
python/.venv/bin/pip install TelethonFakeTLS
```

If your venv lives elsewhere, set `TG_PYTHON=/full/path/to/venv/bin/python` in
`.env`.

---

## 6. `.env`

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the printed line into `SESSION_KEY=`. Then in `.env`:

- `MONGO_URI=mongodb://127.0.0.1:27017/tg_send_mult`
- `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`, `REDIS_PASSWORD=` (or your value)
- `API_BASIC_USER=admin`, `API_BASIC_PASSWORD=<choose>` (don't keep defaults
  in production)
- Optional global Telegram fallback: `TG_API_ID=`, `TG_API_HASH=`. Prefer
  per-account API id/hash via the dashboard or import.
- Optional global MTProxy fallback (if you don't want to pass `--proxy-id` every
  time): `TG_MTPROXY_HOST`, `TG_MTPROXY_PORT`, `TG_MTPROXY_SECRET`,
  `TG_MTPROXY_COUNTRY`.

Sanity-check:

```bash
npm run setup
```

It validates `.env`, Mongo, and Redis.

---

## 7. Build + run

```bash
npm run build:all
npm test
```

Three terminals:

```bash
npm run dev:api
npm run dev:worker
npm run dev:scheduler
```

- Dashboard: <http://localhost:3000> (Basic Auth from `.env`)
- BullMQ UI: <http://localhost:3000/admin/queues>

---

## 8. First account + send-test

```bash
npm run cli -- auth login            # interactive (phone, code, 2FA)
npm run cli -- accounts list
npm run cli -- send-test --account <id> --to me --text "hello"
```

Once that works, continue with the [User guide](USER_GUIDE.md) (dashboard
workflows, campaigns, verification) or the
[End-to-end test workflow](../README.md#end-to-end-verification-workflow) in the README.
