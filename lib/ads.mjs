import { existsSync } from "node:fs";
import { db, norm, today } from "./db.mjs";
import { ADS, STORES } from "./config.mjs";
import { overview } from "./queries.mjs";

// Quét quảng cáo đang chạy trên Meta Ad Library.
// Trang chặn request thường (403) nên mở bằng Edge/Chrome ẩn qua puppeteer-core,
// rồi đọc JSON mà trang tự tải (search_results_connection) thay vì đọc giao diện.

db.exec(`
  CREATE TABLE IF NOT EXISTS ad_games (
    game_key TEXT PRIMARY KEY,
    name TEXT, query TEXT,
    ios_id TEXT, gplay_id TEXT,
    store TEXT, app_id TEXT, icon TEXT,
    page_ids TEXT,
    manual INTEGER DEFAULT 0,
    last_scan TEXT, last_error TEXT, ad_count INTEGER
  );
  CREATE TABLE IF NOT EXISTS ads (
    ad_id TEXT PRIMARY KEY,
    game_key TEXT NOT NULL,
    page_id TEXT, page_name TEXT,
    collation_count INTEGER,
    start_date TEXT, end_date TEXT,
    platforms TEXT, display_format TEXT, cta_text TEXT,
    title TEXT, body TEXT, link_url TEXT, thumb TEXT, video_url TEXT,
    impr_pos INTEGER, impr_total INTEGER,
    first_seen TEXT, last_seen TEXT
  );
  CREATE INDEX IF NOT EXISTS ads_game ON ads (game_key, last_seen);
`);

