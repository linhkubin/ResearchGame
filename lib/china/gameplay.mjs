// Tab phụ "Video gameplay": video cho thấy cách chơi của từng game, game puzzle trước rồi tới game mới.
// Hai nguồn:
//  - TapTap: video chính thức trên trang game (app_videos: app_trial = thử chơi, app_detail = giới thiệu), kèm ảnh động
//    xem trước (preview_animation, webp vài giây) cho thấy ngay lối chơi. Link phát (HLS) có chữ ký hết hạn sau ~4 giờ và
//    API không cho gọi từ trang khác, nên chỉ lưu ảnh động + link trang video trên TapTap.
//  - Bilibili: tìm "<tên game> 游戏" (dưới 10 phút, liên quan nhất), thiếu thì tìm "<tên game>"; chỉ nhận video có đúng tên
//    game trong tiêu đề, xếp loại gameplay / đánh giá / giới thiệu theo từ khoá tiêu đề. Xem ngay bằng trình phát nhúng.
// Game không trên bảng TapTap thì tìm trên TapTap theo tên, chỉ nhận kết quả trùng tên (nameKey).
// Mỗi game tra lại sau VIDEOS.gameplay.recheckDays ngày; mỗi lần chạy tra tối đa VIDEOS.gameplay.perRun game.
import { db, today, daysAgo } from "./db.mjs";
import { VIDEOS } from "./config.mjs";
import { UA, sleep } from "./http.mjs";
import { puzzles, newGames, nameKey } from "./queries.mjs";
import { biliCookie, cleanTitle, shortName, videoKind } from "./videos.mjs";
import { vi } from "./translate.mjs";
import { puzzleKindList, puzzleKind } from "./genres.mjs";

db.exec(`
  CREATE TABLE IF NOT EXISTS gameplay_games (
    game_key TEXT PRIMARY KEY, title TEXT, taptap_id TEXT, checked TEXT
  );
  CREATE TABLE IF NOT EXISTS gameplay_videos (
    game_key TEXT NOT NULL, source TEXT NOT NULL, video_id TEXT NOT NULL,
    title TEXT, kind TEXT, url TEXT, cover TEXT, anim TEXT, duration INTEGER, aspect REAL,
    author TEXT, pubdate TEXT, play INTEGER, likes INTEGER, fetched TEXT,
    PRIMARY KEY (game_key, source, video_id)
  );
`);
const delVideos = db.prepare(`DELETE FROM gameplay_videos WHERE game_key = ? AND source = ?`);
const insVideo = db.prepare(`INSERT OR REPLACE INTO gameplay_videos
  (game_key, source, video_id, title, kind, url, cover, anim, duration, aspect, author, pubdate, play, likes, fetched)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const upGame = db.prepare(`INSERT INTO gameplay_games (game_key, title, taptap_id, checked) VALUES (?, ?, ?, ?)
  ON CONFLICT (game_key) DO UPDATE SET title = excluded.title, taptap_id = excluded.taptap_id, checked = excluded.checked`);
const selVideos = db.prepare(`SELECT * FROM gameplay_videos WHERE game_key = ?`);

// Mọi game có thể có video, theo thứ tự hiện trên tab: game puzzle (theo điểm Bảng tổng hợp), rồi game mới (hạng tốt
// nhất trước); gộp trùng tên theo nameKey. newRank: thứ tự trong danh sách game mới (null nếu không phải game mới).
function targets() {
  const out = new Map();
  for (const r of puzzles("").rows) {
    const key = nameKey(r.title);
    if (key && !out.has(key)) out.set(key, { key, row: r, isPuzzle: true, isNew: false, newRank: null });
  }
  const fresh = newGames().rows.filter((r) => r.isReleased || r.onNewBoard || r.isUpcoming).sort((a, b) => a.best - b.best);
  fresh.forEach((r, i) => {
    const key = nameKey(r.title);
    if (!key) return;
    const t = out.get(key) ?? out.set(key, { key, row: r, isPuzzle: !!r.puzzle, isNew: true, newRank: null }).get(key);
    t.isNew = true;
    t.newRank ??= i + 1;
  });
  return [...out.values()];
}

// Game được tra video: puzzleGames game puzzle đầu cộng newGames game mới đầu (để game mới không phải puzzle cũng có suất)
function fetchTargets(all = targets()) {
  const cfg = VIDEOS.gameplay;
  const puzzleRank = new Map(all.filter((t) => t.isPuzzle).map((t, i) => [t.key, i + 1]));
  return all.filter((t) => (puzzleRank.get(t.key) ?? Infinity) <= cfg.puzzleGames || (t.newRank ?? Infinity) <= cfg.newGames);
}

// ---------- TapTap ----------
const TAP_UA = "X-UA=" + encodeURIComponent("V=1&PN=WebApp&LANG=zh_CN&VN_CODE=102&LOC=CN&PLT=PC&DS=Android&OS=Windows");
async function tap(path, params) {
  const res = await fetch(`https://www.taptap.cn/webapiv2/${path}?${params}&${TAP_UA}`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`TapTap HTTP ${res.status}`);
  const j = await res.json();
  if (!j.success) throw new Error(`TapTap: ${j.data?.msg ?? "lỗi"}`);
  return j.data;
}

