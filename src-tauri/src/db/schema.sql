-- Tokenova schema v1
-- Phase B: token_events, sessions
-- Phase C-prep: universes, stars, planets, constellations, nebulae, codex, achievements
-- 한 번에 다 만들어둠. 이후 변경시 schema_version 증가 + 마이그레이션.

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    triggered_planet INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions (started_at);

CREATE TABLE IF NOT EXISTS token_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT,
    message_id TEXT UNIQUE,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    timestamp TEXT NOT NULL,
    session_id INTEGER REFERENCES sessions (id) ON DELETE SET NULL,
    source_file TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_events_timestamp ON token_events (timestamp);
CREATE INDEX IF NOT EXISTS idx_token_events_session ON token_events (session_id);

CREATE TABLE IF NOT EXISTS universes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    star_count INTEGER NOT NULL DEFAULT 0,
    galaxy_type TEXT,
    seed INTEGER NOT NULL,
    layout_shape TEXT,
    palette TEXT,
    created_at TEXT NOT NULL,
    finalized_at TEXT
);

CREATE TABLE IF NOT EXISTS stars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    universe_id INTEGER NOT NULL REFERENCES universes (id) ON DELETE CASCADE,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    radius REAL NOT NULL,
    color_r INTEGER NOT NULL,
    color_g INTEGER NOT NULL,
    color_b INTEGER NOT NULL,
    opacity REAL NOT NULL,
    is_big INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stars_universe ON stars (universe_id);

CREATE TABLE IF NOT EXISTS planets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    universe_id INTEGER NOT NULL REFERENCES universes (id) ON DELETE CASCADE,
    planet_type TEXT NOT NULL,
    rarity TEXT NOT NULL,
    seed INTEGER NOT NULL,
    discovered_at TEXT NOT NULL,
    triggering_session_id INTEGER REFERENCES sessions (id) ON DELETE SET NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    user_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_planets_universe ON planets (universe_id);

CREATE TABLE IF NOT EXISTS constellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    universe_id INTEGER NOT NULL REFERENCES universes (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    star_ids TEXT NOT NULL,
    preset_id TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_constellations_universe ON constellations (universe_id);

CREATE TABLE IF NOT EXISTS nebulae (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    universe_id INTEGER NOT NULL REFERENCES universes (id) ON DELETE CASCADE,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    radius REAL NOT NULL,
    color TEXT NOT NULL,
    opacity REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nebulae_universe ON nebulae (universe_id);

CREATE TABLE IF NOT EXISTS codex (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    planet_type TEXT NOT NULL UNIQUE,
    rarity TEXT NOT NULL,
    discovery_count INTEGER NOT NULL DEFAULT 0,
    first_discovered_at TEXT,
    last_discovered_at TEXT
);

CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    achievement_key TEXT NOT NULL UNIQUE,
    achieved_at TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    metadata TEXT
);

CREATE TABLE IF NOT EXISTS watch_state (
    file_path TEXT PRIMARY KEY,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
