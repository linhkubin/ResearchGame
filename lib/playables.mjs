import { db, norm, today } from "./db.mjs";
import { PLAYABLES } from "./config.mjs";
import { shortTitle } from "./ads.mjs";

// Thư viện playable: lấy danh sách từ API/JSON công khai trên trang showcase của các studio làm playable
// (không cần tài khoản). Mỗi playable là một file .html mở trực tiếp là chơi.

db.exec(`
  CREATE TABLE IF NOT EXISTS playables (
    url TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    name TEXT, type TEXT, category TEXT,
    store_url TEXT, thumb TEXT, src_updated TEXT,
    alive INTEGER DEFAULT 1,
    first_seen TEXT, last_seen TEXT
  );
  CREATE INDEX IF NOT EXISTS playables_source ON playables (source, last_seen);
`);

export const playablesStatus = { running: false, finishedAt: null, errors: [], counts: {} };

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" };

async function getJson(url, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { ...UA, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- từng nguồn ----------

// Playable Factory: API của trang /our-works; file nằm trên CloudFront
async function playableFactory() {
  const CF = "https://d13gainv9c9spf.cloudfront.net/";
  const list = await getJson("https://playablefactory.com/api/ourwork", { playableType: "all" });
  return list.map((x) => ({
    name: x.name, type: x.playableType === "game" ? "game" : "brand", category: x.productType ?? "",
    url: CF + x.htmlSrc, store: "", thumb: x.imageSrc ? CF + x.imageSrc : "", updated: (x.createdAt ?? "").slice(0, 10),
  }));
}

// Playin: file JSON tĩnh của trang /playables, có kèm link store
async function playin() {
  const { playables } = await getJson("https://www.playin.com.tr/data/playables.json");
  return playables.map((x) => ({
    name: x.title, type: "game", category: x.category ?? "", url: x.s3Link, store: x.appStoreUrl ?? "",
    thumb: x.appIcon ? "https://www.playin.com.tr" + x.appIcon : "", updated: "",
  }));
}

// Playturbo (Mintegral/Mindworks): API của trang /ourwork; chỉ lấy mục là file .html (còn lại là video)
const PT_LABEL = { "2D 可玩": "2D", "3D 可玩": "3D", "休闲游戏": "Casual", "中重度游戏": "Mid-core",
  "工具类应用": "Tool app", "品牌": "Brand", "视频": "Video" };
async function playturbo() {
  const d = await getJson("https://www.playturbo.com/v1/action", {
    componentType: "ReuseTable", page_num: 1, page_size: 200, mid: "excel-ast-page", page_id: "ourwork",
    field: "card_list", configId: "card_table_001", nodePageId: "ourwork", app_id: "PlayturboWebsite",
  });
  let list = null;
  const walk = (o) => {
    if (list || !o || typeof o !== "object") return;
    if (Array.isArray(o) && o[0]?.html_url !== undefined) { list = o; return; }
    for (const k in o) walk(o[k]);
  };
  walk(d);
  if (!list) throw new Error("không tìm thấy danh sách trong phản hồi");
  return list.filter((x) => /\.html/.test(x.html_url ?? "")).map((x) => {
    // Nhãn trả về tiếng Trung; bỏ nhãn "làm bằng Playturbo / Mindworks đặt làm"
    const labels = String(x.labels_text ?? "").split(",").map((l) => PT_LABEL[l.trim()]).filter(Boolean);
    const type = labels.some((l) => l === "Casual" || l === "Mid-core") ? "game" : labels.includes("Brand") ? "brand" : "app";
    return {
      name: x.e_name || x.name, type, category: labels.join(" "), url: x.html_url.replace(/\?.*$/, ""),
      store: "", thumb: x.thumb_url ?? "", updated: String(x.updated_time ?? "").slice(0, 10),
    };
  });
}

const manual = async () => PLAYABLES.manual.map(([, name, url]) => ({ name, type: "game", category: "", url, store: "", thumb: "", updated: "" }));

export const PLAYABLE_SOURCES = [
  { key: "Playable Factory", site: "https://playablefactory.com/our-works", fn: playableFactory },
  { key: "Playin", site: "https://www.playin.com.tr/playables/", fn: playin },
  { key: "Playturbo", site: "https://www.playturbo.com/ourwork", fn: playturbo },
  // Link lẻ: mỗi link mang tên nguồn riêng trong config
  { key: "manual", site: null, fn: manual },
];

// ---------- lấy + lưu ----------

async function alive(url) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(20000) });
    return res.ok;
  } catch {
    return false;
  }
}

