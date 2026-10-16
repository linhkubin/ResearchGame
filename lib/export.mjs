// Xuất bản web tĩnh (chỉ đọc) cho GitHub Pages: mỗi API được ghi thành file JSON trong data/site/data,
// icon được chép kèm, rồi public/app.js tự đọc các file này khi chạy ở chế độ tĩnh.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  STORES, COUNTRIES, CATEGORIES, COLLECTIONS, DAILY_TIME, DIGEST_COUNTRIES, AD_LINKS, PUBLISH, allCombos,
} from "./config.mjs";
import { db, latestDate, lastRun, today } from "./db.mjs";
import { chart, overview, gameDetail } from "./queries.mjs";
import { listNews } from "./news.mjs";
import { listPublishers, publisherDetail, recentNewApps, followedPublisherFor } from "./publishers.mjs";
import { getDigest } from "./digest.mjs";
import { listAds, gameKeyForApp } from "./ads.mjs";
import { getIcon, isAllowed } from "./icons.mjs";

const ROOT = join(import.meta.dirname, "..");
export const SITE = join(ROOT, "data", "site");
const ICON_CACHE = join(ROOT, "data", "icons");
const COMPARES = [1, 3, 7, 30];

// Tên file an toàn cho appId / devId (phải khớp với public/app.js)
export const fileKey = (s) => encodeURIComponent(String(s)).replace(/[%*']/g, "_");
const sha1 = (s) => createHash("sha1").update(s).digest("hex");

export const exportStatus = { running: false, step: null, files: 0, icons: 0, error: null, publishedAt: null };

// Thay link icon bằng file icon chép kèm (trình duyệt tải hàng loạt từ Google sẽ bị chặn 429)
const iconUrls = new Set();
function rewriteIcons(v) {
  if (Array.isArray(v)) return v.map(rewriteIcons);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "icon" && typeof x === "string" && isAllowed(x)) {
        iconUrls.add(x);
        out[k] = `icons/${sha1(x)}.webp`;
      } else out[k] = rewriteIcons(x);
    }
    return out;
  }
  return v;
}

function write(path, data) {
  const file = join(SITE, "data", path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(rewriteIcons(data)));
  exportStatus.files++;
}

// ---------- từng phần dữ liệu ----------

function exportMeta() {
  write("meta.json", {
    static: true, exportedAt: new Date().toISOString(),
    stores: STORES, countries: COUNTRIES, categories: CATEGORIES, collections: COLLECTIONS,
    latest: latestDate(), lastRun: lastRun(), dailyTime: DAILY_TIME, digestCountries: DIGEST_COUNTRIES, adLinks: AD_LINKS,
  });
  write("status.json", {
    running: false, done: 0, total: 0, daily: { running: false, step: null },
    publishers: { running: false, done: 0, total: 0 }, lastRun: lastRun(), latest: latestDate(),
  });
}

function exportOverview() {
  for (const c of COUNTRIES) for (const n of COMPARES) write(`overview/${c.code}-${n}.json`, overview(c.code, n));
}

// Một file mỗi bảng: hàng của ngày mới nhất kèm hạng ở từng mốc so sánh
function exportCharts() {
  for (const combo of allCombos()) {
    const per = COMPARES.map((n) => chart(combo, null, n));
    const base = per[0];
    if (!base.date) continue;
    const rows = base.rows.map((r, i) => {
      const { prevRank, delta, isNew, ...rest } = r;
      return { ...rest, p: per.map((c) => c.rows[i]?.prevRank ?? null), n: per.map((c) => !!c.rows[i]?.isNew) };
    });
    write(`chart/${combo.store}-${combo.country}-${combo.category}-${combo.collection}.json`, {
      date: base.date, sparkDates: base.sparkDates, rows,
      cmp: per.map((c) => ({ compareDate: c.compareDate, dropped: c.dropped })),
    });
  }
}

// Chỉ mục tìm kiếm: mọi game từng vào chart, kèm vị trí hiện tại
function exportSearch() {
  const present = new Map();
  for (const r of db.prepare(`
    SELECT r.store, r.app_id, r.rank, r.country, r.category, r.collection FROM ranks r
    JOIN (SELECT store, country, category, collection, MAX(date) AS d FROM ranks
          GROUP BY store, country, category, collection) m
      ON r.store = m.store AND r.country = m.country AND r.category = m.category
     AND r.collection = m.collection AND r.date = m.d
    ORDER BY r.rank`).all()) {
    const k = r.store + ":" + r.app_id;
    if (!present.has(k)) present.set(k, { best: { rank: r.rank, country: r.country, category: r.category, collection: r.collection }, charts: 0 });
    present.get(k).charts++;
  }
  const last = new Map(db.prepare(`SELECT store, app_id, MAX(date) AS date FROM ranks GROUP BY store, app_id`).all()
    .map((r) => [r.store + ":" + r.app_id, r.date]));
  const apps = db.prepare(`SELECT store, app_id AS appId, title, developer, icon, last_seen AS lastSeen, search_norm AS n FROM apps`).all()
    .filter((a) => last.has(a.store + ":" + a.appId))
    .map((a) => {
      const k = a.store + ":" + a.appId;
      const p = present.get(k);
      return { ...a, charts: p?.charts ?? 0, best: p?.best ?? null, last: p ? null : { date: last.get(k) } };
    });
  write("search.json", apps);
}

