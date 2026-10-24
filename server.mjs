import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import {
  PORT, STORES, COUNTRIES, CATEGORIES, COLLECTIONS, NEWS_REFRESH_HOURS, DAILY_TIME, DIGEST_COUNTRIES, AD_LINKS,
} from "./lib/config.mjs";
import { lastRun, latestDate, today } from "./lib/db.mjs";
import { progress } from "./lib/fetcher.mjs";
import { chart, history, overview, appPresence, search, gameDetail } from "./lib/queries.mjs";
import { getIcon, isAllowed } from "./lib/icons.mjs";
import { listNews, runNewsFetch, newsStatus } from "./lib/news.mjs";
import {
  listPublishers, publisherDetail, recentNewApps, followFromApp, unfollow, followedPublisherFor, pubStatus, developerApps,
} from "./lib/publishers.mjs";
import { adCounts } from "./lib/adsources.mjs";
import { getDigest, buildDigest, hasDigest } from "./lib/digest.mjs";
import { runDaily, dailyStatus } from "./lib/daily.mjs";
import { listAds, runAdsFetch, adsStatus, scanOne, unfollowGame, gameKeyForApp } from "./lib/ads.mjs";
import { listPlayables, runPlayablesFetch, playablesStatus } from "./lib/playables.mjs";
import { listNewGames, runNewGamesFetch, newGamesStatus } from "./lib/newgames.mjs";

const PUBLIC = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const comboFrom = (q) => ({
  store: q.get("store"), country: q.get("country"),
  category: q.get("category"), collection: q.get("collection"),
});

const startDaily = () => runDaily((m) => console.log("[daily]", m)).catch((e) => console.error("[daily] lỗi:", e));
const startNewsFetch = () => runNewsFetch().catch((e) => console.error("[news] lỗi:", e));

