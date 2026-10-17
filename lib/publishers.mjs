import gplay from "google-play-scraper";
import store from "app-store-scraper";
import { db, today } from "./db.mjs";
import { PUBLISHER_SEEDS, PUBLISHER_MAX_APPS } from "./config.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("sv-SE"); };

export const pubStatus = { running: false, done: 0, total: 0, errors: [] };

const insertPublisher = db.prepare(`INSERT OR IGNORE INTO publishers (store, dev_id, name, seed, added_at) VALUES (?, ?, ?, ?, ?)`);

// ---------- tìm mã nhà phát hành ----------

// Google Play: dùng đúng tên tài khoản nhà phát hành làm mã. Trang /developer?id=<tên> trả đủ
// danh sách (tới ~100 game), còn trang mã số /dev?id= chỉ trả khoảng 10 game nổi bật.
// Lấy tên chuẩn qua trang chi tiết một app của họ.
async function gplayDev(appId) {
  const a = await gplay.app({ appId });
  return { devId: a.developer, name: a.developer };
}

// App Store: API tra cứu công khai của Apple, tối đa 200 app (thư viện scraper chỉ lấy 50)
async function iosDeveloperApps(devId) {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(devId)}&entity=software&limit=200&country=us`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`iTunes lookup HTTP ${res.status}`);
  const data = await res.json();
  return data.results.filter((r) => r.wrapperType === "software");
}

async function resolveSeed(seed) {
  const term = seed.term ?? seed.name;
  const found = [];

  // Google Play: ưu tiên app đã có trong database chart, nếu không thì tìm trên store
  let gp = db.prepare(`SELECT developer, MIN(app_id) AS appId FROM apps WHERE store = 'gplay' GROUP BY developer`).all()
    .filter((r) => seed.gplay.test(r.developer));
  if (!gp.length) {
    const res = await gplay.search({ term, num: 40, throttle: 5 });
    const byDev = new Map();
    for (const r of res) if (seed.gplay.test(r.developer) && !byDev.has(r.developer)) byDev.set(r.developer, r.appId);
    gp = [...byDev].map(([developer, appId]) => ({ developer, appId }));
  }
  for (const r of gp) {
    const d = await gplayDev(r.appId);
    if (!found.some((f) => f.store === "gplay" && f.devId === d.devId)) found.push({ store: "gplay", ...d });
    await sleep(300);
  }

  // App Store: dữ liệu chart đã có developerId
  let ios = db.prepare(`SELECT DISTINCT developer, dev_id AS devId FROM apps WHERE store = 'ios' AND dev_id IS NOT NULL`).all()
    .filter((r) => seed.ios.test(r.developer));
  if (!ios.length) {
    const res = await store.search({ term, num: 50 });
    ios = res.filter((r) => seed.ios.test(r.developer) && r.developerId)
      .map((r) => ({ developer: r.developer, devId: String(r.developerId) }));
  }
  for (const r of ios)
    if (!found.some((f) => f.store === "ios" && f.devId === r.devId)) found.push({ store: "ios", devId: r.devId, name: r.developer });

  return found;
}

async function resolveSeeds() {
  const have = new Set(db.prepare(`SELECT seed || '|' || store AS k FROM publishers WHERE seed IS NOT NULL`).all().map((r) => r.k));
  for (const seed of PUBLISHER_SEEDS) {
    if (have.has(seed.name + "|gplay") && have.has(seed.name + "|ios")) continue;
    try {
      for (const p of await resolveSeed(seed)) insertPublisher.run(p.store, p.devId, p.name, seed.name, today());
    } catch (e) {
      pubStatus.errors.push({ publisher: seed.name, error: "Không tìm được tài khoản: " + (e.message ?? e) });
    }
  }
}

// ---------- lấy danh sách game của một nhà phát hành ----------

const getPubApp = db.prepare(`SELECT app_id FROM publisher_apps WHERE store = ? AND app_id = ?`);
const insertPubApp = db.prepare(`INSERT INTO publisher_apps
  (store, app_id, dev_id, title, icon, url, score, released, installs, ratings, first_seen, last_seen, is_new)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const touchPubApp = db.prepare(`UPDATE publisher_apps SET title = ?, icon = ?, url = ?, score = COALESCE(?, score),
  last_seen = ?, dev_id = ? WHERE store = ? AND app_id = ?`);

// Danh sách game hiện có trên store của một tài khoản nhà phát hành
async function storeDevApps(st, devId) {
  if (st === "gplay")
    return (await gplay.developer({ devId, num: PUBLISHER_MAX_APPS })).map((x) => ({
      appId: x.appId, title: x.title, icon: x.icon, url: x.url,
      score: typeof x.score === "number" ? x.score : null, developer: x.developer,
    }));
  return (await iosDeveloperApps(devId)).map((x) => ({
    appId: String(x.trackId), title: x.trackName, icon: x.artworkUrl100, url: x.trackViewUrl,
    score: typeof x.averageUserRating === "number" ? x.averageUserRating : null, developer: x.artistName,
    released: x.releaseDate ?? null, ratings: x.userRatingCount ?? null,
  }));
}