const upsert = db.prepare(`
  INSERT INTO playables (url, source, name, type, category, store_url, thumb, src_updated, alive, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (url) DO UPDATE SET
    source = excluded.source, name = excluded.name, type = excluded.type, category = excluded.category,
    store_url = excluded.store_url, thumb = excluded.thumb, src_updated = excluded.src_updated,
    alive = excluded.alive, last_seen = excluded.last_seen`);

export async function runPlayablesFetch() {
  if (playablesStatus.running) return false;
  Object.assign(playablesStatus, { running: true, errors: [], counts: {} });
  try {
    const date = today();
    for (const src of PLAYABLE_SOURCES) {
      let items;
      try {
        items = await src.fn();
      } catch (e) {
        // Nguồn lỗi: giữ nguyên dữ liệu cũ (last_seen không đổi nên vẫn hiện như lần trước)
        playablesStatus.errors.push({ source: src.key, error: String(e.message ?? e).slice(0, 200) });
        continue;
      }
      const ok = new Array(items.length);
      for (let i = 0; i < items.length; i += 8)
        await Promise.all(items.slice(i, i + 8).map(async (x, j) => { ok[i + j] = await alive(x.url); }));
      db.exec("BEGIN");
      try {
        items.forEach((x, i) => {
          const source = src.key === "manual" ? PLAYABLES.manual.find((m) => m[2] === x.url)[0] : src.key;
          upsert.run(x.url, source, x.name, x.type, x.category, x.store || null, x.thumb || null, x.updated || null,
            ok[i] ? 1 : 0, date, date);
        });
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      playablesStatus.counts[src.key] = items.length;
    }
  } finally {
    Object.assign(playablesStatus, { running: false, finishedAt: new Date().toISOString() });
  }
  return true;
}

// ---------- truy vấn ----------

const gameKey = (t) => norm(shortTitle(t)).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Game đang có trong chart (ngày mới nhất mỗi bảng), theo tên ngắn -> hạng tốt nhất
function chartGames() {
  const map = new Map();
  for (const r of db.prepare(`
    SELECT r.store, r.app_id AS appId, MIN(r.rank) AS rank, COUNT(*) AS charts, a.title, a.icon
    FROM ranks r
    JOIN (SELECT store, country, category, collection, MAX(date) AS d FROM ranks GROUP BY store, country, category, collection) m
      ON r.store = m.store AND r.country = m.country AND r.category = m.category AND r.collection = m.collection AND r.date = m.d
    JOIN apps a ON a.store = r.store AND a.app_id = r.app_id
    GROUP BY r.store, r.app_id`).all()) {
    const k = gameKey(r.title);
    const cur = map.get(k);
    if (!cur || r.rank < cur.rank) map.set(k, { store: r.store, appId: r.appId, rank: r.rank, charts: r.charts, icon: r.icon });
  }
  return map;
}

// Toàn bộ danh sách (vài trăm mục); trình duyệt tự lọc/sắp xếp để bản tĩnh dùng chung được
export function listPlayables() {
  // Chỉ giữ mục còn nằm trong danh sách ở lần lấy gần nhất của nguồn đó
  const rows = db.prepare(`
    SELECT p.* FROM playables p
    JOIN (SELECT source, MAX(last_seen) AS d FROM playables GROUP BY source) m ON m.source = p.source AND m.d = p.last_seen
    WHERE p.alive = 1`).all();
  // Lần lấy đầu tiên chỉ là danh sách gốc, chưa tính là "mới"
  const baseline = db.prepare(`SELECT MIN(first_seen) AS d FROM playables`).get()?.d;
  const since = new Date(Date.now() - PLAYABLES.newDays * 864e5).toLocaleDateString("sv-SE");
  const games = chartGames();

  const items = rows.map((r) => {
    const g = r.type === "game" ? games.get(gameKey(r.name)) : null;
    return {
      url: r.url, source: r.source, name: r.name, type: r.type, category: r.category, store: r.store_url,
      thumb: r.thumb, updated: r.src_updated, firstSeen: r.first_seen,
      isNew: r.first_seen > baseline && r.first_seen >= since,
      chart: g ? { store: g.store, appId: g.appId, rank: g.rank, charts: g.charts } : null,
      icon: g?.icon ?? null,
    };
  });
  const sources = PLAYABLE_SOURCES.filter((s) => s.site).map((s) => ({ key: s.key, site: s.site }));
  for (const [name] of PLAYABLES.manual) if (!sources.some((s) => s.key === name)) sources.push({ key: name, site: null });
  return {
    items, sources,
    status: { running: playablesStatus.running, finishedAt: playablesStatus.finishedAt, errors: playablesStatus.errors,
      lastFetch: db.prepare(`SELECT MAX(last_seen) AS d FROM playables`).get()?.d ?? null },
  };
}