// App TapTap của game: member TapTap của cụm; không có thì tìm theo tên, chỉ nhận kết quả trùng tên
async function tapAppId(key, title, members) {
  const m = (members ?? []).find((x) => x.source === "taptap");
  if (m) return String(m.appId);
  const d = await tap("search/v2/app", `kw=${encodeURIComponent(shortName(title))}&from=0&limit=10`);
  const hit = (d.list ?? []).map((x) => x.app ?? x).find((a) => a?.id && nameKey(a.title) === key);
  return hit ? String(hit.id) : null;
}

async function tapVideos(appId) {
  const d = await tap("app/v4/detail", `id=${appId}`);
  const list = ((d.app ?? d).app_videos ?? []).filter((v) => v.id);
  if (!list.length) return [];
  await sleep(250);
  const info = await tap("video-resource/v1/multi-get", `video_ids=${list.map((v) => v.id).join(",")}`);
  return (info.list ?? []).map((v) => {
    const trial = list.find((x) => String(x.id) === String(v.video_id))?.type === "app_trial";
    return {
      source: "taptap", id: String(v.video_id),
      title: trial ? "Video thử chơi chính thức" : "Video giới thiệu chính thức",
      kind: trial ? "trial" : "official",
      url: `https://www.taptap.cn/video/${v.video_id}`,
      cover: v.raw_cover?.medium_url ?? v.thumbnail?.medium_url ?? null,
      anim: v.preview_animation?.url ?? null,
      duration: v.info?.duration ?? null, aspect: v.info?.aspect_ratio ?? null,
    };
  }).filter((v) => v.anim || v.cover);
}

// ---------- Bilibili ----------
const parseDur = (s) => {
  const p = String(s ?? "").split(":").map(Number);
  return !s || p.some(Number.isNaN) ? null : p.reduce((a, b) => a * 60 + b, 0);
};
// Video lạc đề dù có tên game: cắt ghép, nhạc, meme, đồ chơi thật
const OFFTOPIC = /鬼畜|mmd|gmv|手书|混剪|翻唱|cosplay|cos服|同人|鼓谱|bgm|周边|手办|开箱/i;

async function biliFind(cookie, keyword, extra) {
  const u = new URL("https://api.bilibili.com/x/web-interface/search/type");
  for (const [k, v] of Object.entries({ search_type: "video", keyword, page: 1, order: "totalrank", ...extra })) u.searchParams.set(k, v);
  const res = await fetch(u, {
    headers: { "User-Agent": UA, Referer: "https://search.bilibili.com/", Cookie: cookie },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Bilibili HTTP ${res.status}`);
  const d = await res.json();
  // -412: bị chặn vì gọi quá nhanh
  if (d.code !== 0) throw new Error(`Bilibili ${d.code} ${d.message ?? ""}`.trim());
  return (d.data?.result ?? []).filter((v) => v.type === "video" && v.bvid).map((v) => ({
    source: "bilibili", id: v.bvid, title: cleanTitle(v.title), author: v.author ?? null,
    url: `https://www.bilibili.com/video/${v.bvid}`,
    cover: v.pic ? (v.pic.startsWith("//") ? "https:" + v.pic : v.pic) : null,
    pubdate: v.pubdate ? new Date(v.pubdate * 1000).toLocaleDateString("sv-SE") : null,
    duration: parseDur(v.duration), play: v.play ?? 0, likes: v.like ?? 0,
  }));
}

