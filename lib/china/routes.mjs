// API của tab "Trung Quốc" trong server Chart Tracker: /api/china/<x>. Giao diện: public/china.js.
// Bản công khai không có server: lib/china/export.mjs xuất mỗi API thành file JSON, staticChina trong public/china.js đọc lại.
// Thêm API hoặc tham số mới thì sửa cả ba chỗ.
import { LOOKUP_LINKS, FRESH_DAYS, MOVER_DELTA } from "./config.mjs";
import { lastRun, lockHolder } from "./db.mjs";
import { meta, chart, overview, tagStats, game, search, aggregate, withGenres, newGames, puzzles } from "./queries.mjs";
import { listNews } from "./news.mjs";
import { translateText } from "./translate.mjs";
import { runDaily, dailyStatus } from "./daily.mjs";
import { listVideos } from "./videos.mjs";

export const chinaRoutes = {
  "GET /api/china/meta": () => ({ ...meta(), lastRun: lastRun(), lookupLinks: LOOKUP_LINKS, freshDays: FRESH_DAYS, moverDelta: MOVER_DELTA }),
  // elsewhere: quy trình đang chạy ở tiến trình khác (npm run china, quy trình 08:30)
  "GET /api/china/status": () => {
    const elsewhere = !dailyStatus.running && !!lockHolder("daily");
    return { ...dailyStatus, running: dailyStatus.running || elsewhere, elsewhere, lastRun: lastRun() };
  },
  "POST /api/china/refresh": () => {
    const started = !dailyStatus.running && !lockHolder("daily");
    if (started) runDaily((m) => console.log("[china]", m)).catch((e) => console.error("[china] lỗi:", e));
    return { started };
  },
  "GET /api/china/chart": (q) => chart(q.get("source"), q.get("board"), q.get("date")),
  // withGenres: thể loại gộp từ mọi nguồn của cụm (xem lib/china/queries.mjs)
  "GET /api/china/aggregate": (q) => withGenres(aggregate(q.get("date"), q.get("kind") ?? "")),
  "GET /api/china/newgames": () => newGames(),
  "GET /api/china/puzzle": (q) => puzzles(q.get("kind") ?? ""),
  "GET /api/china/overview": (q) => overview(q.get("source")),
  "GET /api/china/tags": (q) => tagStats(q.get("source")),
  "GET /api/china/game": async (q) => {
    const g = game(q.get("source"), q.get("appId"));
    if (!g) return { notFound: true };
    g.app.descrVi = await translateText(g.app.descr);
    return g;
  },
  // Tab phụ video: platform = bilibili (sau này douyin)
  "GET /api/china/videos": (q) => listVideos(q.get("platform") === "douyin" ? "douyin" : "bilibili"),
  "GET /api/china/search": (q) => ({ results: search(q.get("q") ?? "") }),
  "GET /api/china/news": (q) => listNews({ source: q.get("source") || null, q: q.get("q") ?? "", days: Number(q.get("days") ?? 30) }),
};
