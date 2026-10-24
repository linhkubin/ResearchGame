import gplay from "google-play-scraper";
import { db, norm, today } from "./db.mjs";
import { NEW_GAMES } from "./config.mjs";
import { shortTitle } from "./ads.mjs";

// Game mới phát hành chưa (hoặc chưa từng) vào top: quét riêng từng store theo từ khoá thể loại.
// - App Store: iTunes Search API trả sẵn ngày phát hành + số đánh giá.
// - Google Play: tìm kiếm chỉ trả ~30-50 kết quả và không có ngày phát hành, nên tra chi tiết từng app
//   (lưu lại để lần sau không tra lại), rồi lan theo "game tương tự" của chính các game mới tìm được.

db.exec(`
  CREATE TABLE IF NOT EXISTS ng_checked (
    store TEXT NOT NULL, app_id TEXT NOT NULL,
    released TEXT, is_game INTEGER, checked_at TEXT,
    PRIMARY KEY (store, app_id)
  );
  CREATE TABLE IF NOT EXISTS new_games (
    store TEXT NOT NULL, app_id TEXT NOT NULL,
    title TEXT, developer TEXT, dev_id TEXT, icon TEXT, url TEXT, genre TEXT,
    released TEXT, installs TEXT, min_installs INTEGER, ratings INTEGER, score REAL,
    found_by TEXT, first_seen TEXT, last_seen TEXT,
    PRIMARY KEY (store, app_id)
  );
  CREATE TABLE IF NOT EXISTS new_game_stats (
    store TEXT NOT NULL, app_id TEXT NOT NULL, date TEXT NOT NULL,
    min_installs INTEGER, ratings INTEGER,
    PRIMARY KEY (store, app_id, date)
  );
`);

export const newGamesStatus = { running: false, step: null, done: 0, total: 0, found: { ios: 0, gplay: 0 }, errors: [], finishedAt: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDate = (d) => (d ? new Date(d).toLocaleDateString("sv-SE") : null);
const sinceDate = () => new Date(Date.now() - NEW_GAMES.days * 864e5).toLocaleDateString("sv-SE");

const upsertGame = db.prepare(`
  INSERT INTO new_games (store, app_id, title, developer, dev_id, icon, url, genre, released, installs, min_installs,
    ratings, score, found_by, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (store, app_id) DO UPDATE SET
    title = excluded.title, developer = excluded.developer, dev_id = excluded.dev_id, icon = excluded.icon,
    url = excluded.url, genre = excluded.genre, released = excluded.released, installs = excluded.installs,
    min_installs = excluded.min_installs, ratings = excluded.ratings, score = excluded.score, last_seen = excluded.last_seen`);
const upsertStat = db.prepare(`INSERT OR REPLACE INTO new_game_stats (store, app_id, date, min_installs, ratings) VALUES (?, ?, ?, ?, ?)`);
const setChecked = db.prepare(`INSERT OR REPLACE INTO ng_checked (store, app_id, released, is_game, checked_at) VALUES (?, ?, ?, ?, ?)`);

function save(g, foundBy, date) {
  upsertGame.run(g.store, g.appId, g.title, g.developer, g.devId ?? null, g.icon ?? null, g.url ?? null, g.genre ?? null,
    g.released, g.installs ?? null, g.minInstalls ?? null, g.ratings ?? null, g.score ?? null, foundBy, date, date);
  upsertStat.run(g.store, g.appId, date, g.minInstalls ?? null, g.ratings ?? null);
}

// ---------- App Store ----------

const fromItunes = (x) => ({
  store: "ios", appId: String(x.trackId), title: x.trackName, developer: x.artistName, devId: String(x.artistId),
  icon: x.artworkUrl100 ?? x.artworkUrl60, url: x.trackViewUrl?.replace(/\?.*$/, ""), genre: (x.genres ?? []).filter((g) => g !== "Games").join(", ") || x.primaryGenreName,
  released: isoDate(x.releaseDate), ratings: x.userRatingCount ?? 0, score: x.averageUserRating ?? null,
});

async function itunes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
  return (await res.json()).results ?? [];
}