const KIND_ORDER = { trial: 0, official: 1, gameplay: 2, review: 3, pv: 4, other: 5 };
async function biliGameplay(cookie, title) {
  const name = shortName(title);
  const found = new Map();
  for (const [i, [kw, extra]] of [[`${name} 游戏`, { duration: 1 }], [name, {}]].entries()) {
    if (i) await sleep(VIDEOS.gameplay.delayMs);
    for (const v of await biliFind(cookie, kw, extra)) {
      if (found.has(v.id) || !v.title.includes(name) || OFFTOPIC.test(v.title) || v.duration > VIDEOS.gameplay.maxSeconds) continue;
      found.set(v.id, { ...v, kind: videoKind(v.title) });
    }
    if ([...found.values()].filter((v) => v.kind === "gameplay").length >= 2) break;
  }
  return [...found.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.play - a.play)
    .slice(0, VIDEOS.gameplay.perGame);
}

// ---------- quy trình hằng ngày ----------
// Trả về số video đã lưu. Một nguồn lỗi thì giữ video cũ của nguồn đó và không đánh dấu đã tra, để lần sau tra lại.
export async function fetchGameplay(onError = () => {}, onProgress = () => {}) {
  const cfg = VIDEOS.gameplay;
  const date = today();
  const stale = daysAgo(cfg.recheckDays);
  const checked = new Map(db.prepare(`SELECT game_key, checked FROM gameplay_games`).all().map((r) => [r.game_key, r.checked]));
  const todo = fetchTargets().filter((t) => !checked.get(t.key) || checked.get(t.key) <= stale).slice(0, cfg.perRun);
  if (!todo.length) return 0;
  const cookie = await biliCookie();
  let saved = 0, tapFails = 0, biliFails = 0;
  for (const [i, t] of todo.entries()) {
    onProgress(i, todo.length);
    const { title, members } = t.row;
    const got = {};
    let tapId = null;
    if (tapFails < 5) {
      try {
        tapId = await tapAppId(t.key, title, members);
        got.taptap = tapId ? await tapVideos(tapId) : [];
        tapFails = 0;
      } catch (e) { tapFails++; onError(`Video TapTap "${title}"`, e); }
    }
    if (shortName(title).length < 2) got.bilibili = [];
    else if (biliFails < 5) {
      try {
        got.bilibili = await biliGameplay(cookie, title);
        biliFails = 0;
      } catch (e) { biliFails++; onError(`Video Bilibili "${title}"`, e); await sleep(5000); }
    }
    db.exec("BEGIN");
    try {
      for (const [source, list] of Object.entries(got)) {
        delVideos.run(t.key, source);
        for (const v of list) insVideo.run(t.key, source, v.id, v.title, v.kind, v.url, v.cover, v.anim ?? null, v.duration ?? null,
          v.aspect ?? null, v.author ?? null, v.pubdate ?? null, v.play ?? null, v.likes ?? null, date);
        saved += list.length;
      }
      if (got.taptap && got.bilibili) upGame.run(t.key, title, tapId, date);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    await sleep(cfg.delayMs);
  }
  onProgress(todo.length, todo.length);
  return saved;
}

// Tiêu đề video Bilibili lấy hôm nay, để dịch sang tiếng Việt
export const gameplayTitlesToTranslate = (date = today()) =>
  db.prepare(`SELECT title FROM gameplay_videos WHERE source = 'bilibili' AND fetched = ?`).all(date).map((r) => r.title);

// ---------- dữ liệu cho tab ----------
export function gameplayList() {
  const cfg = VIDEOS.gameplay;
  const checked = new Map(db.prepare(`SELECT game_key, checked FROM gameplay_games`).all().map((r) => [r.game_key, r.checked]));
  const all = targets();
  const games = [];
  let noVideo = 0;
  for (const t of all) {
    const videos = selVideos.all(t.key).map((v) => ({
      source: v.source, id: v.video_id, title: v.title, titleVi: v.source === "bilibili" ? vi(v.title) : null, kind: v.kind,
      url: v.url, cover: v.cover, anim: v.anim, duration: v.duration, aspect: v.aspect, author: v.author, pubdate: v.pubdate,
      play: v.play, likes: v.likes,
    })).filter((v) => !(v.source === "bilibili" && v.duration > cfg.maxSeconds))
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.play ?? 0) - (a.play ?? 0));
    if (!videos.length) {
      if (checked.has(t.key)) noVideo++;
      continue;
    }
    const r = t.row;
    games.push({
      key: t.key, source: r.source, appId: r.appId, title: r.title, titleVi: r.titleVi, icon: r.icon, developer: r.developer,
      puzzle: r.puzzle, genres: r.genres, members: r.members, score: r.score ?? null, puzzleRank: r.puzzleRank ?? null,
      released: r.released, isPuzzle: t.isPuzzle, isNew: t.isNew, checked: checked.get(t.key) ?? null, videos,
    });
  }
  const pending = fetchTargets(all).filter((t) => !checked.has(t.key)).length;
  const kinds = puzzleKindList().map((k) => ({ ...k, n: games.filter((g) => g.isPuzzle && g.puzzle === k.key).length })).filter((k) => k.n);
  return { date: today(), total: games.length, noVideo, pending, recheckDays: cfg.recheckDays, kinds, games };
}

