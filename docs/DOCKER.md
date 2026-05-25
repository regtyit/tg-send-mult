# Docker Compose (local deploy)

Run the full stack (MongoDB, **Valkey**, API, worker, scheduler) on **localhost** with the dashboard at **http://127.0.0.1:3048**.

**See also:** [USER_GUIDE.md](USER_GUIDE.md) (operations) · [SETUP_ARTIX.md](SETUP_ARTIX.md) (native Mongo/Valkey on Artix)

## npm scripts

| Command | Purpose |
|---------|---------|
| `npm run docker:doctor` | Docker daemon, buildx, `docker` group |
| `npm run docker:sync-data` | Copy host `dump.rdb` / hint for Mongo paths |
| `npm run docker:build` | Build app image |
| `npm run docker:up` | Start stack detached |
| `npm run docker:ps` | Container status |
| `npm run docker:logs` | Follow logs |
| `npm run docker:down` | Stop and remove containers |

The app uses **BullMQ** over the Redis protocol (`REDIS_*` in `.env`). [Valkey](https://valkey.io/) is a drop-in replacement — no code changes. On the host (Artix) you may run `valkey` instead of `redis`; inside Compose the service is named `valkey`.

## Prerequisites

- [Docker Engine](https://docs.docker.com/engine/install/) 24+ with the `docker compose` plugin, **or** Podman with compose support.
- Project `.env` filled (same as native dev: `SESSION_KEY`, optional `TG_API_*`, etc.).

On Arch/Artix (OpenRC):

```bash
sudo pacman -S docker docker-compose docker-openrc docker-buildx
sudo rc-update add docker default
sudo rc-service docker start
sudo usermod -aG docker "$USER"   # then log out/in, or: newgrp docker
```

| Symptom | Fix |
|---------|-----|
| `docker.sock: no such file` | Install **`docker-openrc`**, then `sudo rc-service docker start` |
| `service docker does not exist` | Same — init script is in `docker-openrc`, not `docker` |
| `buildx plugin` warning | `sudo pacman -S docker-buildx` |
| `permission denied` on socket | Already in `docker` group? Run **`newgrp docker`** in this terminal (or log out/in). `npm run docker:*` auto-uses `sg docker` if needed. |

Preflight: `npm run docker:doctor`

## Use your existing local data

1. **MongoDB** — point Compose at your current data directory:

   ```env
   MONGO_DATA_DIR=/home/you/var/mongodb/data
   ```

2. **Valkey** — copy the host RDB snapshot (Artix default: `/var/lib/valkey/dump.rdb`):

   ```bash
   npm run docker:sync-data
   ```

   ```env
   VALKEY_DATA_DIR=./docker/valkey-data
   ```

   Sessions and campaigns live in **MongoDB**. Valkey only holds BullMQ queues; an empty volume is fine if you only need DB history.

3. **App secrets** — Compose loads `.env` as-is. `SESSION_KEY` must match the key used when accounts were imported.

4. **Import files** — copy tdata/JSON into `data/`, then `npm run docker:build` (`COPY data/ /app/data/`). The folder must not be empty (repo includes `data/.keep`). In imports use `/app/data/...` paths. Do not list `data` in `.dockerignore`.

### Native dev vs Docker

| Variable      | Native (Valkey on host) | In Compose        |
|---------------|-------------------------|-------------------|
| `MONGO_URI`   | `127.0.0.1:27017`       | `mongo:27017`     |
| `REDIS_HOST`  | `127.0.0.1`             | `valkey`          |
| `REDIS_PORT`  | `6379`                  | `6379`            |
| Dashboard     | `http://localhost:3000` | **http://127.0.0.1:3048** |

Env names stay `REDIS_*` for compatibility; point them at Valkey on the host the same way (`REDIS_HOST=127.0.0.1`, `valkey-cli ping`).

## Commands

```bash
npm run docker:sync-data  # optional: refresh Valkey dump.rdb from host
npm run docker:build
npm run docker:up
npm run docker:ps
npm run docker:logs
npm run docker:down
```

## Verify

```bash
curl -s http://127.0.0.1:3048/health
# {"ok":true}

curl -s -u admin:changeme http://127.0.0.1:3048/api/accounts | head
```

Open **http://127.0.0.1:3048** (Basic Auth from `.env`).

Optional host ports: Mongo **27018**, Valkey **6380**.

## Services

| Service     | Role                          |
|------------|--------------------------------|
| `mongo`    | Database (bind-mount or volume)|
| `valkey`   | BullMQ (Redis protocol)        |
| `api`      | HTTP API + Nuxt SPA            |
| `worker`   | Outbound send queue            |
| `scheduler`| Cron ticks (inbound, dialogs)  |

Before `docker compose up`, stop native **`mongod`**, **`valkey`**, and **`npm run dev:*`** if they use the same data dirs or ports.

## Troubleshooting

- **Mongo exits on start (exit 62)** — bind-mounted data from a **newer** host `mongod` than the image (e.g. host 8.2 + `mongo:7`). Use matching tag (`mongo:8.2`) or drop `MONGO_DATA_DIR` for a fresh volume.
- **Mongo exits on start** — data dir permissions; see `docker compose logs mongo`.
- **Valkey exits on start** — corrupt or incompatible `dump.rdb`; remove it and start fresh, or re-run `docker:sync-data` while Valkey on the host is stopped.
- **Empty dashboard** — wrong `MONGO_DATA_DIR` or empty volume.
- **Telegram actions fail** — image must include Python venv (`TG_PYTHON=/app/python/.venv/bin/python3` in Compose).
