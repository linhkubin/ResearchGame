import { db, latestDate, daysAgo } from "./db.mjs";
import { SOURCES, MOVER_DELTA, FRESH_DAYS, HISTORY_DAYS, AGGREGATE, NEW_GAMES } from "./config.mjs";
import { vi } from "./translate.mjs";
import { classify, settle, genreList, puzzleKindList } from "./genres.mjs";

const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// Bảng mỗi game đang có mặt, ở ngày mới nhất của từng nguồn ("ios/free-puzzle"…): dùng để suy thể loại.
// Tính lại khi bảng ranks đổi (MAX(rowid) tăng mỗi lần ghi snapshot).
let boardCache = { key: null, map: new Map() };
function boardsNow() {
  const key = db.prepare(`SELECT MAX(rowid) AS k FROM ranks`).get()?.k ?? 0;
  if (boardCache.key !== key) {
    const map = new Map();
    for (const r of db.prepare(`
      SELECT r.source, r.app_id, r.board FROM ranks r
      JOIN (SELECT source, MAX(date) AS d FROM ranks GROUP BY source) m ON m.source = r.source AND m.d = r.date
    `).all()) {
      const k = `${r.source}|${r.app_id}`;
      (map.get(k) ?? map.set(k, []).get(k)).push(`${r.source}/${r.board}`);
    }
    boardCache = { key, map };
  }
  return boardCache.map;
}

// Thể loại chuẩn hoá + kiểu puzzle của một dòng trong bảng apps (xem lib/genres.mjs)
function classifyApp(a) {
  const tags = parse(a.tags, []);
  if (a.genre && !tags.includes(a.genre)) tags.push(a.genre);
  const boards = boardsNow().get(`${a.source}|${a.app_id}`) ?? [];
  return { boards, ...classify({ title: a.title, tags, boards }) };
}

function shape(a) {
  const { boards, genres, puzzle } = classifyApp(a);
  return {
    boards, genres, puzzle,
    source: a.source, appId: a.app_id,
    title: a.title, titleVi: vi(a.title),
    developer: a.developer || null,
    icon: a.icon, url: a.url,
    genre: a.genre, genreVi: vi(a.genre),
    tags: parse(a.tags, []).map((zh) => ({ zh, vi: vi(zh) })),
    tagline: a.tagline, taglineVi: vi(a.tagline),
    score: a.score, stats: parse(a.stats, {}),
    released: a.released, firstSeen: a.first_seen, lastSeen: a.last_seen,
  };
}

export function boardsOf(source) {
  return db.prepare(`SELECT board AS key, name, zh FROM boards WHERE source = ? ORDER BY ord`).all(source);
}

export function meta() {
  return {
    sources: SOURCES.map((s) => ({ ...s, boards: boardsOf(s.key) })).filter((s) => s.boards.length),
    latest: latestDate(),
    dates: db.prepare(`SELECT DISTINCT date FROM ranks ORDER BY date DESC LIMIT 90`).all().map((r) => r.date),
    genres: genreList(), puzzleKinds: puzzleKindList(), newGamesDays: NEW_GAMES.days,
  };
}

const getApp = db.prepare(`SELECT * FROM apps WHERE source = ? AND app_id = ?`);

// Thể loại của một cụm game ở nhiều nguồn: hợp thể loại của mọi member; kiểu puzzle lấy kiểu rõ ràng đầu tiên
function classifyMembers(members) {
  const set = new Set();
  let puzzle = null;
  for (const m of members) {
    const a = getApp.get(m.source, m.appId);
    if (!a) continue;
    const c = classifyApp(a);
    for (const g of c.genres) set.add(g);
    if (c.puzzle && (!puzzle || puzzle === "other")) puzzle = c.puzzle;
  }
  return settle(set, puzzle);
}

// Thể loại của từng game (theo nameKey) tính trên cụm đủ mọi nguồn của Bảng tổng hợp ngày mới nhất. Khi lọc theo
// kênh (vd chỉ mini game), cụm chỉ còn member WeChat/Douyin nên thiếu tag của TapTap/App Store: tra ở đây để
// 向僵尸开炮 không thành "puzzle" chỉ vì WeChat gắn "益智". Tính lại khi dữ liệu đổi.
let genreCache = { key: null, map: new Map() };
function genreIndex() {
  const key = db.prepare(`SELECT MAX(rowid) AS k FROM ranks`).get()?.k ?? 0;
  if (genreCache.key !== key) {
    const map = new Map();
    for (const r of aggregate(null, "", Infinity).rows) map.set(nameKey(r.title), classifyMembers(r.members));
    genreCache = { key, map };
  }
  return genreCache.map;
}
const genresOf = (title, members) => genreIndex().get(nameKey(title)) ?? classifyMembers(members);

