import { db, norm, today } from "./db.mjs";
import { ADS } from "./config.mjs";
import { googleCount, googlePost } from "./adcounts.mjs";

// Nguồn quảng cáo ngoài Meta, trả về cùng một dạng bản ghi để lib/ads.mjs lưu chung một kho:
// { id, page, variants, start, end, platforms[], format, title, body, link, thumb, video, pos, total, libraryUrl }
// - App Store: Apple Ad Repository API (công khai, chỉ các nước EU, dữ liệu chậm 7 ngày)
// - Google: Google Ads Transparency; lấy quảng cáo của nhà quảng cáo trùng tên nhà phát hành,
//   đọc nội dung từng quảng cáo (một lần, lưu lại) để biết nó trỏ tới app nào

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (d) => (d ? String(d).slice(0, 10) : null);
const core = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, "");

// ================= App Store =================

const APPLE_API = "https://adrepository.apple.com/api/v1";
// API chỉ nhận tối đa 5 nước mỗi lần gọi
const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LU", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

async function appleGet(path) {
  // API từ chối Accept */* (mặc định của fetch)
  const res = await fetch(APPLE_API + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.errors) throw new Error(`Apple Ad Repository: ${data?.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
  return data;
}

// Game chỉ có bản Google Play trong chart: tìm mã app App Store theo tên
async function appleAppId(g) {
  if (g.ios_id) return g.ios_id;
  const d = await appleGet(`/ad-repository-entities?name=${encodeURIComponent(g.query)}&types==APP&limit=20`);
  const want = core(g.query);
  return String(d.data?.find((e) => core(e.name).startsWith(want))?.id ?? "") || null;
}

export async function scanApple(g) {
  const appId = await appleAppId(g);
  if (!appId) return [];
  const raw = [];
  for (let i = 0; i < EU.length; i += 5) {
    const ql = `type==APP;id==${appId};countryOrRegion=in=(${EU.slice(i, i + 5).join(",")});datePreset==LAST_90_DAYS`;
    for (let offset = 0; offset < 500; offset += 50) {
      const d = await appleGet(`/ad-repository-ads?ql=${encodeURIComponent(ql)}&offset=${offset}&limit=50`);
      raw.push(...(d.data ?? []));
      if (offset + 50 >= (d.pagination?.totalResults ?? 0)) break;
    }
    await sleep(300);
  }

  // Mỗi nước một bản ghi riêng: gộp các bản cùng định dạng + cùng ảnh/video, số nước = số bản nhân
  const groups = new Map();
  for (const a of raw) {
    const assets = (a.adAssets ?? []).map((x) => (x.videoUrl && x.videoUrl !== "null" ? x.videoUrl : x.pictureUrl)).filter((u) => u && u !== "null");
    const key = `${a.format}|${assets.join(",")}`;
    const grp = groups.get(key) ?? { ads: [], assets, countries: new Set(), placements: new Set() };
    grp.ads.push(a);
    grp.countries.add(a.countryOrRegion);
    grp.placements.add(a.placement);
    groups.set(key, grp);
  }
  return [...groups.values()].map(({ ads, assets, countries, placements }) => {
    const a = ads[0];
    const video = (a.adAssets ?? []).find((x) => x.videoUrl && x.videoUrl !== "null")?.videoUrl ?? null;
    return {
      id: `apple:${a.adId}`, page: a.developerName, variants: countries.size,
      start: ads.map((x) => day(x.firstImpressionDate)).sort()[0],
      end: ads.map((x) => day(x.lastImpressionDate)).sort().pop(),
      platforms: [...placements], format: a.format?.trim() === "Icon Ad" ? "ICON" : video ? "VIDEO" : "SCREENSHOT",
      title: a.appName, body: [a.adBanner?.subtitle, `Nước: ${[...countries].sort().join(", ")}`].filter(Boolean).join(" · "),
      link: `https://apps.apple.com/app/id${a.appId}`,
      thumb: assets.find((u) => !/\.m3u8|\.mp4/i.test(u)) ?? a.adBanner?.iconPictureUrl ?? null, video,
      pos: null, total: null, libraryUrl: "https://adrepository.apple.com/",
    };
  });
}

// ================= Google =================

db.exec(`
  CREATE TABLE IF NOT EXISTS google_creatives (
    creative_id TEXT PRIMARY KEY,
    advertiser_id TEXT, format INTEGER,
    package TEXT, ios_id TEXT, youtube TEXT, image TEXT,
    parsed_at TEXT
  );
`);

const FORMAT = { 1: "TEXT", 2: "IMAGE", 3: "VIDEO" };
const withProto = (u) => (u ? (u.startsWith("//") ? "https:" + u : u) : null);
const tsDate = (t) => (t?.["1"] ? new Date(Number(t["1"]) * 1000).toLocaleDateString("sv-SE") : null);

