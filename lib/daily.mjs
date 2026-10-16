import { openSync, closeSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { runFetch } from "./fetcher.mjs";
import { runPublisherFetch } from "./publishers.mjs";
import { runNewsFetch } from "./news.mjs";
import { buildDigest } from "./digest.mjs";
import { runAdsFetch } from "./ads.mjs";
import { ADS, PUBLISH } from "./config.mjs";
import { exportAndPublish } from "./export.mjs";

// Khoá file: server và Task Scheduler (hai tiến trình khác nhau) không chạy quy trình chồng nhau
const LOCK = join(import.meta.dirname, "..", "data", "daily.lock");
const LOCK_STALE_MS = 60 * 60 * 1000;

function acquireLock() {
  try {
    const fd = openSync(LOCK, "wx");
    writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
    closeSync(fd);
    return true;
  } catch {
    // Khoá cũ quá 60 phút coi như tiến trình trước đã chết
    try {
      if (Date.now() - statSync(LOCK).mtimeMs > LOCK_STALE_MS) {
        unlinkSync(LOCK);
        return acquireLock();
      }
    } catch {}
    return false;
  }
}

export const dailyStatus = { running: false, step: null, startedAt: null, finishedAt: null, error: null, skipped: false };

const STEPS = [
  ["charts", "Đang lấy bảng xếp hạng", runFetch],
  ["publishers", "Đang lấy game của nhà phát hành", runPublisherFetch],
  ["news", "Đang lấy tin ngành", runNewsFetch],
  ...(ADS.daily ? [["ads", "Đang quét quảng cáo Meta", () => runAdsFetch()]] : []),
  ["digest", "Đang tạo tóm tắt", async () => buildDigest()],
  ...(PUBLISH.enabled ? [["publish", "Đang xuất và đăng bản công khai lên GitHub Pages", () => exportAndPublish()]] : []),
];

// Quy trình hằng ngày: chart -> nhà phát hành -> tin -> quảng cáo -> tóm tắt
export async function runDaily(log = () => {}) {
  if (dailyStatus.running) return false;
  if (!acquireLock()) {
    dailyStatus.skipped = true;
    log("Quy trình đang chạy ở tiến trình khác, bỏ qua.");
    return false;
  }
  Object.assign(dailyStatus, { running: true, step: null, startedAt: new Date().toISOString(), error: null, skipped: false });
  try {
    for (const [key, label, fn] of STEPS) {
      dailyStatus.step = key;
      log(`${label}…`);
      try {
        await fn();
      } catch (e) {
        // Một bước lỗi không chặn các bước sau
        dailyStatus.error = `${key}: ${e.message ?? e}`;
        log(`Lỗi ở bước ${key}: ${e.message ?? e}`);
      }
    }
  } finally {
    Object.assign(dailyStatus, { running: false, step: null, finishedAt: new Date().toISOString() });
    try { unlinkSync(LOCK); } catch {}
  }
  return true;
}