async function scanIos(date) {
  const since = sinceDate();
  const found = new Map();
  newGamesStatus.step = "ios";
  for (const term of NEW_GAMES.terms) {
    try {
      const list = await itunes(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&genreId=6014&limit=200&country=${NEW_GAMES.country}`);
      for (const x of list) {
        if (x.primaryGenreName !== "Games" || !x.releaseDate || isoDate(x.releaseDate) < since) continue;
        if (!found.has(x.trackId)) found.set(x.trackId, { g: fromItunes(x), term });
      }
    } catch (e) {
      newGamesStatus.errors.push({ store: "ios", term, error: String(e.message ?? e).slice(0, 150) });
    }
    newGamesStatus.done++;
    await sleep(1500); // iTunes Search giới hạn khoảng 20 lượt/phút
  }
  // Game đã tìm thấy hôm trước nhưng hôm nay không lọt kết quả: vẫn cập nhật số đánh giá (lookup 100 id mỗi lượt)
  const old = db.prepare(`SELECT app_id FROM new_games WHERE store = 'ios' AND released >= ?`).all(since)
    .map((r) => r.app_id).filter((id) => !found.has(Number(id)));
  for (let i = 0; i < old.length; i += 100) {
    try {
      for (const x of await itunes(`https://itunes.apple.com/lookup?id=${old.slice(i, i + 100).join(",")}&country=${NEW_GAMES.country}`))
        if (x.trackId) found.set(x.trackId, { g: fromItunes(x), term: null });
    } catch (e) {
      newGamesStatus.errors.push({ store: "ios", term: "lookup", error: String(e.message ?? e).slice(0, 150) });
    }
    await sleep(1500);
  }
  db.exec("BEGIN");
  for (const { g, term } of found.values()) save(g, term, date);
  db.exec("COMMIT");
  newGamesStatus.found.ios = found.size;
}

// ---------- Google Play ----------

const fromGplay = (a) => ({
  store: "gplay", appId: a.appId, title: a.title, developer: a.developer, devId: a.developer, icon: a.icon, url: a.url,
  genre: a.genre, released: isoDate(a.released), installs: a.installs, minInstalls: a.minInstalls ?? null,
  ratings: a.ratings ?? null, score: a.score ?? null,
});

async function scanGplay(date) {
  const since = sinceDate();
  const checked = new Map(db.prepare(`SELECT app_id, released, is_game FROM ng_checked WHERE store = 'gplay'`).all()
    .map((r) => [r.app_id, r]));
  const tracked = new Set(db.prepare(`SELECT app_id FROM new_games WHERE store = 'gplay' AND released >= ?`).all(since).map((r) => r.app_id));
  const found = new Map();
  let lookups = 0;

  // Tra chi tiết một app; app cũ / không phải game được ghi nhớ để lần sau bỏ qua
  async function consider(appId, foundBy) {
    if (found.has(appId)) return;
    const c = checked.get(appId);
    if (c && !tracked.has(appId) && (!c.is_game || (c.released && c.released < since))) return;
    if (lookups >= NEW_GAMES.maxLookups) return;
    lookups++;
    try {
      const a = await gplay.app({ appId, country: NEW_GAMES.country });
      const g = fromGplay(a);
      const isGame = String(a.genreId ?? "").startsWith("GAME");
      setChecked.run("gplay", appId, g.released, isGame ? 1 : 0, date);
      checked.set(appId, { released: g.released, is_game: isGame ? 1 : 0 });
      if (isGame && g.released && g.released >= since) found.set(appId, { g, foundBy });
    } catch (e) {
      // App gỡ khỏi store: nhớ lại để không tra nữa
      if (/404|not found/i.test(e.message)) setChecked.run("gplay", appId, null, 0, date);
    }
    await sleep(120);
  }

  newGamesStatus.step = "gplay";
  for (const term of NEW_GAMES.terms) {
    try {
      const list = await gplay.search({ term, num: 50, country: NEW_GAMES.country });
      for (const x of list) await consider(x.appId, term);
    } catch (e) {
      newGamesStatus.errors.push({ store: "gplay", term, error: String(e.message ?? e).slice(0, 150) });
    }
    newGamesStatus.done++;
  }
  // Cập nhật lượt cài cho game mới đã theo dõi mà hôm nay không lọt kết quả tìm kiếm
  for (const id of tracked) await consider(id, null);

  // Lan theo "game tương tự" của các game mới có nhiều lượt cài nhất
  newGamesStatus.step = "gplay-similar";
  const seeds = [...found.values()].sort((a, b) => (b.g.minInstalls ?? 0) - (a.g.minInstalls ?? 0))
    .slice(0, NEW_GAMES.similarSeeds);
  for (const { g } of seeds) {
    try {
      for (const x of await gplay.similar({ appId: g.appId, country: NEW_GAMES.country })) await consider(x.appId, `tương tự: ${g.title}`);
    } catch {}
    await sleep(200);
  }

  db.exec("BEGIN");
  for (const { g, foundBy } of found.values()) save(g, foundBy, date);
  db.exec("COMMIT");
  newGamesStatus.found.gplay = found.size;
  if (lookups >= NEW_GAMES.maxLookups) newGamesStatus.errors.push({ store: "gplay", term: null, error: `Dừng ở giới hạn ${NEW_GAMES.maxLookups} lượt tra` });
}

export async function runNewGamesFetch() {
  if (newGamesStatus.running) return false;
  Object.assign(newGamesStatus, { running: true, step: null, done: 0, total: NEW_GAMES.terms.length * 2, found: { ios: 0, gplay: 0 }, errors: [] });
  try {
    const date = today();
    // Hai store độc lập: store này lỗi không chặn store kia
    for (const fn of [scanIos, scanGplay]) {
      try {
        await fn(date);
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        newGamesStatus.errors.push({ store: fn === scanIos ? "ios" : "gplay", term: null, error: String(e.message ?? e).slice(0, 200) });
      }
    }
  } finally {
    Object.assign(newGamesStatus, { running: false, step: null, finishedAt: new Date().toISOString() });
  }
  return true;
}

// ---------- truy vấn ----------

const gameKey = (t) => norm(shortTitle(t)).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const daysSince = (d, now) => Math.max(1, Math.round((new Date(now) - new Date(d)) / 864e5));

// Toàn bộ danh sách game mới (vài trăm mục); trình duyệt tự lọc/sắp xếp để bản tĩnh dùng chung được
export function listNewGames() {
  const now = today();
  const since = sinceDate();
  const rows = db.prepare(`SELECT * FROM new_games WHERE released >= ? ORDER BY released DESC`).all(since);

  // Số liệu cách đây ít nhất 7 ngày (hoặc cũ nhất có) để tính mức tăng
  const weekAgo = new Date(Date.now() - 7 * 864e5).toLocaleDateString("sv-SE");
  const past = new Map();
  for (const s of db.prepare(`SELECT store, app_id, date, min_installs, ratings FROM new_game_stats ORDER BY date`).all()) {
    const k = s.store + ":" + s.app_id;
    const cur = past.get(k);
    if (!cur || s.date <= weekAgo) past.set(k, s);
  }
  // Đang có trong chart (ngày mới nhất mỗi bảng) và nhà phát hành đang theo dõi
  const inChart = new Map(db.prepare(`
    SELECT r.store, r.app_id, MIN(r.rank) AS rank, COUNT(*) AS charts FROM ranks r
    JOIN (SELECT store, country, category, collection, MAX(date) AS d FROM ranks GROUP BY store, country, category, collection) m
      ON r.store = m.store AND r.country = m.country AND r.category = m.category AND r.collection = m.collection AND r.date = m.d
    GROUP BY r.store, r.app_id`).all().map((r) => [r.store + ":" + r.app_id, { rank: r.rank, charts: r.charts }]));
  const followed = new Set(db.prepare(`SELECT store, dev_id FROM publishers`).all().map((p) => p.store + ":" + p.dev_id));

  // Cụm trùng tên: nhiều studio cùng ra một kiểu game = dấu hiệu trend đang bị clone
  const clusters = new Map();
  for (const r of rows) {
    const k = gameKey(r.title);
    if (!clusters.has(k)) clusters.set(k, { key: k, name: shortTitle(r.title), ios: 0, gplay: 0, devs: new Set() });
    const c = clusters.get(k);
    c[r.store]++;
    c.devs.add(r.developer);
  }

  const items = rows.map((r) => {
    const k = r.store + ":" + r.app_id;
    const age = daysSince(r.released, now);
    const p = past.get(k);
    const pDays = p && p.date < now ? daysSince(p.date, now) : null;
    const cl = clusters.get(gameKey(r.title));
    return {
      store: r.store, appId: r.app_id, title: r.title, developer: r.developer, icon: r.icon, url: r.url, genre: r.genre,
      released: r.released, age, installs: r.installs, minInstalls: r.min_installs, ratings: r.ratings, score: r.score,
      foundBy: r.found_by, firstSeen: r.first_seen,
      // Tốc độ: lượt cài (Android, theo mốc 1K/5K/10K…) hoặc đánh giá mỗi ngày kể từ khi phát hành
      installsPerDay: r.min_installs != null ? Math.round(r.min_installs / age) : null,
      ratingsPerDay: r.ratings != null ? Math.round((r.ratings / age) * 10) / 10 : null,
      // Mức tăng so với ~7 ngày trước (hoặc lần đầu thấy)
      installsGain: p && pDays && r.min_installs != null && p.min_installs != null ? r.min_installs - p.min_installs : null,
      ratingsGain: p && pDays && r.ratings != null && p.ratings != null ? r.ratings - p.ratings : null,
      gainDays: pDays,
      chart: inChart.get(k) ?? null,
      followed: followed.has(r.store + ":" + (r.store === "gplay" ? r.developer : r.dev_id)),
      cluster: cl.devs.size > 1 ? cl.devs.size : 0,
    };
  });

  // Điểm đà tăng 0-100: phân vị của tốc độ trong cùng store (Android theo lượt cài/ngày, iOS theo đánh giá/ngày)
  for (const store of ["gplay", "ios"]) {
    const list = items.filter((i) => i.store === store);
    const rate = (i) => (store === "gplay" ? i.installsPerDay ?? 0 : i.ratingsPerDay ?? 0);
    const sorted = list.map(rate).sort((a, b) => a - b);
    for (const i of list) {
      const below = sorted.filter((v) => v < rate(i)).length;
      i.momentum = sorted.length > 1 ? Math.round((below / (sorted.length - 1)) * 100) : 50;
    }
  }

  const trends = [...clusters.values()].filter((c) => c.devs.size >= 3)
    .map((c) => ({ key: c.key, name: c.name, ios: c.ios, gplay: c.gplay, devs: c.devs.size }))
    .sort((a, b) => b.devs - a.devs).slice(0, 20);

  return {
    items, trends, days: NEW_GAMES.days, terms: NEW_GAMES.terms.length,
    status: {
      running: newGamesStatus.running, step: newGamesStatus.step, done: newGamesStatus.done, total: newGamesStatus.total,
      errors: newGamesStatus.errors, finishedAt: newGamesStatus.finishedAt,
      lastFetch: db.prepare(`SELECT MAX(last_seen) AS d FROM new_games`).get()?.d ?? null,
    },
  };
}
