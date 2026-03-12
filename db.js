'use strict';
const initSqlJs = require('sql.js');
const path      = require('fs').existsSync ? require('path') : null;
const fs        = require('fs');

// On Vercel use /tmp (ephemeral but functional)
const IS_VERCEL = !!process.env.VERCEL;
const DATA_ROOT = IS_VERCEL ? '/tmp' : __dirname;
const DB_FILE   = require('path').join(DATA_ROOT, 'newsmap.db');

let _DB = null;

function persistDB() {
  if (!_DB) return;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(_DB.export()));
  fs.renameSync(tmp, DB_FILE);
}

function dbGet(sql, p=[]) {
  const s=_DB.prepare(sql); s.bind(p);
  const row=s.step()?s.getAsObject():null; s.free(); return row;
}
function dbAll(sql, p=[]) {
  const rows=[],s=_DB.prepare(sql); s.bind(p);
  while(s.step()) rows.push(s.getAsObject()); s.free(); return rows;
}
function dbRun(sql, p=[]) { _DB.run(sql,p); persistDB(); }

async function initDB() {
  const SQL = await initSqlJs();
  _DB = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();

  _DB.run('PRAGMA foreign_keys=ON;');
  _DB.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone         TEXT    UNIQUE NOT NULL,
      username      TEXT    UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      trust_score   REAL    NOT NULL DEFAULT 1.0,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS news (
      id          TEXT    PRIMARY KEY,
      owner_id    INTEGER NOT NULL DEFAULT 0,
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      lat         REAL    NOT NULL,
      lon         REAL    NOT NULL,
      gh_chunk    TEXT,
      gh_sub      TEXT,
      gh_cell     TEXT    UNIQUE,
      links       TEXT    NOT NULL DEFAULT '',
      image_count INTEGER NOT NULL DEFAULT 0,
      thumb       TEXT    NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS votes (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id  TEXT    NOT NULL,
      user_id  INTEGER NOT NULL,
      type     TEXT    NOT NULL CHECK(type IN ('real','fake')),
      weight   REAL    NOT NULL DEFAULT 1.0,
      voted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(news_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_news_cell    ON news(gh_cell);
    CREATE INDEX IF NOT EXISTS idx_news_chunk   ON news(gh_chunk);
    CREATE INDEX IF NOT EXISTS idx_news_lat     ON news(lat);
    CREATE INDEX IF NOT EXISTS idx_news_created ON news(created_at);
    CREATE INDEX IF NOT EXISTS idx_votes_news   ON votes(news_id);
  `);

  // Safe migrations
  const migs = [
    "ALTER TABLE news ADD COLUMN gh_chunk TEXT",
    "ALTER TABLE news ADD COLUMN gh_sub TEXT",
    "ALTER TABLE news ADD COLUMN gh_cell TEXT",
    "ALTER TABLE news ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE news ADD COLUMN description TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE news ADD COLUMN links TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE news ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE news ADD COLUMN thumb TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE votes ADD COLUMN voted_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
    "ALTER TABLE users ADD COLUMN phone TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone)",
  ];
  for (const m of migs) { try { _DB.run(m); } catch {} }

  persistDB();
  console.log('[DB]', DB_FILE);
  return true;
}

module.exports = { initDB, dbGet, dbAll, dbRun, persistDB, DATA_ROOT };
