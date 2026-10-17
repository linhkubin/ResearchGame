import { existsSync } from "node:fs";
import { db, norm, today } from "./db.mjs";
import { ADS, STORES } from "./config.mjs";
import { overview } from "./queries.mjs";
import { scanApple, scanGoogle } from "./adsources.mjs";

// Kho quảng cáo chung của ba nguồn: Meta Ad Library, Apple Ad Repository (App Store), Google Ads Transparency.
// Meta: trang chặn request thường (403) nên mở bằng Edge/Chrome ẩn qua puppeteer-core,
// rồi đọc JSON mà trang tự tải (search_results_connection) thay vì đọc giao diện.
// App Store, Google: xem lib/adsources.mjs.

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
const adCols = new Set(db.prepare(`PRAGMA table_info(ads)`).all().map((c) => c.name));
if (!adCols.has("source")) db.exec(`ALTER TABLE ads ADD COLUMN source TEXT NOT NULL DEFAULT 'meta'`);
if (!adCols.has("library_url")) db.exec(`ALTER TABLE ads ADD COLUMN library_url TEXT`);

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
    display_format, cta_text, title, body, link_url, thumb, video_url, impr_pos, impr_total, first_seen, last_seen,
    source, library_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (ad_id) DO UPDATE SET
    game_key = excluded.game_key, page_name = excluded.page_name, collation_count = excluded.collation_count,
    start_date = COALESCE(excluded.start_date, ads.start_date), end_date = excluded.end_date, platforms = excluded.platforms,
    body = excluded.body, thumb = excluded.thumb, video_url = excluded.video_url,
    impr_pos = excluded.impr_pos, impr_total = excluded.impr_total, last_seen = excluded.last_seen,
    library_url = excluded.library_url`);

async function scanMeta(browser, g) {
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

  const out = [];
  for (const list of lists)
    list.forEach((ad, i) => {
      const sn = ad.snapshot ?? {};
      out.push({
        id: ad.ad_archive_id, page: ad.page_name, pageId: ad.page_id, variants: ad.collation_count ?? 1,
        start: unixDate(ad.start_date), end: unixDate(ad.end_date), platforms: ad.publisher_platform ?? [],
        format: sn.display_format ?? null, cta: sn.cta_text ?? null, title: clean(sn.title ?? sn.cards?.[0]?.title),
        body: clean(sn.body?.text ?? sn.cards?.[0]?.body), link: sn.link_url ?? sn.cards?.[0]?.link_url ?? null,
        thumb: thumbOf(sn), video: videoOf(sn), pos: i, total: list.length,
        libraryUrl: `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`,
      });
    });
  return { ads: out, pageIds };
}

// Quét một game trên cả ba nguồn; nguồn nào lỗi thì bỏ qua nguồn đó và ghi lỗi lại
async function scanGame(browser, g) {
  const developer = db.prepare(`SELECT developer FROM apps WHERE store = ? AND app_id = ?`).get(g.store, g.app_id)?.developer;
  let pageIds = null;
  const jobs = [
    ["meta", browser && (async () => { const r = await scanMeta(browser, g); pageIds = r.pageIds; return r.ads; })],
    ["apple", ADS.apple && (() => scanApple(g))],
    ["google", ADS.google && developer && (() => scanGoogle(g, developer))],
  ].filter(([, fn]) => fn);
  const found = [], errors = [];
  const failed = [];
  for (const [source, fn] of jobs) {
    // Lỗi tạm thời (trang Meta tự chuyển hướng, mạng chập chờn): thử lại một lần
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        found.push(...(await fn()).map((a) => ({ ...a, source })));
        break;
      } catch (e) {
        if (attempt === 2) {
          errors.push(`${SOURCES[source]}: ${String(e.message ?? e).slice(0, 150)}`);
          failed.push(source);
        } else await sleep(3000);
      }
    }
  }
  if (errors.length === jobs.length) throw new Error(errors.join(" · "));

  const date = today();
  db.exec("BEGIN");
  try {
    // Nguồn lỗi lần này: giữ quảng cáo của lần quét trước thay vì để trống
    for (const source of failed)
      db.prepare(`UPDATE ads SET last_seen = ? WHERE game_key = ? AND source = ? AND last_seen = ?`)
        .run(date, g.game_key, source, g.last_scan);
    for (const a of found)
      upsertAd.run(a.id, g.game_key, a.pageId ?? null, a.page ?? null, a.variants ?? 1, a.start, a.end,
        (a.platforms ?? []).join(","), a.format ?? null, a.cta ?? null, a.title ?? null, a.body ?? null, a.link ?? null,
        a.thumb ?? null, a.video ?? null, a.pos, a.total, date, date, a.source, a.libraryUrl ?? null);
    const count = db.prepare(`SELECT COUNT(*) AS n FROM ads WHERE game_key = ? AND last_seen = ?`).get(g.game_key, date).n;
    db.prepare(`UPDATE ad_games SET last_scan = ?, last_error = ?, ad_count = ?, page_ids = COALESCE(?, page_ids) WHERE game_key = ?`)
      .run(date, errors.length ? errors.join(" · ") : null, count, pageIds ? JSON.stringify(pageIds) : null, g.game_key);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return found.length;
}

const getGame = db.prepare(`SELECT * FROM ad_games WHERE game_key = ?`);

export async function runAdsFetch(keys = null) {
  if (adsStatus.running) return false;
  Object.assign(adsStatus, { running: true, done: 0, total: 0, current: null, errors: [] });
  let browser;
  try {
    keys ??= pickGames();
    adsStatus.total = keys.length;
    // Không có Edge/Chrome thì vẫn quét App Store và Google
    try { browser = await launch(); } catch (e) { adsStatus.errors.push({ game: "Meta", error: String(e.message ?? e) }); }
    for (const key of keys) {
      const g = getGame.get(key);
      adsStatus.current = g?.name ?? key;
      try {
        if (g) await scanGame(browser, g);
        const err = g && getGame.get(key)?.last_error;
        if (err) adsStatus.errors.push({ game: g.name, error: err });
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

// Còn chạy: Meta chỉ giữ quảng cáo đang chạy; App Store chậm 7 ngày; Google cập nhật hằng ngày
const ACTIVE_DAYS = { meta: Infinity, apple: 10, google: 3 };
export const SOURCES = { meta: "Meta", apple: "App Store", google: "Google" };

export function listAds({ game = null, format = null, source = null, sort = "score", onlyNew = false, onlyActive = false,
  minDays = 0, q = "", limit = 300 } = {}) {
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
    const active = r.source === "meta" || (!!r.end_date && daysBetween(r.end_date, now) <= ACTIVE_DAYS[r.source]);
    // Cùng một thang cho mọi nguồn. App Store không có thứ tự hiển thị: tính mức giữa 0.5
    const parts = {
      days: Math.min(days, 90) / 90,
      impressions: r.impr_pos == null ? 0.5 : r.impr_total > 1 ? 1 - r.impr_pos / (r.impr_total - 1) : 1,
      variants: Math.log(1 + Math.min(r.collation_count ?? 1, 50)) / Math.log(51),
      platforms: Math.min(platforms.length, 5) / 5,
    };
    // Quảng cáo đã dừng vẫn giữ để tham khảo nhưng bị trừ điểm
    const score = Math.round(100 * (active ? 1 : ADS.stoppedFactor) * (w.days * parts.days
      + w.impressions * parts.impressions + w.variants * parts.variants + w.platforms * parts.platforms));
    return {
      id: r.ad_id, source: r.source, active, game: r.game_key, gameName: r.game_name, store: r.store, appId: r.appId, icon: r.icon,
      page: r.page_name, startDate: r.start_date, endDate: r.end_date, days, variants: r.collation_count ?? 1,
      platforms, format: r.display_format, cta: r.cta_text, title: r.title, body: r.body, link: r.link_url,
      thumb: r.thumb, video: r.video_url, imprRank: r.impr_pos == null ? null : r.impr_pos + 1, imprTotal: r.impr_total,
      isNew: daysBetween(r.start_date, now) <= ADS.newDays, firstSeen: r.first_seen, score, parts,
      libraryUrl: r.library_url ?? `https://www.facebook.com/ads/library/?id=${r.ad_id}`,
    };
  });

  const formats = [...new Set(items.map((i) => i.format).filter(Boolean))].sort();
  if (format) items = items.filter((i) => i.format === format);
  const sourceCounts = {};
  for (const i of items) sourceCounts[i.source] = (sourceCounts[i.source] ?? 0) + 1;
  if (source) items = items.filter((i) => i.source === source);
  if (onlyNew) items = items.filter((i) => i.isNew);
  if (onlyActive) items = items.filter((i) => i.active);
  if (minDays) items = items.filter((i) => i.days >= minDays);
  if (needle) items = items.filter((i) => norm(`${i.title} ${i.body} ${i.gameName} ${i.page}`).includes(needle));

  const sorters = {
    score: (a, b) => b.score - a.score,
    days: (a, b) => b.days - a.days,
    impressions: (a, b) => (a.imprRank ? a.imprRank / a.imprTotal : 0.5) - (b.imprRank ? b.imprRank / b.imprTotal : 0.5),
    variants: (a, b) => b.variants - a.variants,
    newest: (a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""),
  };
  items.sort(sorters[sort] ?? sorters.score);

  return {
    total: items.length, items: items.slice(0, limit), games, formats, weights: w, sources: SOURCES, sourceCounts,
    stoppedFactor: ADS.stoppedFactor,
    status: { running: adsStatus.running, done: adsStatus.done, total: adsStatus.total, current: adsStatus.current,
      errors: adsStatus.errors, finishedAt: adsStatus.finishedAt },
  };
}

export function gameKeyForApp(store, appId) {
  const app = db.prepare(`SELECT title FROM apps WHERE store = ? AND app_id = ?`).get(store, appId);
  return app ? gameKey(app.title) : null;
}
