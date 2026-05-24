# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=web-build /app/src/apps/api/public ./dist/apps/api/public
COPY python/requirements.txt python/requirements.txt
COPY python/tg_worker python/tg_worker

RUN python3 -m venv /app/python/.venv \
  && /app/python/.venv/bin/pip install --no-cache-dir -r python/requirements.txt

ENV NODE_ENV=production \
  TG_PYTHON=/app/python/.venv/bin/python3

EXPOSE 3000
