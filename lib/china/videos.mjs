// Video về game mới trên nền tảng video Trung Quốc (tab phụ "Bilibili" và "Douyin").
// Mỗi ngày: tìm video đăng trong VIDEOS.days ngày theo từ khoá chung về game mới + tên các game mới của tab Game mới,
// lưu video và số liệu của ngày (lượt xem, thích, lưu, bình luận) để tính mức tăng so với lần thấy trước.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, today } from "./db.mjs";
import { VIDEOS } from "./config.mjs";
import { UA, sleep } from "./http.mjs";
import { newGames } from "./queries.mjs";
import { puzzleKind, PUZZLE_OTHER, PUZZLE_TAGS, GENRES, genreList } from "./genres.mjs";
import { vi } from "./translate.mjs";

db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    platform TEXT NOT NULL, id TEXT NOT NULL,
    title TEXT, author TEXT, author_id TEXT, url TEXT, cover TEXT,
    pubdate TEXT, duration TEXT, category TEXT, tags TEXT,
    found_by TEXT, game TEXT,
    play INTEGER, likes INTEGER, favs INTEGER, comments INTEGER, danmaku INTEGER,
    first_seen TEXT, last_seen TEXT,
    PRIMARY KEY (platform, id)
  );
  CREATE TABLE IF NOT EXISTS video_stats (
    platform TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL,
    play INTEGER, likes INTEGER, favs INTEGER, comments INTEGER,
    PRIMARY KEY (platform, id, date)
  );
`);

const upsert = db.prepare(`
  INSERT INTO videos (platform, id, title, author, author_id, url, cover, pubdate, duration, category, tags, found_by, game,
    play, likes, favs, comments, danmaku, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (platform, id) DO UPDATE SET
    title = excluded.title, author = excluded.author, cover = excluded.cover, category = excluded.category, tags = excluded.tags,
    game = COALESCE(videos.game, excluded.game),
    play = excluded.play, likes = excluded.likes, favs = excluded.favs, comments = excluded.comments, danmaku = excluded.danmaku,
    last_seen = excluded.last_seen`);
// Lượt chia sẻ (Douyin không công khai lượt xem). Bảng cũ chưa có cột này thì thêm.
if (!db.prepare(`PRAGMA table_info(videos)`).all().some((c) => c.name === "shares")) db.exec(`ALTER TABLE videos ADD COLUMN shares INTEGER`);
const setShares = db.prepare(`UPDATE videos SET shares = ? WHERE platform = ? AND id = ?`);
const BROWSER_PATHS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
const saveStat = db.prepare(`INSERT OR REPLACE INTO video_stats (platform, id, date, play, likes, favs, comments) VALUES (?, ?, ?, ?, ?, ?, ?)`);

function save(platform, v, date) {
  upsert.run(platform, v.id, v.title, v.author, v.authorId, v.url, v.cover, v.pubdate, v.duration, v.category, JSON.stringify(v.tags),
    v.foundBy, v.game, v.play, v.likes, v.favs, v.comments, v.danmaku, date, date);
  saveStat.run(platform, v.id, date, v.play, v.likes, v.favs, v.comments);
}

// Tên game mới để tìm video: game của tab Game mới (mới phát hành, trên bảng game mới, sắp ra mắt), hạng tốt nhất trước.
// Bỏ phần quảng cáo sau dấu gạch / ngoặc (Xiaomi hay ghi "Tên - chữ quảng cáo"). Không cắt ở dấu hai chấm: "崩坏：星穹铁道"
// cắt thành "崩坏" sẽ kéo về video của cả dòng game cũ.
export const shortName = (t) => String(t ?? "").split(/\s*[-—–|（(【\[]\s*/)[0].trim();
const newRows = () => newGames().rows.filter((r) => r.isReleased || r.onNewBoard || r.isUpcoming);
function newGameNames(n) {
  const out = [];
  for (const r of newRows().sort((a, b) => a.best - b.best)) {
    const name = shortName(r.title);
    if (name.length >= 2 && !out.includes(name)) out.push(name);
    if (out.length >= n) break;
  }
  return out;
}

// ---------- Bilibili ----------
// API tìm kiếm công khai (không cần đăng nhập, chỉ cần cookie buvid3 lấy từ trang chủ).
// tids=4: chỉ khu Game; pubtime_begin_s: chỉ video đăng trong VIDEOS.days ngày; order=click: lượt xem nhiều trước.
export const cleanTitle = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const fmtSec = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export async function biliCookie() {
  const res = await fetch("https://www.bilibili.com/", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function biliSearch(cookie, keyword, page, beginS, endS) {
  const u = new URL("https://api.bilibili.com/x/web-interface/search/type");
  const p = { search_type: "video", keyword, page, order: "click", tids: 4, pubtime_begin_s: beginS, pubtime_end_s: endS };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  const res = await fetch(u, {
    headers: { "User-Agent": UA, Referer: "https://search.bilibili.com/", Cookie: cookie },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  // -412: bị chặn vì gọi quá nhanh
  if (d.code !== 0) throw new Error(`Bilibili ${d.code} ${d.message ?? ""}`.trim());
  return (d.data?.result ?? []).filter((v) => v.type === "video" && v.bvid).map((v) => ({
    id: v.bvid,
    title: cleanTitle(v.title),
    author: v.author, authorId: String(v.mid ?? ""),
    url: `https://www.bilibili.com/video/${v.bvid}`,
    cover: v.pic ? (v.pic.startsWith("//") ? "https:" + v.pic : v.pic) : null,
    pubdate: new Date(v.pubdate * 1000).toLocaleDateString("sv-SE"),
    duration: v.duration ? String(v.duration) : null,
    category: v.typename ?? null,
    tags: String(v.tag ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12),
    play: v.play ?? 0, likes: v.like ?? 0, favs: v.favorites ?? 0, comments: v.review ?? 0, danmaku: v.video_review ?? 0,
  }));
}

