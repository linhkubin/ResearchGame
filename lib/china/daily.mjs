// Quy trình hằng ngày: bảng xếp hạng → nhà phát triển TapTap → tin → video Bilibili → dịch → xuất tĩnh
import { db, saveSnapshot, logRun, updateRun, today, acquireLock, releaseLock } from "./db.mjs";
import { fetchIos, fetchTapTap, fetchMiniGames, fillTapTapDevelopers, fetchTencent, fetchXiaomi } from "./sources.mjs";
import { runNewsFetch, recentNewsTitles } from "./news.mjs";
import { fetchBilibili, videoTitlesToTranslate } from "./videos.mjs";
import { translateMany } from "./translate.mjs";
import { runExport } from "./export.mjs";
import { PUBLISH } from "./config.mjs";

export const dailyStatus = { running: false, step: null, detail: "", errors: [], error: null };

function stringsToTranslate(date) {
  const out = [];
  for (const a of db.prepare(`SELECT title, genre, tags, tagline FROM apps WHERE last_seen = ?`).all(date)) {
    out.push(a.title, a.genre, a.tagline);
    try { out.push(...JSON.parse(a.tags ?? "[]")); } catch { /* bỏ qua tags hỏng */ }
  }
  return out.concat(recentNewsTitles(), videoTitlesToTranslate(date));
}

export async function runDaily(log = () => {}) {
  if (dailyStatus.running) return false;
  // Lần chạy ở tiến trình khác (npm run daily, server cổng khác, phiên khác) đang giữ khoá: không cào trùng
  if (!acquireLock("daily")) {
    log("Bỏ qua: một tiến trình khác đang chạy quy trình hằng ngày");
    return false;
  }
  const startedAt = new Date().toISOString();
  const date = today();
  Object.assign(dailyStatus, { running: true, step: null, detail: "", errors: [], error: null });
  let ok = 0;
  let runId = null;
  const step = (s, msg) => { dailyStatus.step = s; dailyStatus.detail = ""; log(msg); };
  const onError = (what, e) => {
    const error = String(e?.message ?? e);
    dailyStatus.errors.push({ what, error });
    log(`  lỗi ${what}: ${error}`);
  };
  const saver = (source) => (board, apps, src = source) => {
    const n = saveSnapshot(date, src, board, apps);
    ok++;
    dailyStatus.detail = `${src} · ${board.name} (${n})`;
  };
  try {
    step("minigame", "Mini game WeChat / Douyin");
    await fetchMiniGames(saver(null), onError);
    step("ios", "App Store Trung Quốc");
    await fetchIos(saver("ios"), onError);
    step("taptap", "TapTap");
    await fetchTapTap(saver("taptap"), onError);
    step("tencent", "Tencent 应用宝");
    await fetchTencent(saver("tencent"), onError);
    step("xiaomi", "Xiaomi");
    await fetchXiaomi(saver("xiaomi"), onError);
    step("developers", "Tra nhà phát triển TapTap");
    await fillTapTapDevelopers((d, t) => { dailyStatus.detail = `${d}/${t}`; });
    step("news", "Tin ngành");
    log(`  ${await runNewsFetch(onError)} bài mới`);
    step("bilibili", "Video Bilibili");
    try {
      log(`  ${await fetchBilibili(onError, (d, t) => { dailyStatus.detail = `${d}/${t}`; })} video`);
    } catch (e) { onError("Bilibili", e); }
    step("translate", "Dịch sang tiếng Việt");
    try {
      log(`  ${await translateMany(stringsToTranslate(date), (d, t) => { dailyStatus.detail = `${d}/${t}`; })} chuỗi`);
    } catch (e) { onError("dịch", e); }
    if (PUBLISH.enabled) {
      // Ghi lần chạy trước khi xuất: bản công khai lấy giờ "dữ liệu cập nhật" từ lần chạy mới nhất trong bảng runs,
      // nếu ghi sau thì nó hiện giờ của lần chạy trước. Lỗi của bước xuất được cập nhật vào lần chạy này ở finally.
      runId = logRun(startedAt, ok, dailyStatus.errors);
      step("export", "Xuất bản công khai vào web Chart Tracker (tab Trung Quốc)");
      try { await runExport({ log }); } catch (e) { onError("xuất web", e); }
    }
  } catch (e) {
    dailyStatus.error = String(e?.message ?? e);
    log(`Lỗi: ${dailyStatus.error}`);
  } finally {
    if (runId == null) logRun(startedAt, ok, dailyStatus.errors);
    else updateRun(runId, ok, dailyStatus.errors);
    releaseLock("daily");
    Object.assign(dailyStatus, { running: false, step: null, detail: "" });
  }
  return true;
}
