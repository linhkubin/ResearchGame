import { db, norm } from "./db.mjs";
import { SPARK_DAYS, CATEGORIES, COLLECTIONS, STORES, COUNTRIES, allCombos } from "./config.mjs";

const COMBO = `store = ? AND country = ? AND category = ? AND collection = ?`;
const comboArgs = (c) => [c.store, c.country, c.category, c.collection];

const shiftDate = (d, days) => {
  const t = new Date(d + "T00:00:00");
  t.setDate(t.getDate() - days);
  return t.toLocaleDateString("sv-SE");
};

export function datesFor(combo) {
  return db.prepare(`SELECT DISTINCT date FROM ranks WHERE ${COMBO} ORDER BY date DESC`)
    .all(...comboArgs(combo)).map((r) => r.date);
}

// Ngày để so sánh: snapshot gần nhất cách `date` ít nhất `days` ngày,
// nếu chưa đủ lịch sử thì lấy snapshot cũ nhất trước `date`
function pickCompareDate(dates, date, days) {
  const earlier = dates.filter((d) => d < date);
  if (!earlier.length) return null;
  const target = shiftDate(date, days);
  return earlier.find((d) => d <= target) ?? earlier[earlier.length - 1];
}

function ranksOn(combo, date) {
  return db.prepare(`SELECT rank, app_id FROM ranks WHERE ${COMBO} AND date = ?`)
    .all(...comboArgs(combo), date);
}