// onProgress(done, total). Trả về số video đã lưu (không trùng).
export async function fetchBilibili(onError = () => {}, onProgress = () => {}) {
  const cfg = VIDEOS.bilibili;
  const date = today();
  const endS = Math.floor(Date.now() / 1000), beginS = endS - VIDEOS.days * 86400;
  const cookie = await biliCookie();
  const jobs = [
    ...cfg.terms.flatMap((term) => Array.from({ length: cfg.pages }, (_, i) => ({ keyword: term, page: i + 1, foundBy: term, game: null }))),
    ...newGameNames(cfg.gameNames).map((name) => ({ keyword: name, page: 1, foundBy: `game: ${name}`, game: name })),
  ];
  const seen = new Set();
  let fails = 0;
  for (const [i, job] of jobs.entries()) {
    onProgress(i, jobs.length);
    try {
      const list = await biliSearch(cookie, job.keyword, job.page, beginS, endS);
      fails = 0;
      for (const v of list) {
        // Tìm theo tên game: chỉ nhận video có nhắc tên game, tránh kết quả lạc đề
        if (job.game && !`${v.title} ${v.tags.join(" ")}`.includes(job.game)) continue;
        save("bilibili", { ...v, foundBy: job.foundBy, game: job.game }, date);
        seen.add(v.id);
      }
    } catch (e) {
      onError(`Bilibili "${job.keyword}"`, e);
      // Bị chặn liên tiếp: dừng, để lần sau
      if (++fails >= 5) break;
      await sleep(5000);
    }
    await sleep(cfg.delayMs);
  }
  onProgress(jobs.length, jobs.length);
  return seen.size;
}

// ---------- Douyin ----------
// API tìm kiếm của Douyin đòi chữ ký do JavaScript của trang tạo (a_bogus), nên mở trang tìm kiếm bằng Edge/Chrome ẩn
// (puppeteer-core, giống phần quảng cáo Meta) rồi đọc phản hồi API mà chính trang tải về.
// Không đăng nhập thì Douyin trả trang mã xác minh: cần cookie của một tài khoản PHỤ trong VIDEOS.douyin.cookieFile
// (chuỗi "a=b; c=d" chép từ trình duyệt). Gặp mã xác minh thì dừng, ghi lỗi, để lần sau; không tìm cách vượt.
const DOUYIN_SEARCH = /\/aweme\/v1\/web\/(search\/item|general\/search)/;

function douyinCookies() {
  const file = join(import.meta.dirname, "..", "..", VIDEOS.douyin.cookieFile);
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8").replace(/^cookie:\s*/i, "").trim();
  const list = raw.split(/;\s*/).map((p) => {
    const i = p.indexOf("=");
    return i > 0 ? { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain: ".douyin.com", path: "/" } : null;
  }).filter((c) => c?.name);
  return list.length ? list : null;
}

function douyinItem(a) {
  const s = a.statistics ?? {};
  return {
    id: String(a.aweme_id),
    title: String(a.desc ?? "").trim() || "(không có mô tả)",
    author: a.author?.nickname ?? null, authorId: a.author?.sec_uid ?? null,
    url: `https://www.douyin.com/video/${a.aweme_id}`,
    cover: a.video?.cover?.url_list?.[0] ?? a.video?.origin_cover?.url_list?.[0] ?? null,
    pubdate: new Date((a.create_time ?? 0) * 1000).toLocaleDateString("sv-SE"),
    duration: a.video?.duration ? fmtSec(Math.round(a.video.duration / 1000)) : null,
    category: null,
    tags: (a.text_extra ?? []).map((t) => t.hashtag_name).filter(Boolean).slice(0, 12),
    // Douyin không công khai lượt xem (play_count thường là 0): dùng lượt chia sẻ làm chỉ số phụ
    play: s.play_count ?? 0, likes: s.digg_count ?? 0, favs: s.collect_count ?? 0, comments: s.comment_count ?? 0, shares: s.share_count ?? 0,
    danmaku: 0,
  };
}

