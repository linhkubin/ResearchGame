import { openSync, closeSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { runFetch } from "./fetcher.mjs";
import { runPublisherFetch } from "./publishers.mjs";
import { runNewsFetch } from "./news.mjs";
import { buildDigest } from "./digest.mjs";
import { runAdsFetch } from "./ads.mjs";
import { runPlayablesFetch } from "./playables.mjs";
import { runNewGamesFetch } from "./newgames.mjs";
import { ADS, PUBLISH, PLAYABLES, NEW_GAMES } from "./config.mjs";
import { exportAndPublish } from "./export.mjs";
import { spawn } from "node:child_process";
import { utimesSync } from "node:fs";

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

// Tab "Trung Quốc": chạy china-daily.mjs (lib/china) trong tiến trình riêng, trước bước "publish", để bản đăng có
// dữ liệu Trung Quốc mới nhất (bước này tự xuất dữ liệu tĩnh vào data/site/china).
// Tiến trình riêng để tắt được hẳn khi treo: task không có giới hạn thời gian, quá CHINA_TIMEOUT_MS thì tắt cả cây tiến trình.
const ROOT = join(import.meta.dirname, "..");
const CHINA_TIMEOUT_MS = 45 * 60 * 1000;
// Bước này làm quy trình dài thêm ~10 phút: làm mới giờ của file khoá để nó không bị coi là khoá chết (quá 60 phút)
const touchLock = () => { try { utimesSync(LOCK, new Date(), new Date()); } catch {} };

function runChinaDaily() {
  touchLock();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["china-daily.mjs"], { cwd: ROOT, stdio: "inherit", windowsHide: true });
    const timer = setTimeout(() => {
      // Windows: taskkill /T /F tắt cả cây tiến trình; nơi khác SIGKILL
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGKILL");
      reject(new Error(`Bước Trung Quốc chạy quá ${CHINA_TIMEOUT_MS / 60000} phút, đã dừng`));
    }, CHINA_TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      touchLock();
      if (code === 0) resolve();
      else reject(new Error(`Bước Trung Quốc thoát với mã ${code}`));
    });
  });
}

export const dailyStatus = { running: false, step: null, startedAt: null, finishedAt: null, error: null, skipped: false };

const STEPS = [
  ["charts", "Đang lấy bảng xếp hạng", runFetch],
  ["publishers", "Đang lấy game của nhà phát hành", runPublisherFetch],
  ["news", "Đang lấy tin ngành", runNewsFetch],
  ...(NEW_GAMES.daily ? [["newgames", "Đang quét game mới phát hành", runNewGamesFetch]] : []),
  ...(ADS.daily ? [["ads", "Đang quét quảng cáo (Meta, App Store, Google)", () => runAdsFetch()]] : []),
  ...(PLAYABLES.daily ? [["playables", "Đang lấy thư viện playable", runPlayablesFetch]] : []),
  ["china", "Đang lấy dữ liệu thị trường Trung Quốc", runChinaDaily],
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
  // Quy trình có thể dài hơn LOCK_STALE_MS (23/11 mất ~60 phút): làm mới khoá định kỳ để nó không bị coi là khoá chết
  const heartbeat = setInterval(touchLock, 5 * 60 * 1000);
  heartbeat.unref();
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
    clearInterval(heartbeat);
    Object.assign(dailyStatus, { running: false, step: null, finishedAt: new Date().toISOString() });
    try { unlinkSync(LOCK); } catch {}
  }
  return true;
}