export function chart(combo, date, compareDays = 1) {
  const dates = datesFor(combo);
  if (!dates.length) return { date: null, compareDate: null, rows: [], dropped: [], dates };
  date = date && dates.includes(date) ? date : dates[0];
  const compareDate = pickCompareDate(dates, date, compareDays);

  const rows = db.prepare(`
    SELECT r.rank, r.app_id AS appId, a.title, a.developer, a.icon, a.url, a.score, a.genre, a.released
    FROM ranks r JOIN apps a ON a.store = r.store AND a.app_id = r.app_id
    WHERE r.store = ? AND r.country = ? AND r.category = ? AND r.collection = ? AND r.date = ?
    ORDER BY r.rank`).all(...comboArgs(combo), date);

  const prev = new Map(compareDate ? ranksOn(combo, compareDate).map((r) => [r.app_id, r.rank]) : []);

  // Sparkline: các ngày gần nhất tới `date`
  const sparkDates = dates.filter((d) => d <= date).slice(0, SPARK_DAYS).reverse();
  const spark = new Map();
  if (sparkDates.length) {
    const ph = sparkDates.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT date, app_id, rank FROM ranks WHERE ${COMBO} AND date IN (${ph})`)
      .all(...comboArgs(combo), ...sparkDates)) {
      if (!spark.has(r.app_id)) spark.set(r.app_id, new Array(sparkDates.length).fill(null));
      spark.get(r.app_id)[sparkDates.indexOf(r.date)] = r.rank;
    }
  }

  // Ngày đầu tiên app xuất hiện trong bảng này (kể từ khi bắt đầu theo dõi)
  const firstSeen = new Map(db.prepare(
    `SELECT app_id, MIN(date) AS d FROM ranks WHERE ${COMBO} GROUP BY app_id`).all(...comboArgs(combo))
    .map((r) => [r.app_id, r.d]));

  // Độ sâu bảng ngày so sánh: nếu hôm đó chỉ lấy 100 thì app hạng 150 hôm nay chưa chắc là "mới"
  const prevDepth = prev.size ? Math.max(...prev.values()) : 0;
  const current = new Set();
  for (const r of rows) {
    current.add(r.appId);
    const p = prev.get(r.appId);
    r.prevRank = p ?? null;
    r.delta = p != null ? p - r.rank : null;
    r.isNew = compareDate != null && p == null && r.rank <= prevDepth;
    r.spark = spark.get(r.appId) ?? [];
    r.firstSeen = firstSeen.get(r.appId) ?? null;
  }

  const dropped = [];
  if (compareDate) {
    const info = db.prepare(`SELECT title, developer, icon, url FROM apps WHERE store = ? AND app_id = ?`);
    const depth = rows.length;
    for (const [appId, rank] of prev)
      if (!current.has(appId) && rank <= depth) dropped.push({ appId, prevRank: rank, ...info.get(combo.store, appId) });
    dropped.sort((a, b) => a.prevRank - b.prevRank);
  }

  return { date, compareDate, rows, dropped, dates, sparkDates };
}

export function history(combo, appId) {
  return db.prepare(`SELECT date, rank FROM ranks WHERE ${COMBO} AND app_id = ? ORDER BY date`)
    .all(...comboArgs(combo), appId);
}

// Mọi bảng mà app đang có mặt ở ngày mới nhất của bảng đó
export function appPresence(store, appId) {
  return db.prepare(`
    SELECT r.country, r.category, r.collection, r.rank, r.date FROM ranks r
    JOIN (SELECT country, category, collection, MAX(date) AS d FROM ranks WHERE store = ?
          GROUP BY country, category, collection) m
      ON r.country = m.country AND r.category = m.category AND r.collection = m.collection AND r.date = m.d
    WHERE r.store = ? AND r.app_id = ? ORDER BY r.rank`).all(store, store, appId);
}

// Tổng quan một quốc gia: app tăng hạng mạnh và app mới vào top trên mọi bảng
export function overview(country, compareDays = 1, minDelta = 10, newMaxRank = 50) {
  const climbers = [], newcomers = [];
  let compared = 0, latest = null;
  for (const combo of allCombos().filter((c) => c.country === country)) {
    const c = chart(combo, null, compareDays);
    if (!c.date) continue;
    latest = !latest || c.date > latest ? c.date : latest;
    if (!c.compareDate) continue;
    compared++;
    const label = {
      store: combo.store,
      storeName: STORES.find((s) => s.key === combo.store).name,
      category: combo.category,
      categoryName: CATEGORIES.find((x) => x.key === combo.category).name,
      collection: combo.collection,
      collectionName: COLLECTIONS.find((x) => x.key === combo.collection).name,
      date: c.date, compareDate: c.compareDate,
    };
    for (const r of c.rows) {
      const item = { ...label, appId: r.appId, title: r.title, developer: r.developer, icon: r.icon,
        url: r.url, rank: r.rank, prevRank: r.prevRank, delta: r.delta };
      if (r.delta != null && r.delta >= minDelta) climbers.push(item);
      if (r.isNew && r.rank <= newMaxRank) newcomers.push(item);
    }
  }
  climbers.sort((a, b) => b.delta - a.delta);
  newcomers.sort((a, b) => a.rank - b.rank);

  // App xuất hiện nổi bật trên nhiều bảng cùng lúc = tín hiệu mạnh
  const byApp = new Map();
  for (const it of [...climbers, ...newcomers]) {
    const k = it.store + ":" + it.appId;
    if (!byApp.has(k)) byApp.set(k, { ...it, hits: [] });
    byApp.get(k).hits.push(it);
  }
  const multi = [...byApp.values()].filter((x) => x.hits.length >= 2)
    .sort((a, b) => b.hits.length - a.hits.length);

  return { country, latest, compared, climbers, newcomers, multi };
}

// ---------- tìm kiếm toàn cục ----------

const latestPerCombo = `
  SELECT store, country, category, collection, MAX(date) AS d FROM ranks
  GROUP BY store, country, category, collection`;

// Tìm game theo tên hoặc nhà phát hành (không dấu), kèm vị trí hiện tại trong các bảng
export function search(q, limit = 25) {
  const needle = norm(q);
  if (needle.length < 2) return [];
  const apps = db.prepare(`
    SELECT store, app_id AS appId, title, developer, icon, url, last_seen AS lastSeen
    FROM apps WHERE search_norm LIKE ? ORDER BY last_seen DESC LIMIT 200`).all(`%${needle}%`);
  if (!apps.length) return [];

  const now = db.prepare(`
    SELECT r.rank, r.country, r.category, r.collection FROM ranks r
    JOIN (${latestPerCombo}) m ON r.store = m.store AND r.country = m.country
      AND r.category = m.category AND r.collection = m.collection AND r.date = m.d
    WHERE r.store = ? AND r.app_id = ? ORDER BY r.rank`);
  const last = db.prepare(`SELECT date, rank FROM ranks WHERE store = ? AND app_id = ? ORDER BY date DESC, rank LIMIT 1`);

  return apps.map((a) => {
    const present = now.all(a.store, a.appId);
    const titleHit = norm(a.title).includes(needle);
    return {
      ...a, titleHit,
      charts: present.length,
      best: present[0] ?? null,
      last: present.length ? null : last.get(a.store, a.appId) ?? null,
    };
  }).sort((x, y) => (y.titleHit - x.titleHit) || ((x.best?.rank ?? 1e9) - (y.best?.rank ?? 1e9))
    || (y.charts - x.charts) || String(y.lastSeen).localeCompare(String(x.lastSeen)))
    .slice(0, limit);
}

// ---------- trang chi tiết game ----------

export function gameDetail(store, appId) {
  const app = db.prepare(`SELECT store, app_id AS appId, title, developer, icon, url, score, genre, released,
    first_seen AS firstSeen, last_seen AS lastSeen, dev_id AS devId FROM apps WHERE store = ? AND app_id = ?`)
    .get(store, appId);
  if (!app) return null;

  // Mọi ngày đã có dữ liệu của store này (để biết ngày nào game vắng mặt)
  const dates = db.prepare(`SELECT DISTINCT date FROM ranks WHERE store = ? ORDER BY date`).all(store).map((r) => r.date);
  const rows = db.prepare(`SELECT date, country, category, collection, rank FROM ranks
    WHERE store = ? AND app_id = ? ORDER BY date`).all(store, appId);

  const seriesMap = new Map();
  for (const r of rows) {
    const key = `${r.country}|${r.category}|${r.collection}`;
    if (!seriesMap.has(key)) seriesMap.set(key, {
      key, country: r.country, category: r.category, collection: r.collection,
      countryName: COUNTRIES.find((c) => c.code === r.country)?.name ?? r.country,
      categoryName: CATEGORIES.find((c) => c.key === r.category)?.name ?? r.category,
      collectionName: COLLECTIONS.find((c) => c.key === r.collection)?.name ?? r.collection,
      ranks: {},
    });
    seriesMap.get(key).ranks[r.date] = r.rank;
  }

  // Ngày đầu tiên mỗi bảng có dữ liệu, để phân biệt "rơi khỏi bảng" với "chưa theo dõi"
  const comboStart = new Map(db.prepare(`SELECT country || '|' || category || '|' || collection AS k, MIN(date) AS d
    FROM ranks WHERE store = ? GROUP BY country, category, collection`).all(store).map((r) => [r.k, r.d]));

  const series = [...seriesMap.values()].map((s) => {
    const ds = Object.keys(s.ranks).sort();
    const latestDate = dates[dates.length - 1];
    const current = s.ranks[latestDate] ?? null;
    let bestRank = Infinity, bestDate = null, bigJump = 0, bigJumpDate = null;
    for (let i = 0; i < ds.length; i++) {
      const r = s.ranks[ds[i]];
      if (r < bestRank) { bestRank = r; bestDate = ds[i]; }
      const prev = s.ranks[dates[dates.indexOf(ds[i]) - 1]];
      if (prev != null && prev - r > bigJump) { bigJump = prev - r; bigJumpDate = ds[i]; }
    }
    // Xu hướng 7 ngày: hạng hiện tại so với ngày gần nhất cách >= 7 ngày (hoặc ngày cũ nhất có)
    const weekAgo = [...ds].reverse().find((d) => d <= shiftDate(latestDate, 7)) ?? ds[0];
    const trend7 = current != null && weekAgo !== latestDate ? s.ranks[weekAgo] - current : null;
    return { ...s, start: comboStart.get(s.key), current, bestRank, bestDate, bigJump, bigJumpDate,
      daysIn: ds.length, firstDate: ds[0], trend7 };
  }).sort((a, b) => (a.current ?? 1e9) - (b.current ?? 1e9) || a.bestRank - b.bestRank);

  const best = series.reduce((m, s) => (!m || s.bestRank < m.bestRank ? s : m), null);
  const jump = series.reduce((m, s) => (!m || s.bigJump > m.bigJump ? s : m), null);
  const stats = {
    bestRank: best?.bestRank ?? null, bestDate: best?.bestDate ?? null, bestChart: best?.key ?? null,
    daysInChart: new Set(rows.map((r) => r.date)).size,
    firstInChart: rows[0]?.date ?? null,
    chartsNow: series.filter((s) => s.current != null).length,
    bigJump: jump?.bigJump || 0, bigJumpDate: jump?.bigJump ? jump.bigJumpDate : null, bigJumpChart: jump?.bigJump ? jump.key : null,
  };
  return { app, dates, series, stats };
}
