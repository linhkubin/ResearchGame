// Dịch Trung → Việt qua endpoint công khai của Google Translate, lưu kết quả vào bảng `tr`.
import { db } from "./db.mjs";
import { TRANSLATE } from "./config.mjs";
import { UA, sleep } from "./http.mjs";

const sel = db.prepare(`SELECT vi FROM tr WHERE zh = ?`);
const ins = db.prepare(`INSERT OR REPLACE INTO tr (zh, vi) VALUES (?, ?)`);
const HAS_CJK = /[㐀-鿿]/;

// Bản dịch đã lưu (null nếu chưa có)
export const vi = (zh) => (zh ? sel.get(zh)?.vi ?? null : null);

async function call(text) {
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=${TRANSLATE.to}&dt=t`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "q=" + encodeURIComponent(text),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  const j = await res.json();
  return (j[0] ?? []).map((seg) => seg[0] ?? "").join("");
}

const flat = (s) => s.replace(/\s+/g, " ").trim();

// Dịch các chuỗi chưa có bản dịch. Gộp nhiều chuỗi một request (mỗi chuỗi một dòng).
export async function translateMany(strings, onProgress = () => {}) {
  if (!TRANSLATE.enabled) return 0;
  const todo = [...new Set(strings.filter((s) => s && HAS_CJK.test(s)))].filter((s) => !sel.get(s)).slice(0, TRANSLATE.maxPerRun);
  let done = 0, fails = 0;
  for (let i = 0; i < todo.length;) {
    const batch = [];
    let chars = 0;
    while (i < todo.length && batch.length < 40 && chars + todo[i].length <= 1600) {
      chars += todo[i].length;
      batch.push(todo[i++]);
    }
    if (!batch.length) batch.push(todo[i++]); // một chuỗi dài hơn giới hạn: gửi riêng
    try {
      let out = (await call(batch.map(flat).join("\n"))).split("\n").map((s) => s.trim());
      if (out.length !== batch.length) {
        // Google gộp/tách dòng: dịch lại từng chuỗi
        out = [];
        for (const s of batch) { out.push((await call(flat(s))).trim()); await sleep(150); }
      }
      batch.forEach((zh, k) => out[k] && ins.run(zh, out[k]));
      fails = 0;
    } catch (e) {
      if (++fails >= 3) throw e;
      await sleep(4000);
    }
    done += batch.length;
    onProgress(done, todo.length);
    await sleep(350);
  }
  return done;
}

// Dịch một đoạn dài (mô tả game), dùng khi mở trang chi tiết
export async function translateText(text) {
  if (!text || !TRANSLATE.enabled || !HAS_CJK.test(text)) return null;
  const cached = sel.get(text)?.vi;
  if (cached) return cached;
  try {
    const out = await call(text.slice(0, 1500));
    if (out) ins.run(text, out);
    return out || null;
  } catch { return null; }
}
