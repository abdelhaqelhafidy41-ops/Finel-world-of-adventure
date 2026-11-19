# Cloudflare D1 Online Accounts & Cloud Save Deployment Guide

This project extends the existing Cloudflare Worker (`finel-world-of-adventure`) with a persistent **Cloudflare D1** relational database for secure player accounts, sessions, password recovery, player progression cloud saves, and world saves.

## 1. D1 Database Setup & Migration

Create the D1 database once in your Cloudflare account:

```bash
npx wrangler d1 create world-of-adventure-accounts
```

Copy the returned `database_id` into `wrangler.toml` under both `[[d1_databases]]` and `[[env.production.d1_databases]]` (binding name: `DB`).

Apply the non-destructive, idempotent migration (`workers/multiplayer/migrations/0001_accounts_cloud_save.sql`):

```bash
# Local development D1
npx wrangler d1 migrations apply world-of-adventure-accounts --local

# Production D1
npx wrangler d1 migrations apply world-of-adventure-accounts --remote --env production
```

## 2. Optional Environment Secrets (Never Committed to Git)

Configure password-reset email delivery and session secrets via Wrangler secrets:

```bash
npx wrangler secret put SESSION_HMAC_SECRET --env production
npx wrangler secret put RESET_EMAIL_API_URL --env production   # e.g. https://api.resend.com/emails
npx wrangler secret put RESET_EMAIL_API_KEY --env production   # provider API key
npx wrangler secret put RESET_EMAIL_FROM --env production      # e.g. World of Adventure <noreply@yourdomain.com>
```

## 3. Deploy Worker

```bash
npx wrangler deploy --env production
```

Production Worker URL (unchanged):
`https://finel-world-of-adventure.abdelhaq-elhafidy-41.workers.dev`

Production GitHub Pages URL (unchanged):
`https://abdelhaqelhafidy41-ops.github.io/Finel-world-of-adventure/`

## 4. Tables Created by `0001_accounts_cloud_save.sql`

- `accounts` — Internal server-generated `account_id`, unique `public_profile_id` (`WA-...`), normalized email, PBKDF2-SHA256 password hash + salt + iteration count.
- `profiles` — Editable display name, avatar JSON, bio, country, favorite mode, privacy settings.
- `player_progress` — `save_version`, `revision` (optimistic conflict protection), level, XP, coins, secondary currencies, health/stamina progression, unlocked characters/abilities, skills, stats.
- `player_inventory` — Authoritative inventory/weapons/equipment snapshot.
- `player_quests` — Main story, side quests, and active/completed quest progress.
- `player_achievements` — Unlocked achievement IDs.
- `account_settings` — Player preferences, controls, and language.
- `world_saves` — Per-account saved worlds (`world_id`, `world_seed`, `world_name`, `world_mode`, `difficulty`, `revision`, persistent world deltas).
- `sessions` — SHA-256 hashed session & refresh tokens with expiration timestamps.
- `password_resets` — SHA-256 hashed 6-character recovery codes with 15-minute expiry and attempt limits.
- `friendships` — Account-linked friend/block records.