export const adsStatus = { running: false, done: 0, total: 0, current: null, errors: [], finishedAt: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unixDate = (s) => (s ? new Date(s * 1000).toLocaleDateString("sv-SE") : null);
// Tên ngắn: bỏ phần phụ đề sau " - " hoặc ":" ("Meowdoku: Brain Puzzle Games" -> "Meowdoku")
export const shortTitle = (t) => String(t ?? "").split(/\s[-–—|]\s|:/)[0].trim();
const gameKey = (t) => norm(shortTitle(t)).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---------- chọn game cần quét ----------

const latestTop = db.prepare(`
  SELECT r.app_id AS appId, a.title, a.icon FROM ranks r JOIN apps a ON a.store = r.store AND a.app_id = r.app_id
  WHERE r.store = ? AND r.country = ? AND r.category = 'all' AND r.collection = ? AND r.rank <= ?
    AND r.date = (SELECT MAX(date) FROM ranks WHERE store = ? AND country = ? AND category = 'all' AND collection = ?)
  ORDER BY r.rank`);

// Ghép bản Google Play và App Store của cùng một game (theo tên ngắn) để có cả hai ID khớp link quảng cáo
let appIndex = null;
function storeIds(key) {
  if (!appIndex) {
    appIndex = new Map();
    for (const a of db.prepare(`SELECT store, app_id, title FROM apps ORDER BY last_seen DESC`).all()) {
      const k = gameKey(a.title);
      if (!appIndex.has(k)) appIndex.set(k, {});
      appIndex.get(k)[a.store] ??= a.app_id;
    }
  }
  return appIndex.get(key) ?? {};
}

const upsertGame = db.prepare(`
  INSERT INTO ad_games (game_key, name, query, ios_id, gplay_id, store, app_id, icon, manual)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (game_key) DO UPDATE SET
    ios_id = COALESCE(excluded.ios_id, ad_games.ios_id), gplay_id = COALESCE(excluded.gplay_id, ad_games.gplay_id),
    icon = COALESCE(excluded.icon, ad_games.icon), manual = MAX(ad_games.manual, excluded.manual)`);

function registerGame(app, manual = 0) {
  const key = gameKey(app.title);
  if (!key) return null;
  appIndex = null;
  const ids = storeIds(key);
  upsertGame.run(key, shortTitle(app.title), shortTitle(app.title), ids.ios ?? null, ids.gplay ?? null,
    app.store, app.appId, app.icon ?? null, manual);
  return key;
}

export function pickGames() {
  const picked = [];
  const add = (app) => {
    const k = gameKey(app.title);
    if (k && !picked.some((p) => p.key === k)) picked.push({ key: k, app });
  };
  for (const country of ADS.countries) {
    const ov = overview(country, 1);
    for (const it of [...ov.multi, ...ov.climbers, ...ov.newcomers]) add(it);
    for (const s of STORES)
      for (const col of ["free", "grossing"])
        for (const r of latestTop.all(s.key, country, col, ADS.topN, s.key, country, col)) add({ ...r, store: s.key });
  }
  const keys = picked.slice(0, ADS.maxGames).map((p) => registerGame(p.app));
  // Game thêm tay luôn được quét
  for (const r of db.prepare(`SELECT game_key FROM ad_games WHERE manual = 1`).all())
    if (!keys.includes(r.game_key)) keys.push(r.game_key);
  return keys;
}

// ---------- trình duyệt ----------

const BROWSER_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

async function launch() {
  const { default: puppeteer } = await import("puppeteer-core");
  const executablePath = ADS.browserPath || BROWSER_PATHS.find((p) => existsSync(p));
  if (!executablePath) throw new Error("Không tìm thấy Edge/Chrome. Đặt ADS.browserPath trong config.mjs");
  return puppeteer.launch({ executablePath, headless: true, args: ["--lang=en-US"] });
}

// Lấy các nhóm quảng cáo (collated) từ một object JSON bất kỳ
function collectGroups(obj, out) {
  if (!obj || typeof obj !== "object") return;
  if (obj.search_results_connection?.edges) {
    for (const e of obj.search_results_connection.edges) {
      const first = e?.node?.collated_results?.[0];
      if (first?.ad_archive_id) out.push(first);
    }
    return;
  }
  for (const k in obj) collectGroups(obj[k], out);
}

function parseJsonLines(text, out) {
  for (const line of text.split("\n")) {
    if (!line.includes("search_results_connection")) continue;
    try { collectGroups(JSON.parse(line), out); } catch {}
  }
}

// Mở một trang kết quả Ad Library, cuộn để tải thêm; trả nhóm quảng cáo theo đúng thứ tự trang hiển thị
// (mặc định Meta sắp theo tổng lượt hiển thị giảm dần)
async function collect(browser, url, scrolls) {
  const page = await browser.newPage();
  const responses = [];
  try {
    await page.setViewport({ width: 1280, height: 1000 });
    await page.setRequestInterception(true);
    page.on("request", (req) => (["image", "media", "font"].includes(req.resourceType()) ? req.abort() : req.continue()));
    page.on("response", async (res) => {
      if (!res.url().includes("/api/graphql")) return;
      try { responses.push(await res.text()); } catch {}
    });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    const groups = [];
    // Trang đầu nằm sẵn trong HTML
    const html = await page.content();
    for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g))
      if (m[1].includes("search_results_connection")) parseJsonLines(m[1], groups);

    let seen = 0;
    for (let i = 0; i < scrolls; i++) {
      const before = responses.length;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      for (let t = 0; t < 16 && responses.length === before; t++) await sleep(250);
      if (responses.length === before) break; // hết kết quả
      await sleep(600);
    }
    for (const r of responses) parseJsonLines(r, groups);
    seen = groups.length;
    if (!seen && /log in|đăng nhập/i.test(await page.title())) throw new Error("Ad Library yêu cầu đăng nhập");

    const uniq = new Map();
    for (const g of groups) if (!uniq.has(g.ad_archive_id)) uniq.set(g.ad_archive_id, g);
    return [...uniq.values()];
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- khớp quảng cáo với game ----------

function linkIds(ad) {
  const s = `${ad.snapshot?.link_url ?? ""} ${ad.snapshot?.cards?.map((c) => c.link_url).join(" ") ?? ""}`;
  const ios = [...s.matchAll(/\bid(\d{6,12})\b/g)].map((m) => m[1]);
  const gplay = [
    ...[...s.matchAll(/[?&]id=([a-zA-Z]\w*(?:\.\w+)+)/g)].map((m) => m[1]),
    ...[...s.matchAll(/appsflyer\.com\/([a-zA-Z]\w*(?:\.\w+)+)/g)].map((m) => m[1]),
  ];
  return { ios, gplay, any: ios.length + gplay.length > 0 };
}

// "id": link trỏ đúng app · "name": tên trang/tiêu đề chứa tên game · "other": link trỏ app khác · null: không rõ
function matchKind(ad, g) {
  const ids = linkIds(ad);
  if ((g.ios_id && ids.ios.includes(g.ios_id)) || (g.gplay_id && ids.gplay.includes(g.gplay_id))) return "id";
  if (ids.any) return "other";
  const hay = norm(`${ad.page_name ?? ""} ${ad.snapshot?.title ?? ""}`).replace(/[^\p{L}\p{N}]+/gu, " ");
  return hay.includes(g.game_key) ? "name" : null;
}

const base = () => `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${ADS.adCountry}&media_type=all`;

function thumbOf(snap) {
  const card = snap?.cards?.[0];
  return snap?.videos?.[0]?.video_preview_image_url ?? snap?.images?.[0]?.resized_image_url
    ?? snap?.images?.[0]?.original_image_url ?? card?.video_preview_image_url ?? card?.resized_image_url
    ?? card?.original_image_url ?? null;
}
const videoOf = (snap) => snap?.videos?.[0]?.video_sd_url ?? snap?.videos?.[0]?.video_hd_url
  ?? snap?.cards?.[0]?.video_sd_url ?? null;
// Một số mẫu quảng cáo động chèn biến {{product.name}}: bỏ cho dễ đọc
const clean = (s) => (s ? String(s).replace(/\{\{[^}]+\}\}/g, "").trim() || null : null);