export async function fetchDouyin(onError = () => {}, onProgress = () => {}) {
  const cfg = VIDEOS.douyin;
  const cookies = douyinCookies();
  if (!cookies) throw new Error(`Chưa có cookie Douyin (${cfg.cookieFile}), bỏ qua`);
  const executablePath = BROWSER_PATHS.find((p) => existsSync(p));
  if (!executablePath) throw new Error("Không tìm thấy Edge/Chrome để mở Douyin");
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--lang=zh-CN"] });
  const date = today();
  const since = new Date(Date.now() - VIDEOS.days * 864e5).toLocaleDateString("sv-SE");
  const jobs = [
    ...cfg.terms.map((term) => ({ keyword: term, foundBy: term, game: null })),
    ...newGameNames(cfg.gameNames).map((name) => ({ keyword: name, foundBy: `game: ${name}`, game: name })),
  ];
  const seen = new Set();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setCookie(...cookies);
    let job = null;
    page.on("response", async (res) => {
      if (!job || !DOUYIN_SEARCH.test(res.url())) return;
      const current = job;
      try {
        const j = await res.json();
        for (const it of j.data ?? []) {
          const a = it.aweme_info;
          if (!a?.aweme_id) continue;
          const v = douyinItem(a);
          if (v.pubdate < since) continue;
          if (current.game && !`${v.title} ${v.tags.join(" ")}`.includes(current.game)) continue;
          save("douyin", { ...v, foundBy: current.foundBy, game: current.game }, date);
          setShares.run(v.shares, "douyin", v.id);
          seen.add(v.id);
        }
      } catch { /* phản hồi không phải JSON */ }
    });
    for (const [i, j] of jobs.entries()) {
      onProgress(i, jobs.length);
      job = j;
      // publish_time: đăng trong N ngày (1/7/180); sort_type=1: nhiều lượt thích trước
      const url = `https://www.douyin.com/search/${encodeURIComponent(j.keyword)}?type=video&publish_time=${cfg.publishTime}&sort_type=1`;
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        if (/验证码/.test(await page.title()) || /verify|captcha/i.test(page.url()))
          throw new Error("Douyin yêu cầu mã xác minh (CAPTCHA): cookie hết hạn hoặc bị nghi là bot; dừng, để lần sau");
        // Cuộn xuống để trang tải thêm kết quả
        for (let s = 0; s < cfg.scrolls; s++) {
          await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
          await sleep(1800);
        }
      } catch (e) {
        onError(`Douyin "${j.keyword}"`, e);
        if (/CAPTCHA/.test(e.message)) break;
      }
      job = null;
      await sleep(cfg.delayMs);
    }
    onProgress(jobs.length, jobs.length);
  } finally {
    await browser.close();
  }
  return seen.size;
}

// ---------- Thể loại của video ----------
// Tag do người đăng gắn ("射击游戏", "模拟城市", "休闲益智"…): bỏ đuôi "游戏"/"手游"/"类", rồi so với tag của từng thể loại
// trong GENRES (bằng nhau, hoặc bắt đầu bằng tag thể loại dài từ 2 chữ: "模拟城市" → mô phỏng).
const GENRE_TAGS = GENRES.flatMap((g) => (g.tags ?? []).map((t) => [t.toLowerCase(), g.key]));
const stripTag = (t) => String(t).toLowerCase().replace(/(手游|游戏|类)$/u, "").trim();
function tagGenres(tags) {
  const out = new Set();
  for (const raw of tags) {
    const t = stripTag(raw);
    if (!t) continue;
    if (PUZZLE_TAGS.has(t) || PUZZLE_TAGS.has(raw)) out.add("puzzle");
    for (const [gt, key] of GENRE_TAGS) if (t === gt || raw.toLowerCase() === gt || (gt.length >= 2 && t.startsWith(gt))) out.add(key);
  }
  return out;
}

// Loại video theo tiêu đề: gameplay (thấy cách chơi), đánh giá, giới thiệu (PV, trailer), khác. Gameplay xét trước:
// "实机演示PV" vẫn là gameplay.
const VIDEO_KINDS = [
  ["gameplay", /实机|玩法|试玩|演示|实况|通关|关卡|第\s*[【\[(（]?\s*\d+\s*[】\])）]?\s*关|\d+\s*关|攻略|教程|全程|纯享|无广|上手|一局|对局|游玩|速通|gameplay|playthrough|walkthrough|\blevels?\b/i],
  ["review", /测评|评测|推荐|盘点|安利|值不值|吐槽|体验/],
  ["pv", /pv|预告|宣传|cg|动画|短片|定档|首曝|上线|公测|trailer/i],
];
export const videoKind = (title) => VIDEO_KINDS.find(([, re]) => re.test(String(title ?? "")))?.[0] ?? "other";