// ---------- Kho video gameplay puzzle (chế độ mặc định của tab Video gameplay) ----------
// Video chính thức (thử chơi / giới thiệu) của mọi game gắn tag puzzle trên TapTap, không phụ thuộc bảng xếp hạng: có cả
// game mới ra hôm nay, game indie nhỏ, mini game TapTap. Lấy theo tag qua app-tag/v1/by-tag (mặc định: phát hành mới nhất
// trước; sort=hits: nhiều lượt chơi), mỗi game kèm sẵn danh sách video, rồi video-resource/v1/multi-get theo lô 10 video
// để có ảnh động xem trước và độ dài. Không tìm trên Bilibili theo từ khoá kiểu puzzle ("拧螺丝", "排序", "合成"):
// kết quả gần như toàn video lạc đề (sửa điện, Minecraft, thuật toán).
db.exec(`
  CREATE TABLE IF NOT EXISTS puzzle_videos (
    video_id TEXT PRIMARY KEY, app_id TEXT, game TEXT, tags TEXT, rec_text TEXT, url TEXT, cover TEXT, anim TEXT,
    duration INTEGER, aspect REAL, released TEXT, mini INTEGER, fans INTEGER, hits INTEGER, score REAL,
    in_new INTEGER, in_hits INTEGER, first_seen TEXT, last_seen TEXT
  );
`);
const upPuzzleVideo = db.prepare(`
  INSERT INTO puzzle_videos (video_id, app_id, game, tags, rec_text, url, cover, anim, duration, aspect, released, mini, fans, hits, score,
    in_new, in_hits, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (video_id) DO UPDATE SET app_id = excluded.app_id, game = excluded.game, tags = excluded.tags, rec_text = excluded.rec_text,
    cover = excluded.cover, anim = excluded.anim, duration = excluded.duration, aspect = excluded.aspect, released = excluded.released,
    mini = excluded.mini, fans = excluded.fans, hits = excluded.hits, score = excluded.score,
    in_new = MAX(puzzle_videos.in_new, excluded.in_new), in_hits = MAX(puzzle_videos.in_hits, excluded.in_hits), last_seen = excluded.last_seen`);