const routes = {
  "GET /api/meta": () => ({
    stores: STORES, countries: COUNTRIES, categories: CATEGORIES, collections: COLLECTIONS,
    latest: latestDate(), lastRun: lastRun(), dailyTime: DAILY_TIME, digestCountries: DIGEST_COUNTRIES,
    adLinks: AD_LINKS,
  }),
  "GET /api/status": () => ({
    ...progress, running: dailyStatus.running || progress.running,
    daily: dailyStatus, publishers: { running: pubStatus.running, done: pubStatus.done, total: pubStatus.total },
    ads: { running: adsStatus.running, done: adsStatus.done, total: adsStatus.total, current: adsStatus.current },
    lastRun: lastRun(), latest: latestDate(),
  }),
  "POST /api/refresh": () => {
    const started = !dailyStatus.running;
    if (started) startDaily();
    return { started, running: true };
  },
  "GET /api/chart": (q) => chart(comboFrom(q), q.get("date"), Number(q.get("compare") ?? 1)),
  "GET /api/history": (q) => ({
    history: history(comboFrom(q), q.get("appId")),
    presence: appPresence(q.get("store"), q.get("appId")),
  }),
  "GET /api/overview": (q) => overview(q.get("country") ?? "us", Number(q.get("compare") ?? 1),
    Number(q.get("minDelta") ?? 10)),

  "GET /api/search": (q) => ({ results: search(q.get("q") ?? "") }),
  "GET /api/game": (q) => {
    const d = gameDetail(q.get("store"), q.get("appId"));
    if (!d) return { notFound: true };
    return { ...d, publisher: followedPublisherFor(d.app.store, d.app.appId, d.app.developer) };
  },

  "GET /api/news": (q) => listNews({
    source: q.get("source") || null,
    onlyData: q.get("onlyData") === "1",
    onlyMatched: q.get("onlyMatched") === "1",
    q: q.get("q"),
    days: Number(q.get("days") ?? 60),
  }),
  "POST /api/news/refresh": () => {
    const started = !newsStatus.running;
    if (started) startNewsFetch();
    return { started };
  },

  "GET /api/publishers": () => ({
    publishers: listPublishers(), newApps: recentNewApps(14),
    status: { running: pubStatus.running, done: pubStatus.done, total: pubStatus.total, errors: pubStatus.errors },
  }),
  "GET /api/publisher": (q) => publisherDetail(q.get("store"), q.get("devId")) ?? { notFound: true },
  "GET /api/developer": (q) => developerApps(q.get("store"), q.get("appId")),
  "POST /api/publishers/follow": async (q, body) => followFromApp(body.store, body.appId),
  "POST /api/publishers/unfollow": async (q, body) => { unfollow(body.store, body.devId); return { ok: true }; },

  "GET /api/ads": (q) => listAds({
    game: q.get("game") || null,
    format: q.get("format") || null,
    source: q.get("source") || null,
    sort: q.get("sort") || "score",
    onlyNew: q.get("onlyNew") === "1",
    onlyActive: q.get("onlyActive") === "1",
    minDays: Number(q.get("minDays") ?? 0),
    q: q.get("q") ?? "",
  }),
  "GET /api/ads/game": (q) => {
    const key = gameKeyForApp(q.get("store"), q.get("appId"));
    return key ? { key, ...listAds({ game: key, limit: 12 }) } : { key: null, items: [] };
  },
  "GET /api/ads/counts": (q) => adCounts(q.get("store"), q.get("appId"), gameKeyForApp(q.get("store"), q.get("appId"))),
  "POST /api/ads/refresh": () => {
    const started = !adsStatus.running && !dailyStatus.running;
    if (started) runAdsFetch().catch((e) => console.error("[ads] lỗi:", e));
    return { started };
  },
  "GET /api/newgames": () => listNewGames(),
  "POST /api/newgames/refresh": () => {
    const started = !newGamesStatus.running && !dailyStatus.running;
    if (started) runNewGamesFetch().catch((e) => console.error("[newgames] lỗi:", e));
    return { started };
  },
  "GET /api/playables": () => listPlayables(),
  "POST /api/playables/refresh": () => {
    const started = !playablesStatus.running;
    if (started) runPlayablesFetch().catch((e) => console.error("[playables] lỗi:", e));
    return { started };
  },
  "POST /api/ads/scan": async (q, body) => scanOne(body.store, body.appId),
  "POST /api/ads/unfollow": async (q, body) => { unfollowGame(body.key); return { ok: true }; },

  "GET /api/digest": (q) => getDigest(q.get("date")),
  "POST /api/digest/rebuild": () => ({ digest: buildDigest() }),
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (req.method === "GET" && url.pathname === "/icon") {
      const src = url.searchParams.get("u");
      if (!isAllowed(src)) return send(res, 400, { error: "bad icon url" });
      const img = await getIcon(src);
      if (!img) return send(res, 502, { error: "icon unavailable" });
      res.writeHead(200, { "Content-Type": img.type, "Cache-Control": "public, max-age=604800" });
      return res.end(img.body);
    }
    if (route) {
      const body = req.method === "POST" ? await readJson(req) : null;
      return send(res, 200, await route(url.searchParams, body));
    }
    if (req.method !== "GET") return send(res, 404, { error: "not found" });
    const file = normalize(join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file)] ?? "application/octet-stream");
  } catch (e) {
    if (e.code === "ENOENT") return send(res, 404, { error: "not found" });
    console.error(e);
    send(res, 500, { error: String(e.message ?? e) });
  }
});

// Sau DAILY_TIME mà hôm nay chưa có tóm tắt thì chạy quy trình (dự phòng nếu Task Scheduler lỡ giờ).
// Database trống thì chạy ngay để có dữ liệu xem.
function ensureDaily() {
  if (dailyStatus.running) return;
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  if (!latestDate() || (hhmm >= DAILY_TIME && !hasDigest(today()))) startDaily();
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Chart Tracker: http://localhost:${PORT}`);
  ensureDaily();
  setInterval(ensureDaily, 15 * 60 * 1000);
  // Tin ngành: lấy ngay khi khởi động, sau đó định kỳ
  startNewsFetch();
  setInterval(startNewsFetch, NEWS_REFRESH_HOURS * 3600 * 1000);
});
