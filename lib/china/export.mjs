// Xuất dữ liệu tĩnh (chỉ đọc) của tab "Trung Quốc" vào PUBLISH.dir (data/site/china/data trong site của Chart Tracker).
// Mỗi lời gọi API /api/china/<x> thành một file JSON; ở bản công khai, public/china.js (staticChina) đọc các file này.
// Lệnh đăng của Chart Tracker đẩy cả thư mục site lên GitHub Pages. Chỉ xuất ngày mới nhất; lịch sử thứ hạng
// 30 ngày vẫn có trong trang chi tiết từng game. Icon dùng thẳng link CDN của store (ảnh đặt referrerpolicy "no-referrer").
// Server thêm API /api/china mới thì sửa cả file này và staticChina trong public/china.js.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PUBLISH, LOOKUP_LINKS, FRESH_DAYS, MOVER_DELTA } from "./config.mjs";
import { db, lastRun, daysAgo, acquireLock, releaseLock } from "./db.mjs";
import { meta, chart, overview, tagStats, game, aggregate, withGenres, newGames, puzzles } from "./queries.mjs";
import { listNews } from "./news.mjs";
import { listVideos } from "./videos.mjs";
import { vi, translateMany } from "./translate.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
export const SITE = resolve(ROOT, PUBLISH.dir);

// Tên file an toàn cho board / appId (phải khớp với fileKey trong public/china.js).
// Windows cấm tên thiết bị CON, PRN, AUX, NUL, COM1-9, LPT1-9 kể cả khi có đuôi: thêm "_" phía trước
export const fileKey = (s) => encodeURIComponent(String(s)).replace(/[%*']/g, "_")
  .replace(/^(con|prn|aux|nul|com\d|lpt\d)(?=\.|$)/i, "_$1");

let files = 0;
function write(path, data) {
  const file = join(SITE, "data", path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  files++;
}

// Game được xuất trang chi tiết: có mặt trên bảng trong PUBLISH.gameDays ngày, hạng tốt nhất trước
const exportedGames = () => db.prepare(`
  SELECT r.source, r.app_id, MIN(r.rank) AS best, MAX(r.date) AS last FROM ranks r
  WHERE r.date >= ? GROUP BY r.source, r.app_id ORDER BY last DESC, best
`).all(daysAgo(PUBLISH.gameDays));

// Bản công khai không gọi được Google Translate như server: dịch sẵn mô tả của game hạng cao chưa có bản dịch.
// Gộp nhiều mô tả mỗi request (translateMany, mất xuống dòng) để ít bị Google chặn 429 hơn dịch từng cái.
async function translateDescriptions(games, log) {
  const getDescr = db.prepare(`SELECT descr FROM apps WHERE source = ? AND app_id = ?`);
  const todo = games.map((g) => getDescr.get(g.source, g.app_id)?.descr)
    .filter((d) => d && /[㐀-鿿]/.test(d) && !vi(d)).slice(0, PUBLISH.translateDescr);
  if (!todo.length) return;
  try {
    await translateMany(todo);
  } catch (e) {
    log(`  dịch mô tả dừng giữa chừng: ${e.message ?? e} (để lần sau)`);
  }
  log(`  dịch sẵn ${todo.filter((d) => vi(d)).length}/${todo.length} mô tả game`);
}

export async function exportSite(log = () => {}) {
  files = 0;
  // Thư mục china/ chỉ chứa dữ liệu của tab này (giao diện nằm trong public/ của Chart Tracker): xoá cả, kể cả
  // index.html/app.js cũ từ thời China Tracker còn là web riêng nhúng bằng iframe
  if (!/[\\/]site[\\/]china$/.test(SITE)) throw new Error(`PUBLISH.dir phải là thư mục site/china, đang là ${SITE}`);
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(join(SITE, "data"), { recursive: true });
  const games = exportedGames();
  await translateDescriptions(games, log);

  const m = meta();
  write("meta.json", {
    ...m, dates: m.latest ? [m.latest] : [], static: true, exportedAt: new Date().toISOString(),
    lastRun: lastRun(), lookupLinks: LOOKUP_LINKS, freshDays: FRESH_DAYS, moverDelta: MOVER_DELTA,
  });
  write("status.json", { running: false, static: true, lastRun: lastRun() });
  for (const kind of ["", "app", "mini"]) {
    write(`aggregate/${kind || "all"}.json`, withGenres(aggregate(null, kind)));
    write(`puzzle/${kind || "all"}.json`, puzzles(kind));
  }
  write("newgames.json", newGames());
  write("videos/bilibili.json", listVideos("bilibili"));
  for (const s of m.sources) {
    write(`overview/${s.key}.json`, overview(s.key));
    write(`tags/${s.key}.json`, tagStats(s.key));
    for (const b of s.boards) write(`chart/${s.key}/${fileKey(b.key)}.json`, chart(s.key, b.key, null));
  }

  // Trang chi tiết + chỉ mục tìm kiếm (chỉ những game có trang chi tiết, để kết quả tìm luôn mở được)
  const index = [];
  for (const { source, app_id } of games) {
    const g = game(source, app_id);
    if (!g) continue;
    g.app.descrVi = vi(g.app.descr);
    write(`game/${source}/${fileKey(app_id)}.json`, g);
    const a = g.app;
    index.push({ source, appId: a.appId, title: a.title, titleVi: a.titleVi, developer: a.developer, icon: a.icon, lastSeen: a.lastSeen });
  }
  write("search.json", index);
  write("news.json", listNews({ days: 60 }));
  return { files, games: index.length };
}

// Khoá "export" giữ cho hai tiến trình không cùng ghi thư mục china/ một lúc
export async function runExport({ log = () => {} } = {}) {
  if (!acquireLock("export")) {
    log("Bỏ qua: một tiến trình khác đang xuất bản công khai");
    return null;
  }
  try {
    const r = await exportSite(log);
    log(`  đã xuất ${r.files} file (${r.games} trang game) vào ${SITE}`);
    return r;
  } finally {
    releaseLock("export");
  }
}
