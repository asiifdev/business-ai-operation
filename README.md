# business-ai-operation

An AI-powered business operating system for software agencies and startups: product and client portfolio, subscriptions and invoices, lead pipeline, maintenance tickets, and an **AI Action Center** with human approval. Built for the Meta Global AI Developer Hackathon (Startup track).

**Current status and schedule: [`docs/PLAN.md`](docs/PLAN.md)** (the single source of status; this README does not copy it). Read [`CLAUDE.md`](CLAUDE.md) before working on the code.

## Documents

The project documents are written in Indonesian.

| Document | Contents |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Mandatory working guide (document flow, two-track work, Definition of Done, technical rules, skills) |
| [`docs/PLAN.md`](docs/PLAN.md) | Stage and implementation status, schedule, module owners, open questions |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decision log |
| [`docs/00-visi-produk.md`](docs/00-visi-produk.md) | Vision, problem, AI principles, demo story |
| [`docs/01-aturan-hackathon.md`](docs/01-aturan-hackathon.md) | Hackathon rules, schedule, judging |
| [`docs/02-meta-model-api.md`](docs/02-meta-model-api.md) | Meta models, pricing, limits, real test results |
| [`docs/03-arsitektur.md`](docs/03-arsitektur.md) | Stack, structure, layers, AI, Telegram, security |
| [`docs/04-workflow-pengembangan.md`](docs/04-workflow-pengembangan.md) | Two-track work, git, testing |
| [`docs/05-uiux-dan-komponen.md`](docs/05-uiux-dan-komponen.md) | Design system and form component contracts |
| [`docs/09-breakdown-fitur.md`](docs/09-breakdown-fitur.md) | Modules and how they connect |
| [`docs/BRD.md`](docs/BRD.md) | Parent BRD: goals, actors, cross-module rules (CR), glossary, template |
| [`docs/brd/README.md`](docs/brd/README.md) | Index of the per-module BRDs (one file per module) |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements: pages, services, AI and Telegram contracts, testing |
| [`docs/ERD.md`](docs/ERD.md) | Data schema, constraints, database guards, migration plan |

## Running locally

Prerequisites: Node >= 22.23.4, pnpm, PostgreSQL, `ffmpeg`.

```bash
cp .env.example .env     # fill in the values; never commit this file
pnpm install
pnpm db:migrate          # create the tables in the local database
pnpm db:seed             # fake demo data: Orbit Studio and Kopi Senja Digital
pnpm dev                 # component gallery: /dev/komponen
pnpm test                # unit, component, and documentation sync checks
pnpm typecheck
pnpm build
```

The database schema and migrations come only from `docs/ERD.md` (see `CLAUDE.md`).

Sign in with the (fake) demo data after `pnpm db:seed`: `owner@orbit-studio.test`, `admin@orbit-studio.test`, or `staf@orbit-studio.test`, password `demo-password-123`. Test the assistant with `pnpm ai:smoke` (requires `MODEL_API_KEY`).

Meetings (`/app/rapat`): recordings are stored in `STORAGE_DIR` (`disk` driver) and processed by a worker inside the server process. Audio conversion uses `ffmpeg` from PATH or `FFMPEG_PATH`; without ffmpeg, only mono 16/24 kHz WAV files of 9 minutes or less can be processed.

Telegram bot (requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`): link your account at `/app/settings/telegram`. Without a public HTTPS address, run `pnpm bot:dev` (long polling). **Caution:** that command deletes the webhook, so the live server stops receiving updates until `pnpm bot:webhook` is run there again.

## Deploying to a server

A public server **must run the production build**, not `pnpm dev` (dev mode exposes the component gallery and development tools, is slower, and rejects any host other than localhost).

```bash
pnpm install --frozen-lockfile
pnpm db:migrate          # review new migrations in drizzle/ before applying them
pnpm build
pnpm start               # listens on HOST:PORT from .env
pnpm bot:webhook         # once per deploy: registers the Telegram webhook and command menu
```

Required variables on the server (never put their values in the repo): `DATABASE_URL`, `BETTER_AUTH_SECRET` (random, at least 32 characters, **different** from your local one), `BETTER_AUTH_URL` and `APP_URL` (the public `https://` address), `HOST`, `PORT`.

The billing scheduler runs in the same process: it ticks every 60 seconds and runs once a day per organization at that organization's scheduler hour, and Telegram cards go out every minute when `TELEGRAM_BOT_TOKEN` is set. Set `SCHEDULER=off` on any process that must not run jobs.

Run `pnpm start` under a process manager (pm2 or systemd) behind an HTTPS proxy that forwards the `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` headers. `APP_URL` is read during `pnpm build`, so set it before building.

## Contributors and provenance

- **Author:** one approved hackathon participant (the repository owner).
- **Built from scratch during the hackathon period** (starting 28 Oct 2026). No code was copied from other projects; common design patterns (form component contracts, agent patterns) were rewritten here.
- **Third-party tooling** in `.claude/skills/` (`hallmark`, `tailwind-4-docs`) consists of development guidance skills, not part of the product, each with its own license.
- All demo data is fake seed data; the repo contains no client data, API keys, or credentials.
