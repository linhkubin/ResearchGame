import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { db } from "./db.mjs";
import { NEWS_SOURCES, NEWS_MAX_AGE_DAYS, STORES, COUNTRIES, CATEGORIES, COLLECTIONS } from "./config.mjs";
import { overview } from "./queries.mjs";

db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    published TEXT,
    summary TEXT,
    fetched_at TEXT
  );
  CREATE INDEX IF NOT EXISTS news_published ON news (published);
`);

const UA = "Mozilla/5.0 (ChartTracker; personal RSS reader)";
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

const text = (v) => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  return text(v["#text"] ?? v["@href"] ?? "");
};
const stripHtml = (s) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&#8217;|&rsquo;/g, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, "&").replace(/&#\d+;/g, " ")
  .replace(/\s+/g, " ").trim();
const toIso = (d) => {
  const t = new Date(d);
  return isNaN(t) ? null : t.toISOString();
};
const MOBILE_RE = /\b(mobile|ios|android|iphone|app store|google play)\b/i;

function parseFeed(body) {
  const doc = xml.parse(body);
  const rssItems = doc.rss?.channel?.item;
  const atomItems = doc.feed?.entry;
  const items = [].concat(rssItems ?? atomItems ?? []);
  return items.map((it) => {
    const link = Array.isArray(it.link)
      ? text(it.link.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? it.link[0])
      : text(it.link);
    return {
      title: stripHtml(text(it.title)),
      link: link.trim(),
      published: toIso(text(it.pubDate ?? it.published ?? it.updated ?? it["dc:date"])),
      summary: stripHtml(text(it.description ?? it.summary ?? it["content:encoded"] ?? it.content)).slice(0, 400),
    };
  });
}

// Sensor Tower không có RSS: đọc thẻ bài trên trang blog, chỉ giữ bài mục Gaming
function parseSensorTower(html) {
  const out = [];
  const re = /aria-label="([^"]*)"\s+href="(\/blog\/[a-z0-9-]+)"/g;
  for (const m of html.matchAll(re)) {
    const [, label, path] = m;
    if (!/gaming|game/i.test(label + path)) continue;
    const slug = path.split("/").pop();
    const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const monthYear = label.split("•")[1]?.trim();
    out.push({
      title,
      link: "https://sensortower.com" + path,
      published: monthYear ? toIso("1 " + monthYear) : null,
      summary: label,
    });
  }
  return out;
}

async function fetchSource(src) {
  const res = await fetch(src.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  let items = src.type === "sensortower" ? parseSensorTower(body) : parseFeed(body);
  if (src.mobileOnly) items = items.filter((i) => MOBILE_RE.test(i.title + " " + i.summary));
  return items.filter((i) => i.title && /^https?:\/\//.test(i.link));
}

const upsert = db.prepare(`
  INSERT INTO news (id, source, title, link, published, summary, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
    published = COALESCE(news.published, excluded.published)
`);

export const newsStatus = { running: false, lastFetch: null, errors: [] };

export async function runNewsFetch() {
  if (newsStatus.running) return false;
  newsStatus.running = true;
  const errors = [];
  const now = new Date().toISOString();
  const cutoff = Date.now() - NEWS_MAX_AGE_DAYS * 864e5;
  try {
    const results = await Promise.allSettled(NEWS_SOURCES.map(fetchSource));
    results.forEach((r, i) => {
      const src = NEWS_SOURCES[i];
      if (r.status === "rejected") return errors.push({ source: src.key, error: String(r.reason?.message ?? r.reason) });
      for (const it of r.value) {
        // Bài không có ngày (hiếm) thì lấy thời điểm thấy lần đầu
        const published = it.published ?? now;
        if (new Date(published).getTime() < cutoff) continue;
        const id = createHash("sha1").update(it.link).digest("hex");
        upsert.run(id, src.key, it.title, it.link, published, it.summary, now);
      }
    });
  } finally {
    Object.assign(newsStatus, { running: false, lastFetch: now, errors });
  }
  return true;
}

// ---------- ghép tên game trong chart với nội dung bài ----------

// Tên quá chung chung dễ khớp nhầm
const GENERIC = new Set(["solitaire", "sudoku", "mahjong", "chess", "checkers", "puzzle", "word search", "crossword",
  "bingo", "slots", "poker", "blackjack", "dominoes", "domino", "ludo", "spider solitaire", "jigsaw puzzles",
  "block puzzle", "word game", "words", "pool", "snake", "tiles", "match", "merge", "racing", "golf", "bowling",
  "minecraft education", "free fire", "hidden objects", "coloring", "color by number", "draw", "idle", "survival"]);

function gameName(title) {
  const name = title.split(/\s[-–—|]\s|[:(]/)[0].replace(/[!™®]+/g, "").trim();
  const lower = name.toLowerCase();
  if (lower.length < 4 || GENERIC.has(lower)) return null;
  // Một từ ngắn dễ trùng từ thường (vd "Hero", "Fury"); một từ thì phải viết hoa chữ đầu
  if (!/\s/.test(lower) && (lower.length < 6 || !/^\p{Lu}/u.test(name))) return null;
  return name;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let gameCache = { key: null, list: [] };

// Danh sách tên game ở snapshot mới nhất, kèm thứ hạng tốt nhất và cờ "đang tăng"
function chartGames() {
  const latest = db.prepare(`SELECT MAX(date) AS d FROM ranks`).get()?.d;
  if (!latest) return [];
  if (gameCache.key === latest) return gameCache.list;

  const climbing = new Set();
  for (const c of COUNTRIES) {
    const ov = overview(c.code, 7);
    for (const x of [...ov.climbers, ...ov.newcomers]) climbing.add(x.store + ":" + x.appId);
  }

  const rows = db.prepare(`
    SELECT r.store, r.app_id, r.country, r.category, r.collection, r.rank, a.title, a.icon
    FROM ranks r JOIN apps a ON a.store = r.store AND a.app_id = r.app_id
    JOIN (SELECT store, country, category, collection, MAX(date) AS d FROM ranks
          GROUP BY store, country, category, collection) m
      ON r.store = m.store AND r.country = m.country AND r.category = m.category
     AND r.collection = m.collection AND r.date = m.d
    ORDER BY r.rank`).all();

  const byName = new Map();
  for (const r of rows) {
    const name = gameName(r.title);
    if (!name) continue;
    const key = name.toLowerCase();
    // Giữ thứ hạng tốt nhất cho mỗi tên (rows đã sắp theo hạng)
    if (!byName.has(key)) {
      byName.set(key, {
        // Tên một từ (vd "Difference") phải khớp đúng chữ hoa như danh từ riêng, tránh trùng từ thường
        name, re: /\s/.test(name)
          ? new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(key)}($|[^\\p{L}\\p{N}])`, "iu")
          : new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(name)}($|[^\\p{L}\\p{N}])`, "u"),
        store: r.store, appId: r.app_id, title: r.title, icon: r.icon, country: r.country,
        category: r.category, collection: r.collection, rank: r.rank, climbing: false,
      });
    }
    const g = byName.get(key);
    if (climbing.has(r.store + ":" + r.app_id)) g.climbing = true;
  }
  gameCache = { key: latest, list: [...byName.values()] };
  return gameCache.list;
}

const DATA_RE = /\b(top[- ]?\d+|charts?|downloads?|revenue|grossing|installs|rankings?|appmagic|sensor tower|market index|h[12] 20\d\d|q[1-4] 20\d\d|monthly|biggest|most downloaded|earnings)\b/i;

const label = (list, key, field = "key") => list.find((x) => x[field] === key)?.name ?? key;

export function listNews({ source, onlyData, onlyMatched, q, days = 60 } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const params = [since];
  let sql = `SELECT * FROM news WHERE published >= ?`;
  if (source) { sql += ` AND source = ?`; params.push(source); }
  sql += ` ORDER BY published DESC LIMIT 400`;
  const games = chartGames();
  const needle = q?.trim().toLowerCase();

  const items = [];
  for (const n of db.prepare(sql).all(...params)) {
    const hay = `${n.title} ${n.summary ?? ""}`;
    if (needle && !hay.toLowerCase().includes(needle)) continue;
    const lower = hay.toLowerCase();
    const hits = games.filter((g) => lower.includes(g.name.toLowerCase()) && g.re.test(hay));
    // Bỏ tên nằm trong tên dài hơn cũng khớp (vd "Monopoly" khi đã có "Monopoly Go")
    const matched = hits.filter((g) => !hits.some((o) => o !== g && o.name.length > g.name.length
        && o.name.toLowerCase().includes(g.name.toLowerCase()))).slice(0, 8)
      .map((g) => ({
        name: g.name, title: g.title, icon: g.icon, store: g.store, appId: g.appId, country: g.country,
        category: g.category, collection: g.collection, rank: g.rank, climbing: g.climbing,
        label: `${label(STORES, g.store)} · ${label(COUNTRIES, g.country, "code")} · ${label(CATEGORIES, g.category)} · ${label(COLLECTIONS, g.collection)}`,
      }));
    const isData = DATA_RE.test(n.title);
    if (onlyData && !isData) continue;
    if (onlyMatched && !matched.length) continue;
    items.push({ ...n, sourceName: label(NEWS_SOURCES, n.source), isData, games: matched });
  }
  return { items, status: newsStatus, sources: NEWS_SOURCES.map(({ key, name }) => ({ key, name })) };
}