function exportGames() {
  const since = new Date(Date.now() - PUBLISH.gameDays * 864e5).toLocaleDateString("sv-SE");
  const list = db.prepare(`SELECT DISTINCT store, app_id FROM ranks WHERE date >= ?`).all(since);
  for (const { store, app_id } of list) {
    const d = gameDetail(store, app_id);
    if (!d) continue;
    write(`game/${store}/${fileKey(app_id)}.json`, {
      ...d, publisher: followedPublisherFor(store, app_id, d.app.developer), adsKey: gameKeyForApp(store, app_id),
    });
  }
}

function exportPublishers() {
  write("publishers.json", { publishers: listPublishers(), newApps: recentNewApps(14), status: { running: false, done: 0, total: 0, errors: [] } });
  for (const p of db.prepare(`SELECT store, dev_id FROM publishers`).all())
    write(`publisher/${p.store}-${fileKey(p.dev_id)}.json`, publisherDetail(p.store, p.dev_id));
}

function exportNews() {
  const d = listNews({ days: 120 });
  write("news.json", { ...d, status: { running: false, lastFetch: d.status.lastFetch, errors: d.status.errors } });
}

function exportDigests() {
  const { dates } = getDigest();
  for (const date of dates) write(`digest/${date}.json`, getDigest(date));
  write("digest/latest.json", getDigest());
}

function exportAds() {
  const d = listAds({ limit: 100000 });
  write("ads.json", { ...d, status: { running: false, done: 0, total: 0, current: null, errors: [], finishedAt: d.status.finishedAt } });
}

// Chép icon đã có trong cache; icon chưa có thì tải về qua proxy (giới hạn song song sẵn trong icons.mjs)
async function exportIcons() {
  const dir = join(SITE, "icons");
  mkdirSync(dir, { recursive: true });
  await Promise.all([...iconUrls].map(async (url) => {
    const key = sha1(url);
    const cached = join(ICON_CACHE, key);
    if (!existsSync(cached)) await getIcon(url).catch(() => null);
    if (!existsSync(cached)) return;
    // icons.mjs luôn xin bản WebP; GitHub Pages đặt Content-Type theo đuôi file
    copyFileSync(cached, join(dir, key + ".webp"));
    exportStatus.icons++;
  }));
}

function copyApp() {
  const pub = join(ROOT, "public");
  for (const f of readdirSync(pub)) {
    if (f === "index.html") {
      // Bật chế độ tĩnh trước khi app.js chạy
      const html = readFileSync(join(pub, f), "utf8").replace("<head>", "<head>\n  <script>window.STATIC_SITE = true;</script>");
      writeFileSync(join(SITE, f), html);
    } else copyFileSync(join(pub, f), join(SITE, f));
  }
  writeFileSync(join(SITE, ".nojekyll"), "");
}

export async function exportSite() {
  iconUrls.clear();
  Object.assign(exportStatus, { files: 0, icons: 0, error: null });
  // Xoá bản cũ (giữ .git của nhánh gh-pages)
  for (const sub of ["data", "icons"]) rmSync(join(SITE, sub), { recursive: true, force: true });
  mkdirSync(join(SITE, "data"), { recursive: true });
  const steps = [
    ["meta", exportMeta], ["overview", exportOverview], ["chart", exportCharts], ["search", exportSearch],
    ["games", exportGames], ["publishers", exportPublishers], ["news", exportNews], ["digest", exportDigests],
    ["ads", exportAds], ["icons", exportIcons], ["app", copyApp],
  ];
  for (const [name, fn] of steps) {
    exportStatus.step = name;
    await fn();
  }
  exportStatus.step = null;
  return { files: exportStatus.files, icons: exportStatus.icons };
}

// ---------- đẩy lên GitHub Pages ----------

const git = (...args) => execFileSync("git", args, { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export function publishSite() {
  if (!existsSync(join(SITE, ".git"))) {
    git("init", "-b", PUBLISH.branch);
    git("remote", "add", "origin", PUBLISH.repo);
  }
  git("remote", "set-url", "origin", PUBLISH.repo);
  // Mỗi lần đăng là một commit duy nhất (orphan) để nhánh gh-pages không phình theo thời gian
  git("checkout", "--orphan", "publish-tmp");
  git("add", "-A");
  git("commit", "-q", "-m", `Dữ liệu ${today()}`);
  try { git("branch", "-D", PUBLISH.branch); } catch {}
  git("branch", "-m", PUBLISH.branch);
  git("push", "-f", "origin", `${PUBLISH.branch}:${PUBLISH.branch}`);
  exportStatus.publishedAt = new Date().toISOString();
}

export async function exportAndPublish() {
  if (exportStatus.running) return false;
  exportStatus.running = true;
  try {
    const r = await exportSite();
    if (PUBLISH.enabled) publishSite();
    return r;
  } catch (e) {
    exportStatus.error = String(e.stderr || e.message || e);
    throw e;
  } finally {
    exportStatus.running = false;
  }
}