// Tiêu đề video thấy hôm nay, để dịch sang tiếng Việt
export const videoTitlesToTranslate = (date = today()) =>
  db.prepare(`SELECT title FROM videos WHERE last_seen = ?`).all(date).map((r) => r.title);

// ---------- Truy vấn cho tab ----------
// Video đăng trong VIDEOS.days ngày của một nền tảng, kèm mức tăng so với lần lấy số liệu trước đó.
export function listVideos(platform) {
  const since = new Date(Date.now() - VIDEOS.days * 864e5).toLocaleDateString("sv-SE");
  const rows = db.prepare(`SELECT * FROM videos WHERE platform = ? AND pubdate >= ? ORDER BY likes DESC LIMIT ?`)
    .all(platform, since, VIDEOS.maxRows);
  const prevStat = db.prepare(`SELECT * FROM video_stats WHERE platform = ? AND id = ? AND date < ? ORDER BY date DESC LIMIT 1`);
  const lastFetch = db.prepare(`SELECT MAX(last_seen) AS d FROM videos WHERE platform = ?`).get(platform)?.d ?? null;
  // Kiểu puzzle và thể loại của game mới (đã phân loại ở tab Game mới), theo tên rút gọn
  const fresh = newRows();
  const gamePuzzle = new Map(fresh.filter((r) => r.puzzle).map((r) => [shortName(r.title), r.puzzle]));
  const gameGenres = new Map(fresh.map((r) => [shortName(r.title), r.genres ?? []]));
  const order = GENRES.map((g) => g.key);
  const items = rows.map((r) => {
    const p = prevStat.get(platform, r.id, r.last_seen);
    const tags = JSON.parse(r.tags ?? "[]");
    // Puzzle khi: video thuộc một game mới là puzzle, hoặc tìm thấy qua từ khoá puzzle (khi đó đoán kiểu theo tiêu đề).
    // Không đoán từ tiêu đề cho mọi video: tiêu đề video lẫn nhiều chữ, đoán sai nhiều.
    const puzzle = (r.game && gamePuzzle.get(r.game))
      || (VIDEOS.puzzleTerms.includes(r.found_by) ? (puzzleKind({ title: r.title }) ?? PUZZLE_OTHER.key) : null);
    // Thể loại: của game (nếu video tìm theo tên game mới) cộng với thể loại suy từ tag của video
    const g = new Set([...(r.game ? gameGenres.get(r.game) ?? [] : []), ...tagGenres(tags)]);
    // Video của một game mới đã biết không phải puzzle: bỏ "puzzle" suy từ tag (vd tag "解密" cho màn giải đố trong game nhập vai)
    if (r.game && gameGenres.has(r.game) && !puzzle) g.delete("puzzle");
    if (puzzle) g.add("puzzle");
    return {
      platform, id: r.id, title: r.title, titleVi: vi(r.title), author: r.author, url: r.url, cover: r.cover,
      genres: order.filter((k) => g.has(k)),
      pubdate: r.pubdate, duration: r.duration, category: r.category, tags, foundBy: r.found_by, game: r.game,
      play: r.play, likes: r.likes, favs: r.favs, comments: r.comments, danmaku: r.danmaku, shares: r.shares ?? null,
      firstSeen: r.first_seen, lastSeen: r.last_seen,
      // Mức tăng so với lần thấy trước (null nếu mới thấy lần đầu)
      kind: videoKind(r.title),
      likesGain: p ? r.likes - p.likes : null, playGain: p ? r.play - p.play : null, gainSince: p?.date ?? null,
      puzzle,
    };
  });
  const foundBy = [...new Set(items.map((i) => i.foundBy))];
  // Thể loại và khu (Bilibili: 手机游戏, 单机游戏…) kèm số video, cho ô lọc
  const count = (keysOf) => { const m = new Map(); for (const i of items) for (const k of keysOf(i)) m.set(k, (m.get(k) ?? 0) + 1); return m; };
  const gc = count((i) => i.genres), cc = count((i) => (i.category ? [i.category] : []));
  const genres = genreList().filter((x) => gc.has(x.key)).map((x) => ({ ...x, n: gc.get(x.key) }));
  const categories = [...cc].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n }));
  return { platform, days: VIDEOS.days, lastFetch, total: items.length, foundBy, genres, categories, items };
}