// Hàng của Bảng tổng hợp (aggregate() trong phần dữ liệu): shape(lead) chỉ biết game dẫn đầu, nên tính lại thể loại
// từ mọi nguồn của cụm. Dùng ở route /api/aggregate, tab Puzzle và khi xuất bản tĩnh.
export const withGenres = (result) => ({
  ...result, rows: result.rows.map((r) => ({ ...r, ...genresOf(r.title, r.members ?? [r]) })),
});

// Hạng chuẩn hoá của một member (0 = đầu bảng, gần 1 = cuối bảng), để so game ở các bảng dài ngắn khác nhau
const relRank = (m) => (m.rank - 1) / Math.max(m.size, 1);

// Game mới, gộp cùng một game ở nhiều nguồn theo tên như Bảng tổng hợp. Một game được tính là mới khi:
//  released: phát hành trong NEW_GAMES.days ngày (chỉ App Store, TapTap có ngày phát hành)
//  newBoard: đang ở bảng "game mới" của nền tảng (TapTap 新品, 应用宝 新游, Douyin 新游)
//  upcoming: đang ở bảng đặt trước và chưa phát hành
//  discovered: lần đầu lên bảng trong NEW_GAMES.days ngày (không tính ngày đầu có dữ liệu của nguồn đó)
// Client lọc tiếp theo số ngày người dùng chọn.
export function newGames() {
  const date = latestDate();
  if (!date) return { date: null, rows: [] };
  const since = daysAgo(NEW_GAMES.days, date);
  const firstDay = Object.fromEntries(db.prepare(`SELECT source, MIN(date) AS d FROM ranks GROUP BY source`).all().map((r) => [r.source, r.d]));
  const byApp = new Map();
  for (const r of db.prepare(`
    SELECT r.source, r.board, r.rank, a.*, b.name AS board_name,
      (SELECT COUNT(*) FROM ranks n WHERE n.date = r.date AND n.source = r.source AND n.board = r.board) AS size
    FROM ranks r
    JOIN (SELECT source, MAX(date) AS d FROM ranks GROUP BY source) m ON m.source = r.source AND m.d = r.date
    JOIN apps a ON a.source = r.source AND a.app_id = r.app_id
    JOIN boards b ON b.source = r.source AND b.board = r.board
  `).all()) {
    const k = `${r.source}|${r.app_id}`;
    const x = byApp.get(k) ?? byApp.set(k, { a: r, boards: [] }).get(k);
    x.boards.push({ board: r.board, name: r.board_name, rank: r.rank, size: r.size });
  }

  const picked = [];
  for (const { a, boards } of byApp.values()) {
    const on = (list) => boards.some((b) => list?.includes(b.board));
    const f = {
      released: !!a.released && a.released >= since && a.released <= date,
      newBoard: on(NEW_GAMES.newBoards[a.source]),
      upcoming: on(NEW_GAMES.reserveBoards[a.source]) && !(a.released && a.released <= date),
      discovered: a.first_seen > (firstDay[a.source] ?? "") && a.first_seen >= since,
    };
    if (f.released || f.newBoard || f.upcoming || f.discovered) picked.push({ a, boards, f });
  }

  const groups = new Map();
  for (const p of picked) {
    const key = nameKey(p.a.title) || `${p.a.source}|${p.a.app_id}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(p);
  }
  const rows = [...groups.values()].map((list) => {
    // Mỗi app: bảng tốt nhất (hạng chuẩn hoá nhỏ nhất); cả cụm sắp theo bảng tốt nhất
    for (const p of list) p.best = p.boards.reduce((x, y) => (relRank(y) < relRank(x) ? y : x));
    list.sort((x, y) => relRank(x.best) - relRank(y.best));
    const tap = list.find((p) => p.a.source === "taptap");
    const lead = tap ?? list[0];
    const members = list.map((p) => ({
      source: p.a.source, appId: p.a.app_id, board: p.best.board, boardName: p.best.name, rank: p.best.rank,
      boards: p.boards.length, size: p.best.size,
    }));
    const released = list.map((p) => p.a.released).filter(Boolean).sort()[0] ?? null;
    const firstSeen = list.map((p) => p.a.first_seen).sort()[0];
    const title = list.map((p) => p.a.title).sort((x, y) => x.length - y.length)[0];
    const tags = new Map();
    for (const p of list) for (const zh of parse(p.a.tags, p.a.genre ? [p.a.genre] : [])) if (!tags.has(zh)) tags.set(zh, { zh, vi: vi(zh) });
    const any = (k) => list.some((p) => p.f[k]);
    return {
      ...shape(lead.a), title, titleVi: vi(title), tags: [...tags.values()].slice(0, 6),
      developer: list.map((p) => p.a.developer).find(Boolean) ?? null,
      released, firstSeen, members, best: relRank(list[0].best),
      // Ngày dùng để lọc theo số ngày: ngày phát hành nếu có, không thì ngày lần đầu lên bảng
      since: (any("released") && released) || firstSeen,
      isReleased: any("released"), onNewBoard: any("newBoard"), isUpcoming: any("upcoming") && !any("released"),
      isDiscovered: any("discovered"),
      ...genresOf(title, members),
    };
  }).sort((x, y) => String(y.since).localeCompare(String(x.since)) || x.best - y.best);
  return { date, days: NEW_GAMES.days, rows };
}

// Tab Puzzle: mọi game đang có mặt trên bảng được xếp là puzzle, sắp theo điểm của Bảng tổng hợp, kèm thống kê
// theo kiểu puzzle (số game, số game mới 7 ngày, game dẫn đầu). kind: "" | "app" | "mini"
export function puzzles(kind = "") {
  const agg = withGenres(aggregate(null, kind, Infinity));
  if (!agg.date) return { date: null, rows: [], kinds: [] };
  const new7 = daysAgo(7, agg.date);
  const rows = agg.rows.filter((r) => r.puzzle).map((r, i) => ({
    ...r, puzzleRank: i + 1,
    isNew7: (!!r.released && r.released >= new7) || (r.isDiscovered && r.firstSeen >= new7),
  }));
  const kinds = puzzleKindList().map((k) => {
    const list = rows.filter((r) => r.puzzle === k.key);
    const lead = list[0];
    return {
      ...k, n: list.length, new7: list.filter((r) => r.isNew7).length,
      lead: lead ? { title: lead.title, titleVi: lead.titleVi, icon: lead.icon, source: lead.source, appId: lead.appId } : null,
    };
  }).filter((k) => k.n);
  return { date: agg.date, prevDate: agg.prevDate, total: rows.length, rows, kinds };
}

const prevDateOf = (source, board, date) =>
  db.prepare(`SELECT MAX(date) AS d FROM ranks WHERE source = ? AND board = ? AND date < ?`).get(source, board, date)?.d ?? null;

const chartStmt = db.prepare(`
  SELECT r.rank, a.*, p.rank AS prev,
    (SELECT COUNT(*) FROM ranks x WHERE x.source = r.source AND x.board = r.board AND x.app_id = r.app_id) AS days
  FROM ranks r
  JOIN apps a ON a.source = r.source AND a.app_id = r.app_id
  LEFT JOIN ranks p ON p.date = ? AND p.source = r.source AND p.board = r.board AND p.app_id = r.app_id
  WHERE r.date = ? AND r.source = ? AND r.board = ?
  ORDER BY r.rank
`);

// Một bảng trong một ngày, so với snapshot liền trước
export function chart(source, board, date) {
  date = date || db.prepare(`SELECT MAX(date) AS d FROM ranks WHERE source = ? AND board = ?`).get(source, board)?.d;
  if (!date) return { date: null, prevDate: null, rows: [] };
  const prevDate = prevDateOf(source, board, date);
  const freshFrom = daysAgo(FRESH_DAYS, date);
  const rows = chartStmt.all(prevDate ?? "", date, source, board).map((r) => ({
    ...shape(r), rank: r.rank, prev: r.prev ?? null,
    delta: r.prev ? r.prev - r.rank : null,
    isNew: !!prevDate && !r.prev,
    isFresh: !!r.released && r.released >= freshFrom,
    days: r.days,
  }));
  return { date, prevDate, rows };
}

// Tổng quan: theo từng bảng, game mới vào và game tăng mạnh; cộng danh sách game mới phát hành
export function overview(source) {
  const date = latestDate();
  if (!date) return { date: null, boards: [], fresh: [] };
  const boards = boardsOf(source).map((b) => {
    const c = chart(source, b.key);
    return {
      ...b, date: c.date, prevDate: c.prevDate, total: c.rows.length,
      entered: c.rows.filter((r) => r.isNew).slice(0, 15),
      up: c.rows.filter((r) => r.delta >= (MOVER_DELTA[source] ?? 10)).sort((x, y) => y.delta - x.delta).slice(0, 10),
    };
  });
  // Game ra mắt gần đây đang có mặt trên bảng (dùng được ngay từ ngày đầu, chưa cần lịch sử)
  const fresh = db.prepare(`
    SELECT a.*, MIN(r.rank) AS best, GROUP_CONCAT(DISTINCT b.name) AS on_boards
    FROM apps a
    JOIN ranks r ON r.source = a.source AND r.app_id = a.app_id AND r.date = a.last_seen
    JOIN boards b ON b.source = r.source AND b.board = r.board
    WHERE a.source = ? AND a.last_seen >= ? AND a.released >= ?
    GROUP BY a.app_id ORDER BY a.released DESC, best LIMIT 80
  `).all(source, daysAgo(1, date), daysAgo(FRESH_DAYS, date))
    .map((r) => ({ ...shape(r), best: r.best, onBoards: r.on_boards }));
  // Game lần đầu thấy trong 7 ngày (cần đã có dữ liệu từ trước đó)
  const firstDay = db.prepare(`SELECT MIN(date) AS d FROM ranks WHERE source = ?`).get(source)?.d;
  const discovered = db.prepare(`
    SELECT a.*, MIN(r.rank) AS best, GROUP_CONCAT(DISTINCT b.name) AS on_boards
    FROM apps a
    JOIN ranks r ON r.source = a.source AND r.app_id = a.app_id
    JOIN boards b ON b.source = r.source AND b.board = r.board
    WHERE a.source = ? AND a.first_seen > ? AND a.first_seen >= ?
    GROUP BY a.app_id ORDER BY a.first_seen DESC, best LIMIT 80
  `).all(source, firstDay ?? "", daysAgo(7, date))
    .map((r) => ({ ...shape(r), best: r.best, onBoards: r.on_boards }));
  return { date, firstDay, hasHistory: boards.some((b) => b.prevDate), boards, fresh, discovered };
}

// Thể loại / tag đang xuất hiện nhiều trên các bảng mới nhất của một nguồn
export function tagStats(source) {
  const date = db.prepare(`SELECT MAX(date) AS d FROM ranks WHERE source = ?`).get(source)?.d;
  if (!date) return { date: null, tags: [] };
  const freshFrom = daysAgo(FRESH_DAYS, date);
  // Ngày đầu có dữ liệu thì game nào cũng "lần đầu thấy": không tính là mới
  const firstDay = db.prepare(`SELECT MIN(date) AS d FROM ranks WHERE source = ?`).get(source)?.d;
  const seenFrom = daysAgo(7, date) > firstDay ? daysAgo(7, date) : daysAgo(-1, firstDay);
  const apps = db.prepare(`
    SELECT a.*, MIN(r.rank) AS best FROM apps a
    JOIN ranks r ON r.source = a.source AND r.app_id = a.app_id AND r.date = ?
    WHERE a.source = ? GROUP BY a.app_id
  `).all(date, source);
  const map = new Map();
  for (const a of apps) {
    const tags = parse(a.tags, []);
    for (const zh of tags.length ? tags : a.genre ? [a.genre] : []) {
      const t = map.get(zh) ?? map.set(zh, { zh, vi: vi(zh), games: 0, fresh: 0, top: [] }).get(zh);
      t.games++;
      if ((a.released && a.released >= freshFrom) || a.first_seen >= seenFrom) t.fresh++;
      t.top.push({ source, appId: a.app_id, title: a.title, titleVi: vi(a.title), icon: a.icon, best: a.best });
    }
  }
  const tags = [...map.values()].sort((x, y) => y.games - x.games).slice(0, 60);
  for (const t of tags) t.top = t.top.sort((x, y) => x.best - y.best).slice(0, 6);
  return { date, total: apps.length, tags };
}

export function game(source, appId) {
  const a = db.prepare(`SELECT * FROM apps WHERE source = ? AND app_id = ?`).get(source, appId);
  if (!a) return null;
  const since = daysAgo(HISTORY_DAYS);
  const history = db.prepare(`
    SELECT r.date, r.board, b.name, r.rank FROM ranks r
    JOIN boards b ON b.source = r.source AND b.board = r.board
    WHERE r.source = ? AND r.app_id = ? AND r.date >= ? ORDER BY b.ord, r.date
  `).all(source, appId, since);
  // Cùng tên game ở nguồn khác (vd có cả bản mini game lẫn bản app)
  // So khớp theo khoá tên như bảng tổng hợp (bỏ phần quảng cáo sau dấu gạch, ngoặc)
  const keys = new Set([nameKey(a.title), aliasKey(a.title)]);
  const elsewhere = db.prepare(`
    SELECT a.source, a.app_id, a.title, a.url, a.last_seen, MIN(r.rank) AS best FROM apps a
    LEFT JOIN ranks r ON r.source = a.source AND r.app_id = a.app_id AND r.date = a.last_seen
    WHERE a.title LIKE ? AND NOT (a.source = ? AND a.app_id = ?) GROUP BY a.source, a.app_id
  `).all(`%${String(a.title).slice(0, 2)}%`, source, appId)
    .filter((r) => keys.has(nameKey(r.title)) || keys.has(aliasKey(r.title)))
    .map((r) => ({ source: r.source, appId: r.app_id, url: r.url, lastSeen: r.last_seen, best: r.best }));
  return { app: { ...shape(a), descr: a.descr }, history, elsewhere };
}

export function search(q) {
  const needle = `%${q.trim()}%`;
  if (needle.length < 3) return [];
  return db.prepare(`
    SELECT a.* FROM apps a LEFT JOIN tr t ON t.zh = a.title
    WHERE a.title LIKE ? OR t.vi LIKE ? OR a.developer LIKE ?
    ORDER BY a.last_seen DESC LIMIT 60
  `).all(needle, needle, needle).map(shape);
}

// ---------- Bảng tổng hợp: gộp cùng một game ở mọi nguồn ----------
// Khoá so khớp tên: bỏ phần quảng cáo sau dấu gạch / ngoặc ("地铁跑酷-时光十三载" → "地铁跑酷"),
// bỏ khoảng trắng và dấu câu. alias cắt thêm ở dấu hai chấm ("和平精英：雪战冬日版本上线" → "和平精英").
const PUNCT = /[\s·・:：!！,，.。'"“”‘’《》<>?？~～、]/g;
export const nameKey = (t) => String(t ?? "").normalize("NFKC").toLowerCase()
  .split(/[-–—|｜]|[（(【\[]/)[0].replace(PUNCT, "");
const aliasKey = (t) => nameKey(String(t ?? "").normalize("NFKC").split(/[:：]/)[0]);

const KIND = Object.fromEntries(SOURCES.map((s) => [s.key, s.kind]));
const SOURCE_ORDER = Object.fromEntries(SOURCES.map((s, i) => [s.key, i]));

function aggregateOn(date, kind) {
  const skip = AGGREGATE.skipBoards;
  const rows = db.prepare(`
    SELECT r.source, r.board, r.rank, a.*, b.name AS board_name,
      (SELECT COUNT(*) FROM ranks n WHERE n.date = r.date AND n.source = r.source AND n.board = r.board) AS size
    FROM ranks r
    JOIN apps a ON a.source = r.source AND a.app_id = r.app_id
    JOIN boards b ON b.source = r.source AND b.board = r.board
    WHERE r.date = ?
  `).all(date).filter((r) => !(skip[r.source] ?? []).includes(r.board) && (!kind || KIND[r.source] === kind));

  // Mỗi (nguồn, game): giữ bảng cho điểm cao nhất. Điểm = 100 × (N − hạng + 1) / N, N = số game của bảng
  const best = new Map();
  for (const r of rows) {
    const pts = (100 * (r.size - r.rank + 1)) / r.size;
    const k = `${r.source}|${r.app_id}`;
    const cur = best.get(k);
    if (!cur || pts > cur.pts) best.set(k, { ...r, pts, boards: (cur?.boards ?? 0) + 1 });
    else cur.boards++;
  }

  // Gom theo tên
  const clusters = new Map();
  for (const m of best.values()) {
    const key = nameKey(m.title);
    if (!key) continue;
    (clusters.get(key) ?? clusters.set(key, { key, members: [] }).get(key)).members.push(m);
  }
  // Gộp "X：phụ đề" vào "X" chỉ khi không mơ hồ: đúng một cụm dùng tiền tố X, và hai bên không trùng nguồn
  // (vd "斗罗大陆：传承" và "斗罗大陆：诛邪传说" là hai game khác nhau, không gộp vào "斗罗大陆")
  const byAlias = new Map();
  for (const c of clusters.values()) {
    const alias = aliasKey(c.members[0].title);
    if (alias && alias !== c.key && clusters.has(alias)) (byAlias.get(alias) ?? byAlias.set(alias, []).get(alias)).push(c);
  }
  for (const [alias, list] of byAlias) {
    const target = clusters.get(alias);
    if (list.length !== 1 || !target) continue;
    const c = list[0], used = new Set(target.members.map((m) => m.source));
    if (c.members.some((m) => used.has(m.source))) continue;
    target.members.push(...c.members);
    clusters.delete(c.key);
  }

  const list = [...clusters.values()].map((c) => {
    // Một nguồn chỉ tính một lần (có thể có 2 app cùng tên trong một nguồn)
    const bySource = new Map();
    for (const m of c.members) if (!bySource.has(m.source) || m.pts > bySource.get(m.source).pts) bySource.set(m.source, m);
    const members = [...bySource.values()].sort((x, y) => y.pts - x.pts || SOURCE_ORDER[x.source] - SOURCE_ORDER[y.source]);
    return { key: c.key, members, score: members.reduce((s, m) => s + m.pts, 0) };
  }).sort((x, y) => y.score - x.score || y.members.length - x.members.length);
  return list;
}

// top: số game tối đa (tab Puzzle gọi với Infinity để lấy cả game ngoài top của Bảng tổng hợp; không lấy từ URL)
export function aggregate(date, kind = "", top = AGGREGATE.top) {
  date = date || latestDate();
  if (!date) return { date: null, prevDate: null, rows: [] };
  kind = kind === "app" || kind === "mini" ? kind : "";
  const prevDate = db.prepare(`SELECT MAX(date) AS d FROM ranks WHERE date < ?`).get(date)?.d ?? null;
  const list = aggregateOn(date, kind);
  const prevPos = new Map();
  if (prevDate) aggregateOn(prevDate, kind).forEach((c, i) => prevPos.set(c.key, i + 1));
  const firstDay = db.prepare(`SELECT MIN(date) AS d FROM ranks`).get()?.d;
  const freshFrom = daysAgo(FRESH_DAYS, date), seenFrom = daysAgo(7, date);
  const rows = list.slice(0, top).map((c, i) => {
    const lead = c.members[0];
    const tags = new Map();
    for (const m of c.members) for (const zh of parse(m.tags, m.genre ? [m.genre] : [])) if (!tags.has(zh)) tags.set(zh, { zh, vi: vi(zh) });
    const released = c.members.map((m) => m.released).filter(Boolean).sort()[0] ?? null;
    const firstSeen = c.members.map((m) => m.first_seen).sort()[0];
    const prev = prevPos.get(c.key) ?? null;
    // Tên hiển thị: bản ngắn nhất (Xiaomi hay kèm chữ quảng cáo sau tên)
    const title = c.members.map((m) => m.title).sort((x, y) => x.length - y.length)[0];
    return {
      ...shape(lead), title, titleVi: vi(title), tags: [...tags.values()].slice(0, 6),
      developer: c.members.map((m) => m.developer).find(Boolean) ?? null,
      released, firstSeen,
      rank: i + 1, prev, delta: prev ? prev - (i + 1) : null,
      isNew: !!prevDate && !prev,
      isFresh: !!released && released >= freshFrom,
      isDiscovered: firstSeen > firstDay && firstSeen >= seenFrom,
      score: Math.round(c.score),
      members: c.members.map((m) => ({
        source: m.source, appId: m.app_id, board: m.board, boardName: m.board_name, rank: m.rank, boards: m.boards,
      })),
    };
  });
  return { date, prevDate, total: list.length, rows };
}