// Danh sách quảng cáo của nhà quảng cáo theo thứ tự Google trả về (mới chạy/hiển thị gần nhất trước)
async function listCreatives(advertiserId, max = ADS.googleMaxCreatives) {
  const out = [];
  let token = null;
  while (out.length < max) {
    const req = { 2: 40, 3: { 12: { 1: "", 2: true }, 13: { 1: [advertiserId] } }, 7: { 1: 1, 2: 0, 3: 2704 } };
    if (token) req[4] = token;
    const res = await googlePost("/anji/_/rpc/SearchService/SearchCreatives?authuser=", "f.req=" + encodeURIComponent(JSON.stringify(req)));
    if (res.status !== 200) throw new Error(`Google Ads Transparency HTTP ${res.status}`);
    const d = JSON.parse(res.body || "{}");
    for (const c of d["1"] ?? []) out.push({
      id: c["2"], format: c["4"], preview: c["3"]?.["1"]?.["4"] ?? null,
      image: c["3"]?.["3"]?.["2"]?.match(/src="([^"]+)"/)?.[1] ?? null,
      start: tsDate(c["6"]), end: tsDate(c["7"]), days: c["13"] ?? null,
    });
    token = d["2"];
    if (!token) break;
    await sleep(400);
  }
  return out;
}

// Nội dung xem trước (file JS ~150-400KB) chứa link store và mã video YouTube của quảng cáo
async function parseCreative(c) {
  if (!c.preview) return {};
  const res = await fetch(c.preview, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return {};
  const t = (await res.text()).replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/%3D/gi, "=").replace(/%2F/gi, "/").replace(/%3F/gi, "?").replace(/%26/gi, "&");
  return {
    package: t.match(/play\.google\.com\/store\/apps\/details\?id=([a-zA-Z][\w]*(?:\.[\w]+)+)/)?.[1]
      ?? t.match(/market:\/\/details\?id=([a-zA-Z][\w]*(?:\.[\w]+)+)/)?.[1] ?? null,
    ios: t.match(/(?:apps|itunes)\.apple\.com\/[^"'\s]*?id(\d{6,12})/)?.[1] ?? null,
    youtube: t.match(/ytimg\.com\/vi\/([\w-]{11})/)?.[1] ?? t.match(/youtube\.com\/(?:embed\/|watch\?v=)([\w-]{11})/)?.[1] ?? null,
    // Không có video YouTube: dùng ảnh quảng cáo, nếu không có thì ảnh bìa / ảnh chụp trên store mà quảng cáo hiển thị
    image: c.image ?? t.match(/https:\/\/tpc\.googlesyndication\.com\/simgad\/\d+/)?.[0]
      ?? withProto(t.match(/'(?:coverImage|screenshot1)': '(\/\/lh3\.googleusercontent\.com\/[^']+)'/)?.[1]),
  };
}

const getCreative = db.prepare(`SELECT * FROM google_creatives WHERE creative_id = ?`);
const putCreative = db.prepare(`INSERT OR REPLACE INTO google_creatives
  (creative_id, advertiser_id, format, package, ios_id, youtube, image, parsed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

// Một lượt quét dùng chung danh sách của nhà quảng cáo cho mọi game của họ
const advertiserCache = new Map();

async function advertiserCreatives(advertiserId) {
  const hit = advertiserCache.get(advertiserId);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.list;
  const list = await listCreatives(advertiserId);
  let fetched = 0;
  for (const c of list) {
    let row = getCreative.get(c.id);
    if (!row && fetched < ADS.googleMaxFetch) {
      const p = await parseCreative(c).catch(() => ({}));
      putCreative.run(c.id, advertiserId, c.format, p.package ?? null, p.ios ?? null, p.youtube ?? null, p.image ?? null, today());
      row = getCreative.get(c.id);
      fetched++;
      await sleep(150);
    }
    Object.assign(c, { package: row?.package, ios: row?.ios_id, youtube: row?.youtube, image: c.image ?? row?.image });
  }
  advertiserCache.set(advertiserId, { at: Date.now(), list });
  return list;
}

// ---------- xác minh nhà quảng cáo ----------
// Tên trùng chưa chắc cùng công ty ("Nebula Studio LLC" trên Google là shop bán dao, không phải studio game).
// Chỉ nhận tài khoản có quảng cáo trỏ tới app của nhà phát hành: đúng mã app, hoặc cùng họ package (com.nebula.*).

function developerApps(developer) {
  const rows = db.prepare(`SELECT store, app_id FROM apps WHERE developer = ?
    UNION SELECT pa.store, pa.app_id FROM publisher_apps pa
      JOIN publishers p ON p.store = pa.store AND p.dev_id = pa.dev_id WHERE p.name = ?`).all(developer, developer);
  const ids = new Set(rows.map((r) => r.app_id));
  const families = new Set(rows.filter((r) => r.store === "gplay")
    .map((r) => r.app_id.split(".").slice(0, 2).join(".")).filter((f) => f.includes(".") && f.length > 6));
  return { ids, families };
}
const owns = (c, own) => (c.package && (own.ids.has(c.package) || [...own.families].some((f) => c.package.startsWith(f + "."))))
  || (c.ios && own.ids.has(c.ios));

const VERIFY_TTL_MS = 7 * 24 * 3600 * 1000;
const getVerify = db.prepare(`SELECT data, fetched_at FROM ad_counts WHERE source = 'google_verify' AND query = ?`);
const putVerify = db.prepare(`INSERT OR REPLACE INTO ad_counts (source, query, data, fetched_at) VALUES ('google_verify', ?, ?, ?)`);

// Nhà quảng cáo Google đã xác minh của một nhà phát hành: { advertiser, id, min, max, … } hoặc { advertiser: null, rejected }
export async function verifiedAdvertiser(developer) {
  const c = getVerify.get(developer);
  if (c && Date.now() - new Date(c.fetched_at) < VERIFY_TTL_MS) return JSON.parse(c.data);
  const g = await googleCount(developer);
  const candidates = g?.matches ?? (g?.id ? [{ name: g.advertiser, id: g.id, region: g.region, min: g.min, max: g.max, approx: g.approx }] : []);
  const own = developerApps(developer);
  let out = { advertiser: null, rejected: candidates.map((a) => a.name), candidates: g?.candidates ?? [] };
  for (const cand of candidates.slice(0, 4)) {
    // Đọc tối đa 12 quảng cáo đầu (đã đọc thì lấy lại từ database)
    const list = await listCreatives(cand.id, 40);
    let checked = 0, ok = false;
    for (const cr of list) {
      if (!cr.preview) continue;
      let row = getCreative.get(cr.id);
      if (!row) {
        const p = await parseCreative(cr).catch(() => ({}));
        putCreative.run(cr.id, cand.id, cr.format, p.package ?? null, p.ios ?? null, p.youtube ?? null, p.image ?? null, today());
        row = getCreative.get(cr.id);
        await sleep(150);
      }
      if (owns({ package: row?.package, ios: row?.ios_id }, own)) { ok = true; break; }
      if (++checked >= 12) break;
    }
    if (ok) {
      out = { advertiser: cand.name, id: cand.id, region: cand.region, min: cand.min, max: cand.max, approx: cand.approx,
        accounts: candidates.length, url: `https://adstransparency.google.com/advertiser/${cand.id}?region=anywhere` };
      break;
    }
    await sleep(300);
  }
  putVerify.run(developer, JSON.stringify(out), new Date().toISOString());
  return out;
}

