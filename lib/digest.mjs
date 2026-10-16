import { db, latestDate } from "./db.mjs";
import { DIGEST_COUNTRIES, COUNTRIES } from "./config.mjs";
import { overview } from "./queries.mjs";
import { recentNewApps } from "./publishers.mjs";
import { listNews } from "./news.mjs";

const pick = (x) => ({
  store: x.store, storeName: x.storeName, appId: x.appId, title: x.title, developer: x.developer, icon: x.icon,
  category: x.category, categoryName: x.categoryName, collection: x.collection, collectionName: x.collectionName,
  rank: x.rank, prevRank: x.prevRank, delta: x.delta,
});

// Tạo bản tóm tắt cho ngày dữ liệu mới nhất và lưu vào bảng digests
export function buildDigest() {
  const date = latestDate();
  if (!date) return null;

  const countries = DIGEST_COUNTRIES.map((code) => {
    const ov = overview(code, 1);
    return {
      code,
      name: COUNTRIES.find((c) => c.code === code)?.name ?? code,
      compared: ov.compared,
      multi: ov.multi.slice(0, 8).map((m) => ({ ...pick(m), hits: m.hits.map(pick) })),
      climbers: ov.climbers.slice(0, 10).map(pick),
      newcomers: ov.newcomers.slice(0, 10).map(pick),
    };
  });

  const newApps = recentNewApps(3).slice(0, 20);

  // Tin 3 ngày gần nhất: ưu tiên bài số liệu và bài nhắc game đang lên
  const news = listNews({ days: 3 }).items
    .map((n) => ({ ...n, score: (n.isData ? 2 : 0) + (n.games.some((g) => g.climbing) ? 3 : 0) + (n.games.length ? 1 : 0) }))
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score || b.published.localeCompare(a.published))
    .slice(0, 8)
    .map(({ id, title, link, sourceName, published, isData, games }) => ({ id, title, link, sourceName, published, isData, games }));

  const data = { date, createdAt: new Date().toISOString(), countries, newApps, news };
  db.prepare(`INSERT INTO digests (date, data, created_at) VALUES (?, ?, ?)
    ON CONFLICT (date) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`)
    .run(date, JSON.stringify(data), data.createdAt);
  return data;
}

export function getDigest(date) {
  const row = date
    ? db.prepare(`SELECT data FROM digests WHERE date = ?`).get(date)
    : db.prepare(`SELECT data FROM digests ORDER BY date DESC LIMIT 1`).get();
  const dates = db.prepare(`SELECT date FROM digests ORDER BY date DESC LIMIT 60`).all().map((r) => r.date);
  return { digest: row ? JSON.parse(row.data) : null, dates };
}

export const hasDigest = (date) => !!db.prepare(`SELECT 1 FROM digests WHERE date = ?`).get(date);
