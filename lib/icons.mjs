import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Proxy + cache icon: trình duyệt tải hàng trăm icon trực tiếp từ Google sẽ bị trả 429,
// nên server tải mỗi icon đúng một lần, lưu vào data/icons và phục vụ lại từ đĩa.
const DIR = join(import.meta.dirname, "..", "data", "icons");
mkdirSync(DIR, { recursive: true });

const ALLOWED = [/^play-lh\.googleusercontent\.com$/, /^is\d+-ssl\.mzstatic\.com$/];
const MAX_PARALLEL = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// Xin bản 96px WebP cho nhẹ (hiển thị tối đa 72px): Google Play ~3KB, App Store ~5KB thay vì ~20KB PNG
function sized(url) {
  const u = new URL(url);
  if (u.hostname === "play-lh.googleusercontent.com") return url.replace(/=[^/]*$/, "") + "=s96-rw";
  if (u.hostname.endsWith(".mzstatic.com")) return url.replace(/\/[^/]+$/, "/96x96bb.webp");
  return url;
}

let active = 0;
const queue = [];
const inflight = new Map();

async function slot() {
  if (active >= MAX_PARALLEL) await new Promise((r) => queue.push(r));
  active++;
}
function release() {
  active--;
  queue.shift()?.();
}

async function download(url) {
  await slot();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(sized(url), { signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) return null;
      return { type, body: Buffer.from(await res.arrayBuffer()) };
    }
    return null;
  } finally {
    release();
  }
}

export async function getIcon(url) {
  const key = createHash("sha1").update(url).digest("hex");
  const file = join(DIR, key);
  try {
    const [body, type] = await Promise.all([readFile(file), readFile(file + ".type", "utf8")]);
    return { body, type };
  } catch {}
  if (!inflight.has(key)) {
    inflight.set(key, download(url).then(async (img) => {
      if (img) await Promise.all([writeFile(file, img.body), writeFile(file + ".type", img.type)]);
      return img;
    }).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}
