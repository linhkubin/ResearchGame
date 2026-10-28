// Bản tĩnh (GitHub Pages): trả lời các lời gọi /api/... bằng file JSON do lib/export.mjs xuất ra.
// Giữ đúng định dạng phản hồi của server để app.js không cần biết đang chạy ở chế độ nào.

const COMPARES = [1, 3, 7, 30];
const cache = new Map();
const load = (file) => {
  if (!cache.has(file)) cache.set(file, fetch(`data/${file}`).then((r) => (r.ok ? r.json() : null)));
  return cache.get(file);
};
// Phải khớp với fileKey trong lib/export.mjs
const fileKey = (s) => encodeURIComponent(String(s)).replace(/[%*']/g, "_");
const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const today = () => new Date().toLocaleDateString("sv-SE");
const READ_ONLY = { error: "Bản công khai chỉ để xem. Cập nhật dữ liệu trên máy chạy Chart Tracker." };

async function chart(q) {
  const d = await load(`chart/${q.get("store")}-${q.get("country")}-${q.get("category")}-${q.get("collection")}.json`);
  if (!d) return { date: null, compareDate: null, rows: [], dropped: [], dates: [] };
  const i = Math.max(0, COMPARES.indexOf(Number(q.get("compare") ?? 1)));
  const rows = d.rows.map(({ p, n, ...r }) => ({
    ...r, prevRank: p[i], delta: p[i] != null ? p[i] - r.rank : null, isNew: n[i],
  }));
  return { date: d.date, compareDate: d.cmp[i].compareDate, rows, dropped: d.cmp[i].dropped, dates: [d.date], sparkDates: d.sparkDates };
}

// Giống search() trong lib/queries.mjs
async function search(q) {
  const needle = norm(q.get("q") ?? "").trim();
  if (needle.length < 2) return { results: [] };
  const apps = (await load("search.json")) ?? [];
  const results = apps.filter((a) => a.n?.includes(needle))
    .map((a) => ({ ...a, titleHit: norm(a.title).includes(needle) }))
    .sort((x, y) => (y.titleHit - x.titleHit) || ((x.best?.rank ?? 1e9) - (y.best?.rank ?? 1e9))
      || (y.charts - x.charts) || String(y.lastSeen).localeCompare(String(x.lastSeen)))
    .slice(0, 25);
  return { results };
}

async function news(q) {
  const d = await load("news.json");
  if (!d) return { items: [], status: {}, sources: [] };
  const source = q.get("source"), needle = (q.get("q") ?? "").trim().toLowerCase();
  const since = new Date(Date.now() - Number(q.get("days") ?? 60) * 864e5).toISOString();
  const items = d.items.filter((n) => n.published >= since && (!source || n.source === source)
    && (q.get("onlyData") !== "1" || n.isData) && (q.get("onlyMatched") !== "1" || n.games.length)
    && (!needle || `${n.title} ${n.summary ?? ""}`.toLowerCase().includes(needle)));
  return { ...d, items };
}

// Giống listAds() trong lib/ads.mjs (lọc và sắp xếp trên dữ liệu đã xuất)
async function ads(q, gameKey = null, limit = 300) {
  const d = await load("ads.json");
  if (!d) return { total: 0, items: [], games: [], formats: [], weights: {}, status: {} };
  const game = gameKey ?? q.get("game") ?? "";
  const format = q.get("format"), source = q.get("source"), minDays = Number(q.get("minDays") ?? 0), needle = norm(q.get("q") ?? "");
  let items = d.items.filter((i) => (!game || i.game === game) && (!format || i.format === format)
    && (!source || (i.source ?? "meta") === source) && (q.get("onlyActive") !== "1" || i.active !== false)
    && (q.get("onlyNew") !== "1" || i.isNew) && (!minDays || i.days >= minDays)
    && (!needle || norm(`${i.title} ${i.body} ${i.gameName} ${i.page}`).includes(needle)));
  const sorters = {
    score: (a, b) => b.score - a.score,
    days: (a, b) => b.days - a.days,
    impressions: (a, b) => (a.imprRank ? a.imprRank / a.imprTotal : 0.5) - (b.imprRank ? b.imprRank / b.imprTotal : 0.5),
    variants: (a, b) => b.variants - a.variants,
    newest: (a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""),
  };
  items = [...items].sort(sorters[q.get("sort")] ?? sorters.score);
  const sourceCounts = {};
  for (const i of items) sourceCounts[i.source ?? "meta"] = (sourceCounts[i.source ?? "meta"] ?? 0) + 1;
  return { ...d, total: items.length, items: items.slice(0, limit), sourceCounts };
}

async function game(q) {
  return (await load(`game/${q.get("store")}/${fileKey(q.get("appId"))}.json`))
    ?? { notFound: true };
}

export async function staticApi(path, opts) {
  if (opts?.method === "POST") return READ_ONLY;
  const url = new URL(path, location.href);
  const q = url.searchParams;
  switch (url.pathname.replace(/^.*\/api\//, "")) {
    case "meta": return load("meta.json");
    case "status": return load("status.json");
    case "overview": return load(`overview/${q.get("country") ?? "us"}-${q.get("compare") ?? 1}.json`);
    case "chart": return chart(q);
    case "search": return search(q);
    case "game": return game(q);
    case "news": return news(q);
    case "publishers": return load("publishers.json");
    case "publisher": return (await load(`publisher/${q.get("store")}-${fileKey(q.get("devId"))}.json`)) ?? { notFound: true };
    case "digest": return (await load(`digest/${q.get("date") || "latest"}.json`)) ?? { digest: null, dates: [] };
    case "ads": return ads(q);
    case "newgames": return (await load("newgames.json")) ?? { items: [], trends: [], status: {} };
    case "playables": return (await load("playables.json")) ?? { items: [], sources: [], status: {} };
    // Bản tĩnh: chỉ có số quảng cáo Meta đã quét và nhà phát hành đang theo dõi
    case "ads/counts": {
      const g = await game(q);
      const d = g?.adsKey ? await load("ads.json") : null;
      const info = d?.games?.find((x) => x.key === g.adsKey);
      const n = (src) => (info?.lastScan ? { count: d.items.filter((i) => i.game === g.adsKey && (i.source ?? "meta") === src).length, lastScan: info.lastScan } : { count: null });
      return { meta: n("meta"), apple: n("apple"), google: null };
    }
    case "developer": {
      const g = await game(q);
      const p = g?.publisher && await load(`publisher/${g.publisher.store}-${fileKey(g.publisher.devId)}.json`);
      return p ? { ...p, followed: true } : { error: "Bản công khai chỉ có danh sách game của nhà phát hành đang theo dõi." };
    }
    case "ads/game": {
      const g = await game(q);
      if (!g?.adsKey) return { key: null, items: [], games: [], total: 0 };
      return { key: g.adsKey, ...(await ads(new URLSearchParams(), g.adsKey, 12)) };
    }
    default: return {};
  }
}