export async function scanGoogle(g, developer) {
  const adv = await verifiedAdvertiser(developer);
  if (!adv?.id) return [];
  const all = await advertiserCreatives(adv.id);
  const mine = all.map((c, i) => ({ ...c, pos: i }))
    .filter((c) => (g.gplay_id && c.package === g.gplay_id) || (g.ios_id && c.ios === g.ios_id));
  // Cùng một video chạy ở nhiều quảng cáo = bản nhân
  const sameVideo = new Map();
  for (const c of mine) if (c.youtube) sameVideo.set(c.youtube, (sameVideo.get(c.youtube) ?? 0) + 1);
  return mine.map((c) => ({
    id: `google:${c.id}`, page: adv.advertiser, variants: c.youtube ? sameVideo.get(c.youtube) : 1,
    start: c.start, end: c.end, platforms: ["GOOGLE"], format: FORMAT[c.format] ?? null,
    title: null, body: null, link: c.youtube ? `https://www.youtube.com/watch?v=${c.youtube}` : null,
    thumb: c.youtube ? `https://i.ytimg.com/vi/${c.youtube}/hqdefault.jpg` : c.image ?? null,
    video: c.youtube ? `https://www.youtube.com/watch?v=${c.youtube}` : null,
    pos: c.pos, total: all.length,
    libraryUrl: `https://adstransparency.google.com/advertiser/${adv.id}/creative/${c.id}?region=anywhere`,
  }));
}

// ================= số quảng cáo cho trang game =================
// Meta, App Store, Google (của riêng game): đếm từ lần quét gần nhất; Google kèm tổng của nhà quảng cáo đã xác minh

export async function adCounts(store, appId, key) {
  const app = db.prepare(`SELECT title, developer FROM apps WHERE store = ? AND app_id = ?`).get(store, appId);
  if (!app) return { error: "Không tìm thấy game" };
  const g = key ? db.prepare(`SELECT last_scan AS lastScan, last_error AS lastError FROM ad_games WHERE game_key = ?`).get(key) : null;
  const bySource = Object.fromEntries((g?.lastScan ? db.prepare(`SELECT source, COUNT(*) AS n FROM ads
    WHERE game_key = ? AND last_seen = ? GROUP BY source`).all(key, g.lastScan) : []).map((r) => [r.source, r.n]));
  const scanned = (src) => (g?.lastScan ? { count: bySource[src] ?? 0, lastScan: g.lastScan } : { count: null });
  let google;
  try { google = await verifiedAdvertiser(app.developer); } catch (e) { google = { error: String(e.message ?? e) }; }
  return { meta: scanned("meta"), apple: scanned("apple"), google: { ...google, game: scanned("google") }, lastError: g?.lastError ?? null };
}
