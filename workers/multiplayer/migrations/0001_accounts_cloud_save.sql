-- World of Adventure: Online Accounts & Cloud Save Schema (Cloudflare D1)
-- Safe, non-destructive, idempotent migration (CREATE TABLE IF NOT EXISTS).
-- Never drops existing tables or wipes production data.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  public_profile_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  email_normalized TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_email_norm ON accounts(email_normalized);
CREATE INDEX IF NOT EXISTS idx_accounts_public_id ON accounts(public_profile_id);

CREATE TABLE IF NOT EXISTS profiles (
  account_id TEXT PRIMARY KEY NOT NULL,
  public_profile_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  player_tag TEXT NOT NULL DEFAULT '0001',
  avatar_json TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  favorite_game_mode TEXT NOT NULL DEFAULT 'normal',
  privacy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profiles_public_id ON profiles(public_profile_id);
CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON profiles(display_name);

CREATE TABLE IF NOT EXISTS player_progress (
  account_id TEXT PRIMARY KEY NOT NULL,
  save_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  xp_to_next_level INTEGER NOT NULL DEFAULT 100,
  coins INTEGER NOT NULL DEFAULT 0,
  secondary_currencies_json TEXT NOT NULL DEFAULT '{}',
  max_health INTEGER NOT NULL DEFAULT 100,
  max_stamina INTEGER NOT NULL DEFAULT 100,
  unlocked_characters_json TEXT NOT NULL DEFAULT '[]',
  unlocked_abilities_json TEXT NOT NULL DEFAULT '[]',
  skills_json TEXT NOT NULL DEFAULT '{}',
  stats_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_inventory (
  account_id TEXT PRIMARY KEY NOT NULL,
  inventory_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_quests (
  account_id TEXT PRIMARY KEY NOT NULL,
  quests_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_achievements (
  account_id TEXT PRIMARY KEY NOT NULL,
  achievements_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_settings (
  account_id TEXT PRIMARY KEY NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  language TEXT NOT NULL DEFAULT 'en',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_saves (
  account_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  world_name TEXT NOT NULL,
  world_seed INTEGER NOT NULL,
  world_mode TEXT NOT NULL DEFAULT 'normal',
  difficulty TEXT NOT NULL DEFAULT 'normal',
  save_version INTEGER NOT NULL DEFAULT 6,
  revision INTEGER NOT NULL DEFAULT 1,
  play_time_seconds INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, world_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_saves_account_updated
  ON world_saves(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  refresh_token_hash TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_hash ON sessions(refresh_token_hash);

CREATE TABLE IF NOT EXISTS password_resets (
  reset_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_resets_account ON password_resets(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  account_id TEXT NOT NULL,
  target_public_profile_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'friend',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, target_public_profile_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_friendships_account_status
  ON friendships(account_id, status);
