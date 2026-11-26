import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dirname, "..", "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "china.db"));
// WAL + chờ khoá: server và `npm run daily` có thể dùng database cùng lúc
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    source TEXT NOT NULL,
    app_id TEXT NOT NULL,
    title TEXT, developer TEXT, icon TEXT, url TEXT,
    genre TEXT, tags TEXT, tagline TEXT, descr TEXT,
    score REAL, stats TEXT, released TEXT,
    first_seen TEXT, last_seen TEXT,
    PRIMARY KEY (source, app_id)
  );
  CREATE INDEX IF NOT EXISTS apps_title ON apps (title);
  CREATE TABLE IF NOT EXISTS boards (
    source TEXT NOT NULL, board TEXT NOT NULL,
    name TEXT, zh TEXT, ord INTEGER,
    PRIMARY KEY (source, board)
  );
  CREATE TABLE IF NOT EXISTS ranks (
    date TEXT NOT NULL,
    source TEXT NOT NULL, board TEXT NOT NULL,
    rank INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    PRIMARY KEY (date, source, board, rank)
  );
  CREATE INDEX IF NOT EXISTS ranks_app ON ranks (source, app_id);
  CREATE TABLE IF NOT EXISTS tr (zh TEXT PRIMARY KEY, vi TEXT);
  CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL, title TEXT NOT NULL, link TEXT NOT NULL,
    published TEXT, summary TEXT, fetched_at TEXT
  );
  CREATE INDEX IF NOT EXISTS news_published ON news (published);
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT, finished_at TEXT, ok INTEGER, failed INTEGER, errors TEXT
  );
`);

// Ngày theo giờ máy, dạng YYYY-MM-DD
export const today = () => new Date().toLocaleDateString("sv-SE");
export const daysAgo = (n, from = today()) => {
  const d = new Date(from + "T12:00:00");
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
};

const upsertBoard = db.prepare(`
  INSERT INTO boards (source, board, name, zh, ord) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (source, board) DO UPDATE SET name = excluded.name, zh = excluded.zh, ord = excluded.ord
`);
// Trường nào nguồn không trả về (null) thì giữ giá trị đã có
const upsertApp = db.prepare(`
  INSERT INTO apps (source, app_id, title, developer, icon, url, genre, tags, tagline, descr, score, stats, released, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (source, app_id) DO UPDATE SET
    title = excluded.title, icon = COALESCE(excluded.icon, apps.icon), url = COALESCE(excluded.url, apps.url),
    developer = COALESCE(excluded.developer, apps.developer), genre = COALESCE(excluded.genre, apps.genre),
    tags = COALESCE(excluded.tags, apps.tags), tagline = COALESCE(excluded.tagline, apps.tagline),
    descr = COALESCE(excluded.descr, apps.descr), score = COALESCE(excluded.score, apps.score),
    stats = COALESCE(excluded.stats, apps.stats), released = COALESCE(excluded.released, apps.released),
    last_seen = excluded.last_seen
`);
const deleteSnapshot = db.prepare(`DELETE FROM ranks WHERE date = ? AND source = ? AND board = ?`);
const insertRank = db.prepare(`INSERT INTO ranks (date, source, board, rank, app_id) VALUES (?, ?, ?, ?, ?)`);

// Ghi đè snapshot của một bảng trong ngày (chạy lại cùng ngày sẽ thay thế)
export function saveSnapshot(date, source, board, apps) {
  const seen = new Set();
  const list = apps.filter((a) => a.appId && !seen.has(a.appId) && seen.add(a.appId));
  db.exec("BEGIN");
  try {
    upsertBoard.run(source, board.key, board.name, board.zh ?? null, board.ord ?? 0);
    deleteSnapshot.run(date, source, board.key);
    list.forEach((a, i) => {
      upsertApp.run(source, a.appId, a.title, a.developer ?? null, a.icon ?? null, a.url ?? null, a.genre ?? null,
        a.tags?.length ? JSON.stringify(a.tags) : null, a.tagline || null, a.descr || null, a.score ?? null,
        a.stats ? JSON.stringify(a.stats) : null, a.released ?? null, date, date);
      insertRank.run(date, source, board.key, i + 1, a.appId);
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return list.length;
}

// Trả về id của lần chạy vừa ghi
export function logRun(startedAt, ok, errors) {
  return Number(db.prepare(`INSERT INTO runs (started_at, finished_at, ok, failed, errors) VALUES (?, ?, ?, ?, ?)`)
    .run(startedAt, new Date().toISOString(), ok, errors.length, JSON.stringify(errors)).lastInsertRowid);
}
// Cập nhật lần chạy đã ghi khi còn bước chạy sau đó (xuất web): giờ xong, số bảng, lỗi
export function updateRun(id, ok, errors) {
  db.prepare(`UPDATE runs SET finished_at = ?, ok = ?, failed = ?, errors = ? WHERE id = ?`)
    .run(new Date().toISOString(), ok, errors.length, JSON.stringify(errors), id);
}
export const lastRun = () => db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 1`).get() ?? null;

// Khoá dùng chung giữa các tiến trình (server Chart Tracker, npm run china, quy trình 08:30, nhiều phiên Claude):
// mỗi lúc chỉ một quy trình daily được chạy. Khoá của tiến trình đã chết, hoặc giữ quá LOCK_MAX_MIN phút, coi như hết hạn.
db.exec(`CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, pid INTEGER, started_at TEXT)`);
const LOCK_MAX_MIN = 90;
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};
export function lockHolder(name) {
  const l = db.prepare(`SELECT * FROM locks WHERE name = ?`).get(name);
  if (!l || Date.now() - Date.parse(l.started_at) > LOCK_MAX_MIN * 60e3 || !alive(l.pid)) return null;
  return l;
}
// false = tiến trình khác đang giữ khoá
export function acquireLock(name) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const cur = lockHolder(name);
    if (cur && cur.pid !== process.pid) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare(`INSERT OR REPLACE INTO locks (name, pid, started_at) VALUES (?, ?, ?)`).run(name, process.pid, new Date().toISOString());
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export const releaseLock = (name) => db.prepare(`DELETE FROM locks WHERE name = ? AND pid = ?`).run(name, process.pid);
export const latestDate = () => db.prepare(`SELECT MAX(date) AS d FROM ranks`).get()?.d ?? null;
