import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "charts.db"));
// WAL + chờ khoá: server và `npm run fetch` có thể dùng database cùng lúc
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    store TEXT NOT NULL,
    app_id TEXT NOT NULL,
    title TEXT, developer TEXT, icon TEXT, url TEXT,
    score REAL, genre TEXT, released TEXT,
    first_seen TEXT, last_seen TEXT,
    PRIMARY KEY (store, app_id)
  );
  CREATE TABLE IF NOT EXISTS ranks (
    date TEXT NOT NULL,
    store TEXT NOT NULL, country TEXT NOT NULL,
    category TEXT NOT NULL, collection TEXT NOT NULL,
    rank INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    PRIMARY KEY (date, store, country, category, collection, rank)
  );
  CREATE INDEX IF NOT EXISTS ranks_combo ON ranks (store, country, category, collection, date);
  CREATE INDEX IF NOT EXISTS ranks_app ON ranks (store, app_id);
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT, finished_at TEXT,
    ok INTEGER, failed INTEGER, errors TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS publishers (
    store TEXT NOT NULL,
    dev_id TEXT NOT NULL,
    name TEXT,
    seed TEXT,
    added_at TEXT,
    last_fetch TEXT,
    last_error TEXT,
    baseline_done INTEGER DEFAULT 0,
    PRIMARY KEY (store, dev_id)
  );
  CREATE TABLE IF NOT EXISTS publisher_apps (
    store TEXT NOT NULL,
    app_id TEXT NOT NULL,
    dev_id TEXT NOT NULL,
    title TEXT, icon TEXT, url TEXT,
    score REAL, released TEXT, installs TEXT, ratings INTEGER,
    first_seen TEXT, last_seen TEXT,
    is_new INTEGER DEFAULT 0,
    PRIMARY KEY (store, app_id)
  );
  CREATE INDEX IF NOT EXISTS publisher_apps_dev ON publisher_apps (store, dev_id);
  CREATE TABLE IF NOT EXISTS digests (
    date TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT
  );
`);

// Bỏ dấu + chữ thường để tìm kiếm ("Liên Quân" ~ "lien quan")
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();

// Migration: thêm cột mới cho bảng apps nếu database cũ chưa có
const appCols = new Set(db.prepare(`PRAGMA table_info(apps)`).all().map((c) => c.name));
if (!appCols.has("dev_id")) db.exec(`ALTER TABLE apps ADD COLUMN dev_id TEXT`);
if (!appCols.has("search_norm")) {
  db.exec(`ALTER TABLE apps ADD COLUMN search_norm TEXT`);
  const set = db.prepare(`UPDATE apps SET search_norm = ? WHERE store = ? AND app_id = ?`);
  for (const a of db.prepare(`SELECT store, app_id, title, developer FROM apps`).all())
    set.run(norm(`${a.title} ${a.developer}`), a.store, a.app_id);
}

// Ngày theo giờ máy, dạng YYYY-MM-DD
export const today = () => new Date().toLocaleDateString("sv-SE");

const upsertApp = db.prepare(`
  INSERT INTO apps (store, app_id, title, developer, icon, url, score, genre, released, first_seen, last_seen, dev_id, search_norm)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (store, app_id) DO UPDATE SET
    title = excluded.title, developer = excluded.developer, icon = excluded.icon,
    url = excluded.url, score = COALESCE(excluded.score, apps.score),
    genre = COALESCE(excluded.genre, apps.genre), released = COALESCE(excluded.released, apps.released),
    last_seen = excluded.last_seen, dev_id = COALESCE(excluded.dev_id, apps.dev_id),
    search_norm = excluded.search_norm
`);
const deleteSnapshot = db.prepare(
  `DELETE FROM ranks WHERE date = ? AND store = ? AND country = ? AND category = ? AND collection = ?`
);
const insertRank = db.prepare(
  `INSERT INTO ranks (date, store, country, category, collection, rank, app_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

// Ghi đè snapshot của một bảng trong ngày (chạy lại cùng ngày sẽ thay thế)
export function saveSnapshot(date, combo, apps) {
  const { store, country, category, collection } = combo;
  db.exec("BEGIN");
  try {
    deleteSnapshot.run(date, store, country, category, collection);
    apps.forEach((a, i) => {
      upsertApp.run(store, a.appId, a.title, a.developer, a.icon, a.url, a.score, a.genre, a.released, date, date,
        a.devId ?? null, norm(`${a.title} ${a.developer}`));
      insertRank.run(date, store, country, category, collection, i + 1, a.appId);
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function logRun(startedAt, ok, failed, errors) {
  db.prepare(`INSERT INTO runs (started_at, finished_at, ok, failed, errors) VALUES (?, ?, ?, ?, ?)`)
    .run(startedAt, new Date().toISOString(), ok, failed, JSON.stringify(errors));
}

export function lastRun() {
  return db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 1`).get() ?? null;
}

export function latestDate() {
  return db.prepare(`SELECT MAX(date) AS d FROM ranks`).get()?.d ?? null;
}