export async function fetchPublisher(p) {
  const date = today();
  const list = await storeDevApps(p.store, p.dev_id);

  let enriched = 0;
  db.exec("BEGIN");
  const fresh = [];
  try {
    for (const a of list) {
      if (getPubApp.get(p.store, a.appId)) {
        touchPubApp.run(a.title, a.icon, a.url, a.score, date, p.dev_id, p.store, a.appId);
      } else {
        // Lần lấy đầu tiên chỉ ghi nhận danh sách gốc, không tính là "game mới"
        const isNew = p.baseline_done ? 1 : 0;
        insertPubApp.run(p.store, a.appId, p.dev_id, a.title, a.icon, a.url, a.score,
          a.released ?? null, null, a.ratings ?? null, date, date, isNew);
        if (isNew && p.store === "gplay") fresh.push(a.appId);
      }
    }
    db.prepare(`UPDATE publishers SET last_fetch = ?, last_error = NULL, baseline_done = 1,
      name = COALESCE(?, name) WHERE store = ? AND dev_id = ?`)
      .run(new Date().toISOString(), list[0]?.developer ?? null, p.store, p.dev_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  // Game mới trên Google Play: lấy thêm ngày phát hành, band lượt cài, số đánh giá
  const upd = db.prepare(`UPDATE publisher_apps SET released = ?, installs = ?, ratings = ? WHERE store = 'gplay' AND app_id = ?`);
  for (const appId of fresh.slice(0, 10)) {
    try {
      const d = await gplay.app({ appId });
      upd.run(d.released ?? null, d.installs ?? null, d.ratings ?? null, appId);
      enriched++;
    } catch {}
    await sleep(300);
  }
  return { apps: list.length, fresh: fresh.length, enriched };
}

export async function runPublisherFetch() {
  if (pubStatus.running) return false;
  Object.assign(pubStatus, { running: true, done: 0, total: 0, errors: [] });
  try {
    await resolveSeeds();
    const pubs = db.prepare(`SELECT * FROM publishers ORDER BY seed, name`).all();
    pubStatus.total = pubs.length;
    for (const p of pubs) {
      try {
        await fetchPublisher(p);
      } catch (e) {
        const msg = String(e.message ?? e);
        db.prepare(`UPDATE publishers SET last_error = ? WHERE store = ? AND dev_id = ?`).run(msg, p.store, p.dev_id);
        pubStatus.errors.push({ publisher: p.name, store: p.store, error: msg });
      }
      pubStatus.done++;
      await sleep(500);
    }
  } finally {
    pubStatus.running = false;
  }
  return true;
}

// ---------- theo dõi / bỏ theo dõi thủ công ----------

export async function followFromApp(st, appId) {
  let devId, name;
  if (st === "gplay") ({ devId, name } = await gplayDev(appId));
  else {
    const row = db.prepare(`SELECT dev_id, developer FROM apps WHERE store = 'ios' AND app_id = ?`).get(appId);
    if (row?.dev_id) ({ dev_id: devId, developer: name } = row);
    else {
      const a = await store.app({ id: appId });
      devId = String(a.developerId);
      name = a.developer;
    }
    if (!devId) throw new Error("Không tìm được mã nhà phát hành");
  }
  insertPublisher.run(st, devId, name, null, today());
  const p = db.prepare(`SELECT * FROM publishers WHERE store = ? AND dev_id = ?`).get(st, devId);
  if (!p.baseline_done) await fetchPublisher(p);
  return { store: st, devId, name };
}

export function unfollow(st, devId) {
  db.prepare(`DELETE FROM publisher_apps WHERE store = ? AND dev_id = ?`).run(st, devId);
  db.prepare(`DELETE FROM publishers WHERE store = ? AND dev_id = ?`).run(st, devId);
}

// ---------- truy vấn cho giao diện ----------

const latestRanks = `
  SELECT r.store, r.app_id, MIN(r.rank) AS best, COUNT(*) AS charts FROM ranks r
  JOIN (SELECT store, country, category, collection, MAX(date) AS d FROM ranks
        GROUP BY store, country, category, collection) m
    ON r.store = m.store AND r.country = m.country AND r.category = m.category
   AND r.collection = m.collection AND r.date = m.d
  GROUP BY r.store, r.app_id`;

export function listPublishers() {
  const since = daysAgo(14);
  return db.prepare(`
    SELECT p.store, p.dev_id AS devId, p.name, p.seed, p.last_fetch AS lastFetch, p.last_error AS lastError,
      COUNT(pa.app_id) AS apps,
      SUM(CASE WHEN pa.is_new = 1 AND pa.first_seen >= ? THEN 1 ELSE 0 END) AS newApps,
      SUM(CASE WHEN lr.best IS NOT NULL THEN 1 ELSE 0 END) AS inChart,
      MIN(lr.best) AS bestRank
    FROM publishers p
    LEFT JOIN publisher_apps pa ON pa.store = p.store AND pa.dev_id = p.dev_id
    LEFT JOIN (${latestRanks}) lr ON lr.store = pa.store AND lr.app_id = pa.app_id
    GROUP BY p.store, p.dev_id
    ORDER BY COALESCE(p.seed, p.name), p.store`).all(since);
}

export function publisherDetail(st, devId) {
  const p = db.prepare(`SELECT store, dev_id AS devId, name, seed, last_fetch AS lastFetch, last_error AS lastError,
    added_at AS addedAt FROM publishers WHERE store = ? AND dev_id = ?`).get(st, devId);
  if (!p) return null;
  const apps = db.prepare(`
    SELECT pa.app_id AS appId, pa.title, pa.icon, pa.url, pa.score, pa.released, pa.installs, pa.ratings,
      pa.first_seen AS firstSeen, pa.is_new AS isNew, lr.best AS bestRank, lr.charts
    FROM publisher_apps pa
    LEFT JOIN (${latestRanks}) lr ON lr.store = pa.store AND lr.app_id = pa.app_id
    WHERE pa.store = ? AND pa.dev_id = ?
    ORDER BY (lr.best IS NULL), lr.best, pa.is_new DESC, pa.first_seen DESC, pa.title`).all(st, devId);
  return { publisher: p, apps };
}

export function recentNewApps(days = 14) {
  return db.prepare(`
    SELECT pa.store, pa.app_id AS appId, pa.title, pa.icon, pa.url, pa.released, pa.installs, pa.ratings,
      pa.first_seen AS firstSeen, p.name AS developer, COALESCE(p.seed, p.name) AS publisher, p.dev_id AS devId,
      lr.best AS bestRank
    FROM publisher_apps pa
    JOIN publishers p ON p.store = pa.store AND p.dev_id = pa.dev_id
    LEFT JOIN (${latestRanks}) lr ON lr.store = pa.store AND lr.app_id = pa.app_id
    WHERE pa.is_new = 1 AND pa.first_seen >= ?
    ORDER BY pa.first_seen DESC, pa.title`).all(daysAgo(days));
}

// Nhà phát hành của một game có đang được theo dõi không
export function followedPublisherFor(st, appId, developer) {
  return db.prepare(`
    SELECT p.store, p.dev_id AS devId, p.name FROM publishers p
    WHERE p.store = ? AND (p.dev_id = (SELECT dev_id FROM publisher_apps WHERE store = ? AND app_id = ?)
      OR p.dev_id = (SELECT dev_id FROM apps WHERE store = ? AND app_id = ?) OR p.name = ?)
    LIMIT 1`).get(st, st, appId, st, appId, developer) ?? null;
}

// Tất cả game của nhà phát hành một game (trang chi tiết game).
// Đang theo dõi: đọc từ database; chưa theo dõi: lấy trực tiếp trên store, lưu tạm 6 giờ.
const devCache = new Map();
const DEV_CACHE_MS = 6 * 3600 * 1000;

export async function developerApps(st, appId) {
  const app = db.prepare(`SELECT developer, dev_id FROM apps WHERE store = ? AND app_id = ?`).get(st, appId);
  if (!app) return { error: "Không tìm thấy game" };
  const followed = followedPublisherFor(st, appId, app.developer);
  if (followed) return { ...publisherDetail(followed.store, followed.devId), followed: true };

  // Google Play: tên tài khoản chính là mã; App Store: cần developerId
  let devId = st === "gplay" ? app.developer : app.dev_id;
  if (!devId) devId = st === "gplay" ? (await gplayDev(appId)).devId : String((await store.app({ id: appId })).developerId);
  const key = `${st}|${devId}`;
  const hit = devCache.get(key);
  if (hit && Date.now() - hit.at < DEV_CACHE_MS) return hit.data;

  let list = await storeDevApps(st, devId);
  // Tên trong chart đôi khi khác tên tài khoản: lấy lại tên chuẩn từ trang app
  if (!list.length && st === "gplay") {
    devId = (await gplayDev(appId)).devId;
    list = await storeDevApps(st, devId);
  }
  const ranks = new Map(db.prepare(`SELECT app_id, best, charts FROM (${latestRanks}) WHERE store = ?`).all(st)
    .map((r) => [r.app_id, r]));
  const apps = list.map((a) => ({
    appId: a.appId, title: a.title, icon: a.icon, url: a.url, score: a.score, released: a.released ?? null,
    ratings: a.ratings ?? null, bestRank: ranks.get(a.appId)?.best ?? null, charts: ranks.get(a.appId)?.charts ?? null,
  })).sort((x, y) => (x.bestRank == null) - (y.bestRank == null) || (x.bestRank ?? 0) - (y.bestRank ?? 0));
  const data = { publisher: { store: st, devId, name: list[0]?.developer ?? app.developer }, apps, followed: false };
  devCache.set(key, { at: Date.now(), data });
  return data;
}