const upsertAd = db.prepare(`
  INSERT INTO ads (ad_id, game_key, page_id, page_name, collation_count, start_date, end_date, platforms,
    display_format, cta_text, title, body, link_url, thumb, video_url, impr_pos, impr_total, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (ad_id) DO UPDATE SET
    game_key = excluded.game_key, page_name = excluded.page_name, collation_count = excluded.collation_count,
    end_date = excluded.end_date, platforms = excluded.platforms, thumb = excluded.thumb, video_url = excluded.video_url,
    impr_pos = excluded.impr_pos, impr_total = excluded.impr_total, last_seen = excluded.last_seen`);

async function scanGame(browser, g) {
  // 1. Tìm theo từ khoá để biết trang nhà quảng cáo của game
  const kw = await collect(browser, `${base()}&q=${encodeURIComponent(g.query)}&search_type=keyword_unordered`, 2);
  const pages = new Map(JSON.parse(g.page_ids ?? "[]").map((p) => [p, 3]));
  for (const ad of kw) {
    const k = matchKind(ad, g);
    if (k === "id" || k === "name") pages.set(ad.page_id, (pages.get(ad.page_id) ?? 0) + (k === "id" ? 2 : 1));
  }
  const pageIds = [...pages].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([p]) => p);

  // 2. Lấy toàn bộ quảng cáo đang chạy của các trang đó; mỗi trang có thứ tự lượt hiển thị riêng
  const lists = [];
  for (const pid of pageIds) {
    const ads = await collect(browser, `${base()}&search_type=page&view_all_page_id=${pid}`, ADS.pageScrolls);
    // Trang của nhà phát hành có thể quảng cáo nhiều game: bỏ quảng cáo trỏ tới app khác
    lists.push(ads.filter((ad) => matchKind(ad, g) !== "other"));
    await sleep(1500);
  }
  if (!lists.length) lists.push(kw.filter((ad) => ["id", "name"].includes(matchKind(ad, g))));

  const date = today();
  let count = 0;
  db.exec("BEGIN");
  try {
    for (const list of lists)
      list.forEach((ad, i) => {
        const s = ad.snapshot ?? {};
        upsertAd.run(ad.ad_archive_id, g.game_key, ad.page_id, ad.page_name, ad.collation_count ?? 1,
          unixDate(ad.start_date), unixDate(ad.end_date), (ad.publisher_platform ?? []).join(","),
          s.display_format ?? null, s.cta_text ?? null, clean(s.title ?? s.cards?.[0]?.title),
          clean(s.body?.text ?? s.cards?.[0]?.body), s.link_url ?? s.cards?.[0]?.link_url ?? null,
          thumbOf(s), videoOf(s), i, list.length, date, date);
        count++;
      });
    db.prepare(`UPDATE ad_games SET last_scan = ?, last_error = NULL, ad_count = ?, page_ids = ? WHERE game_key = ?`)
      .run(date, count, JSON.stringify(pageIds), g.game_key);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return count;
}

const getGame = db.prepare(`SELECT * FROM ad_games WHERE game_key = ?`);

export async function runAdsFetch(keys = null) {
  if (adsStatus.running) return false;
  Object.assign(adsStatus, { running: true, done: 0, total: 0, current: null, errors: [] });
  let browser;
  try {
    keys ??= pickGames();
    adsStatus.total = keys.length;
    browser = await launch();
    for (const key of keys) {
      const g = getGame.get(key);
      adsStatus.current = g?.name ?? key;
      try {
        if (g) await scanGame(browser, g);
      } catch (e) {
        const msg = String(e.message ?? e).slice(0, 300);
        adsStatus.errors.push({ game: g?.name ?? key, error: msg });
        db.prepare(`UPDATE ad_games SET last_error = ? WHERE game_key = ?`).run(msg, key);
      }
      adsStatus.done++;
    }
  } finally {
    await browser?.close().catch(() => {});
    Object.assign(adsStatus, { running: false, current: null, finishedAt: new Date().toISOString() });
  }
  return true;
}

