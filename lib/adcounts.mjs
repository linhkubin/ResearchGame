import http2 from "node:http2";
import { db, norm } from "./db.mjs";

// Google Ads Transparency: tìm nhà quảng cáo trùng tên nhà phát hành và số quảng cáo của họ,
// qua API nội bộ mà trang adstransparency.google.com dùng (không cần đăng nhập).
// Tên trùng chưa chắc là cùng công ty: lib/adsources.mjs xác minh bằng nội dung quảng cáo.

db.exec(`
  CREATE TABLE IF NOT EXISTS ad_counts (
    source TEXT NOT NULL, query TEXT NOT NULL,
    data TEXT, fetched_at TEXT,
    PRIMARY KEY (source, query)
  );
`);

const TTL_MS = 24 * 3600 * 1000;
const getCached = db.prepare(`SELECT data, fetched_at FROM ad_counts WHERE source = ? AND query = ?`);
const putCached = db.prepare(`INSERT OR REPLACE INTO ad_counts (source, query, data, fetched_at) VALUES (?, ?, ?, ?)`);

// Bỏ hậu tố pháp lý, dấu cách để so tên: "CrazyLabs LTD" ~ "Crazy Labs", "Grand Games A.Ş." ~ "Grand Games"
const LEGAL = /\b(ltd|limited|llc|inc|corp|corporation|co|company|sas|sa|gmbh|bv|ab|oy|as|pte|plc|srl|jsc|a s|kft|sp z o o|tic|ve|com|net|io)\b/g;
const core = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, " ").replace(LEGAL, "").replace(/\s+/g, "");

// Google trả 429 khi gọi dồn dập: tạm dừng gọi một lúc
let googleBlockedUntil = 0;

// fetch() của Node bị Google trả 429 ngay cả khi gọi thưa; gọi qua HTTP/2 như trình duyệt thì được
export function googlePost(path, form) {
  return new Promise((resolve, reject) => {
    const client = http2.connect("https://adstransparency.google.com");
    const done = (fn, v) => { clearTimeout(timer); client.close(); fn(v); };
    const timer = setTimeout(() => { client.destroy(); reject(new Error("Google Ads Transparency quá thời gian")); }, 15000);
    client.on("error", (e) => done(reject, e));
    const req = client.request({ ":method": "POST", ":path": path, "content-type": "application/x-www-form-urlencoded" });
    let status = 0, body = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.setEncoding("utf8");
    req.on("data", (x) => { body += x; });
    req.on("end", () => done(resolve, { status, body }));
    req.on("error", (e) => done(reject, e));
    req.end(form);
  });
}

async function googleSuggest(q) {
  if (Date.now() < googleBlockedUntil) throw new Error("Google tạm giới hạn truy cập, thử lại sau ít phút");
  const res = await googlePost("/anji/_/rpc/SearchService/SearchSuggestions?authuser=",
    "f.req=" + encodeURIComponent(JSON.stringify({ 1: q, 2: 10, 3: 10 })));
  if (res.status === 429) {
    googleBlockedUntil = Date.now() + 10 * 60 * 1000;
    throw new Error("Google tạm giới hạn truy cập, thử lại sau ít phút");
  }
  if (res.status !== 200) throw new Error(`Google Ads Transparency HTTP ${res.status}`);
  const data = JSON.parse(res.body);
  return (data["1"] ?? []).map((x) => x["1"]).filter(Boolean).map((a) => ({
    name: a["1"], id: a["2"], region: a["3"],
    min: Number(a["4"]?.["2"]?.["1"] ?? 0), max: Number(a["4"]?.["2"]?.["2"] ?? 0),
  }));
}

export async function googleCount(developer) {
  const q = String(developer ?? "").trim();
  if (!q) return null;
  const c = getCached.get("google", q);
  if (c && Date.now() - new Date(c.fetched_at) < TTL_MS) return JSON.parse(c.data);

  try {
    const out = await googleLookup(q);
    putCached.run("google", q, JSON.stringify(out), new Date().toISOString());
    return out;
  } catch (e) {
    // Lỗi mạng/giới hạn: dùng số cũ nếu có
    if (c) return { ...JSON.parse(c.data), stale: c.fetched_at };
    throw e;
  }
}

async function googleLookup(q) {
  const want = core(q);
  // Ô gợi ý của Google không khớp khi có hậu tố ("CrazyLabs LTD"): thử lại với tên đã bỏ hậu tố
  const short = norm(q).replace(/[^\p{L}\p{N}]+/gu, " ").replace(LEGAL, " ").replace(/\s+/g, " ").trim();
  // Ưu tiên tên trùng khớp sau khi bỏ hậu tố; không có thì nhận tên bắt đầu bằng tên nhà phát hành
  // (tên pháp lý dài: "GRAND GAMES OYUN VE YAZILIM ANONİM ŞİRKETİ"). Nhiều tài khoản thì lấy tài khoản nhiều quảng cáo nhất.
  const byMax = (a, b) => b.max - a.max;
  const match = (list) => {
    const exact = list.filter((a) => core(a.name) === want).sort(byMax);
    if (exact.length || want.length < 5) return exact;
    return list.filter((a) => core(a.name).startsWith(want)).sort(byMax).map((a) => ({ ...a, approx: true }));
  };
  let list = await googleSuggest(q);
  let exact = match(list);
  if (!exact.length && short && short !== norm(q)) {
    const more = await googleSuggest(short);
    exact = match(more);
    if (!list.length) list = more;
  }
  const hit = exact[0] ?? null;
  return hit
    ? { advertiser: hit.name, region: hit.region, min: hit.min, max: hit.max, accounts: exact.length, approx: !!hit.approx,
        id: hit.id, url: `https://adstransparency.google.com/advertiser/${hit.id}?region=anywhere`,
        // Mọi tài khoản trùng tên: lib/adsources.mjs kiểm tra tài khoản nào thật sự quảng cáo game
        matches: exact.slice(0, 5).map((a) => ({ name: a.name, id: a.id, region: a.region, min: a.min, max: a.max, approx: !!a.approx })) }
    : { advertiser: null, candidates: list.slice(0, 3).map((a) => a.name) };
}