// Trả về số video đã lưu
export async function fetchPuzzleVideos(onError = () => {}, onProgress = () => {}) {
  const cfg = VIDEOS.puzzleFeed;
  const date = today();
  const jobs = cfg.tags.flatMap((tag) => [
    ...Array.from({ length: cfg.newestPages }, (_, page) => ({ tag, sort: "", page })),
    ...Array.from({ length: cfg.hitsPages }, (_, page) => ({ tag, sort: "hits", page })),
  ]);
  const apps = new Map();
  let fails = 0;
  for (const [i, j] of jobs.entries()) {
    onProgress(i, jobs.length);
    try {
      const list = (await tap("app-tag/v1/by-tag", `tag=${encodeURIComponent(j.tag)}${j.sort ? `&sort=${j.sort}` : ""}&from=${j.page * 10}&limit=10`)).list ?? [];
      fails = 0;
      for (const a of list) {
        if (!a?.id || !(a.videos ?? []).length) continue;
        const x = apps.get(a.id) ?? apps.set(a.id, { a, inNew: false, inHits: false }).get(a.id);
        if (j.sort) x.inHits = true;
        else x.inNew = true;
      }
    } catch (e) {
      onError(`TapTap tag "${j.tag}"`, e);
      if (++fails >= 5) break;
    }
    await sleep(300);
  }
  const vids = [...apps.values()].flatMap((x) => (x.a.videos ?? []).map((v) => ({ id: String(v.video_id ?? v.id ?? ""), x }))).filter((v) => v.id);
  let saved = 0;
  for (let i = 0; i < vids.length; i += 10) {
    const batch = vids.slice(i, i + 10);
    try {
      const info = await tap("video-resource/v1/multi-get", `video_ids=${batch.map((v) => v.id).join(",")}`);
      for (const v of info.list ?? []) {
        const x = batch.find((b) => b.id === String(v.video_id))?.x;
        const anim = v.preview_animation?.url ?? null, cover = v.raw_cover?.medium_url ?? v.thumbnail?.medium_url ?? null;
        if (!x || !(anim || cover)) continue;
        const a = x.a, st = a.stat ?? {};
        upPuzzleVideo.run(String(v.video_id), String(a.id), a.title, JSON.stringify((a.tags ?? []).map((t) => t.value).filter(Boolean)),
          a.rec_text || null, `https://www.taptap.cn/video/${v.video_id}`, cover, anim, v.info?.duration ?? null, v.info?.aspect_ratio ?? null,
          a.released_time ? new Date(a.released_time * 1000).toLocaleDateString("sv-SE") : null, a.miniapp ? 1 : 0,
          st.fans_count ?? null, st.hits_total ?? null, Number(st.rating?.score) || null, x.inNew ? 1 : 0, x.inHits ? 1 : 0, date, date);
        saved++;
      }
    } catch (e) { onError("TapTap video", e); }
    await sleep(300);
  }
  onProgress(jobs.length, jobs.length);
  return saved;
}

// Tên game, câu giới thiệu và tag của video lấy hôm nay, để dịch sang tiếng Việt
export function puzzleVideoTextsToTranslate(date = today()) {
  const out = [];
  for (const r of db.prepare(`SELECT game, rec_text, tags FROM puzzle_videos WHERE last_seen = ?`).all(date))
    out.push(r.game, r.rec_text, ...JSON.parse(r.tags ?? "[]"));
  return out;
}

// Video cho kho: TapTap (theo tag puzzle) cộng clip Bilibili gameplay của game puzzle trên bảng xếp hạng (do người chơi quay)
export function puzzleVideoList() {
  const cfg = VIDEOS.puzzleFeed;
  const items = db.prepare(`SELECT * FROM puzzle_videos WHERE last_seen >= ?`).all(daysAgo(cfg.keepDays)).map((r) => {
    const tags = JSON.parse(r.tags ?? "[]");
    return {
      source: "taptap", id: r.video_id, appId: r.app_id, title: "Video chính thức", game: r.game, gameVi: vi(r.game),
      tagline: r.rec_text, taglineVi: vi(r.rec_text), tags: tags.map((zh) => ({ zh, vi: vi(zh) })),
      // Đã có tag puzzle nên luôn là puzzle; kiểu đoán từ tên game, không ra thì "Puzzle khác"
      pkind: puzzleKind({ title: r.game, tags }) ?? "other",
      url: r.url, cover: r.cover, anim: r.anim, duration: r.duration, aspect: r.aspect, released: r.released, mini: !!r.mini,
      fans: r.fans, hits: r.hits, score: r.score, inNew: !!r.in_new, inHits: !!r.in_hits, firstSeen: r.first_seen,
    };
  });
  const puzzleOf = new Map(targets().filter((t) => t.isPuzzle && t.row.puzzle).map((t) => [t.key, t.row]));
  for (const v of db.prepare(`SELECT * FROM gameplay_videos WHERE source = 'bilibili' AND kind = 'gameplay'`).all()) {
    const g = puzzleOf.get(v.game_key);
    if (!g || v.duration > VIDEOS.gameplay.maxSeconds) continue;
    items.push({
      source: "bilibili", id: v.video_id, title: v.title, titleVi: vi(v.title), game: g.title, gameVi: g.titleVi, pkind: g.puzzle,
      // released: ngày phát hành của game (để xếp chung với video TapTap); posted: ngày đăng clip
      url: v.url, cover: v.cover, duration: v.duration, released: g.released ?? null, posted: v.pubdate, author: v.author, play: v.play,
      tags: [], firstSeen: v.fetched,
    });
  }
  const kinds = puzzleKindList().map((k) => ({ ...k, n: items.filter((v) => v.pkind === k.key).length })).filter((k) => k.n);
  return { date: today(), total: items.length, keepDays: cfg.keepDays, kinds, items };
}