// Quét ngay một game (từ trang chi tiết game), đồng thời đưa vào danh sách quét hằng ngày
export function scanOne(store, appId) {
  const app = db.prepare(`SELECT store, app_id AS appId, title, icon FROM apps WHERE store = ? AND app_id = ?`).get(store, appId);
  if (!app) return { error: "Không tìm thấy game" };
  const key = registerGame(app, 1);
  if (adsStatus.running) return { key, started: false, error: "Đang quét game khác, thử lại sau" };
  runAdsFetch([key]).catch((e) => console.error("[ads] lỗi:", e));
  return { key, started: true };
}

export function unfollowGame(key) {
  db.prepare(`UPDATE ad_games SET manual = 0 WHERE game_key = ?`).run(key);
}

// ---------- truy vấn + chấm điểm ----------

const daysBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5) + 1);

export function listAds({ game = null, format = null, sort = "score", onlyNew = false, minDays = 0, q = "", limit = 300 } = {}) {
  const w = ADS.weights;
  const games = db.prepare(`SELECT game_key AS key, name, store, app_id AS appId, icon, manual, last_scan AS lastScan,
    last_error AS lastError, ad_count AS adCount FROM ad_games WHERE last_scan IS NOT NULL OR manual = 1 ORDER BY name`).all();
  // Chỉ lấy quảng cáo còn thấy ở lần quét gần nhất của game (đang chạy)
  const rows = db.prepare(`SELECT a.*, g.name AS game_name, g.store, g.app_id AS appId, g.icon
    FROM ads a JOIN ad_games g ON g.game_key = a.game_key AND a.last_seen = g.last_scan
    WHERE (? IS NULL OR a.game_key = ?)`).all(game, game);

  const now = today();
  const needle = norm(q);
  let items = rows.map((r) => {
    const days = daysBetween(r.start_date, r.end_date ?? now);
    const platforms = r.platforms ? r.platforms.split(",") : [];
    const parts = {
      days: Math.min(days, 90) / 90,
      impressions: r.impr_total > 1 ? 1 - r.impr_pos / (r.impr_total - 1) : 1,
      variants: Math.log(1 + Math.min(r.collation_count ?? 1, 50)) / Math.log(51),
      platforms: Math.min(platforms.length, 5) / 5,
    };
    const score = Math.round(100 * (w.days * parts.days + w.impressions * parts.impressions
      + w.variants * parts.variants + w.platforms * parts.platforms));
    return {
      id: r.ad_id, game: r.game_key, gameName: r.game_name, store: r.store, appId: r.appId, icon: r.icon,
      page: r.page_name, startDate: r.start_date, endDate: r.end_date, days, variants: r.collation_count ?? 1,
      platforms, format: r.display_format, cta: r.cta_text, title: r.title, body: r.body, link: r.link_url,
      thumb: r.thumb, video: r.video_url, imprRank: r.impr_pos + 1, imprTotal: r.impr_total,
      isNew: daysBetween(r.start_date, now) <= ADS.newDays, firstSeen: r.first_seen, score, parts,
      libraryUrl: `https://www.facebook.com/ads/library/?id=${r.ad_id}`,
    };
  });

  const formats = [...new Set(items.map((i) => i.format).filter(Boolean))].sort();
  if (format) items = items.filter((i) => i.format === format);
  if (onlyNew) items = items.filter((i) => i.isNew);
  if (minDays) items = items.filter((i) => i.days >= minDays);
  if (needle) items = items.filter((i) => norm(`${i.title} ${i.body} ${i.gameName} ${i.page}`).includes(needle));

  const sorters = {
    score: (a, b) => b.score - a.score,
    days: (a, b) => b.days - a.days,
    impressions: (a, b) => a.imprRank / a.imprTotal - b.imprRank / b.imprTotal,
    variants: (a, b) => b.variants - a.variants,
    newest: (a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""),
  };
  items.sort(sorters[sort] ?? sorters.score);

  return {
    total: items.length, items: items.slice(0, limit), games, formats, weights: w,
    status: { running: adsStatus.running, done: adsStatus.done, total: adsStatus.total, current: adsStatus.current,
      errors: adsStatus.errors, finishedAt: adsStatus.finishedAt },
  };
}

export function gameKeyForApp(store, appId) {
  const app = db.prepare(`SELECT title FROM apps WHERE store = ? AND app_id = ?`).get(store, appId);
  return app ? gameKey(app.title) : null;
}
