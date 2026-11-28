// Tab "Trung Quốc": game thị trường Trung Quốc (mini game WeChat/Douyin, TapTap, App Store CN, Tencent 应用宝, Xiaomi).
// Dữ liệu: lib/china (quy trình 08:30 bước "china", hoặc npm run china), API /api/china/… (lib/china/routes.mjs).
// Bản công khai (window.STATIC_SITE): staticChina đọc file JSON do lib/china/export.mjs xuất vào china/data.
// Tab phụ theo đường dẫn #/china/<tab>; mọi id trong tab có tiền tố "cn-" để không trùng với phần còn lại của web.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATIC = !!window.STATIC_SITE;
const compact = new Intl.NumberFormat("vi", { notation: "compact", maximumFractionDigits: 1 });
const num = (n) => (n == null ? "" : compact.format(n));
const dmy = (d) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "");

// ---------- dữ liệu: server hoặc file tĩnh ----------
// Phải khớp với fileKey trong lib/china/export.mjs
const fileKey = (s) => encodeURIComponent(String(s)).replace(/[%*']/g, "_").replace(/^(con|prn|aux|nul|com\d|lpt\d)(?=\.|$)/i, "_$1");
const lc = (s) => String(s ?? "").toLowerCase();
const staticCache = new Map();
const load = (file) => {
  if (!staticCache.has(file)) staticCache.set(file, fetch(`china/data/${file}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return staticCache.get(file);
};
const kindFile = (p) => (p.kind === "app" || p.kind === "mini" ? p.kind : "all");
// Giữ đúng định dạng phản hồi của server. Bản tĩnh chỉ có ngày mới nhất: bỏ qua tham số date.
const staticChina = {
  meta: () => load("meta.json"),
  status: () => load("status.json"),
  aggregate: async (p) => (await load(`aggregate/${kindFile(p)}.json`)) ?? { date: null, prevDate: null, total: 0, rows: [] },
  newgames: async () => (await load("newgames.json")) ?? { date: null, rows: [] },
  videos: async (p) => (await load(`videos/${p.platform === "douyin" ? "douyin" : "bilibili"}.json`)) ?? { items: [], foundBy: [], total: 0 },
  gameplay: async () => (await load("videos/gameplay.json")) ?? { games: [], kinds: [], total: 0 },
  puzzlevideos: async () => (await load("videos/puzzle.json")) ?? { items: [], kinds: [], total: 0 },
  puzzle: async (p) => (await load(`puzzle/${kindFile(p)}.json`)) ?? { date: null, total: 0, rows: [], kinds: [] },
  chart: async (p) => (await load(`chart/${p.source}/${fileKey(p.board)}.json`)) ?? { date: null, prevDate: null, rows: [] },
  overview: async (p) => (await load(`overview/${p.source}.json`)) ?? { date: null, boards: [], fresh: [] },
  tags: async (p) => (await load(`tags/${p.source}.json`)) ?? { date: null, total: 0, tags: [] },
  game: async (p) => (await load(`game/${p.source}/${fileKey(p.appId)}.json`)) ?? { notFound: true },
  // Giống search() trong lib/china/queries.mjs: tên tiếng Trung, tên tiếng Việt hoặc nhà phát triển
  search: async (p) => {
    const needle = lc(p.q).trim();
    if (!needle) return { results: [] };
    const apps = (await load("search.json")) ?? [];
    return { results: apps.filter((a) => lc(`${a.title} ${a.titleVi ?? ""} ${a.developer ?? ""}`).includes(needle)).slice(0, 60) };
  },
  news: async (p) => {
    const d = (await load("news.json")) ?? { sources: [], items: [] };
    const needle = lc(p.q).trim();
    return { ...d, items: d.items.filter((n) => (!p.source || n.source === p.source)
      && (!needle || lc(`${n.title} ${n.titleVi ?? ""} ${n.summary ?? ""}`).includes(needle))) };
  },
};
const api = (path, params = {}) => (STATIC ? (staticChina[path] ?? (async () => ({})))(params)
  : fetch(`/api/china/${path}?${new URLSearchParams(params)}`).then((r) => r.json()));

// ---------- trạng thái ----------
const VIEWS = ["aggregate", "newgames", "puzzle", "gameplay", "bilibili", "overview", "chart", "tags", "news", "search"];
const state = {
  view: "aggregate", kind: "",
  source: localStorage.getItem("ct-source") || "wechat",
  board: null, date: "", q: "", onlyNew: false, newsSource: "",
  // genre: thể loại chuẩn hoá (lib/china/genres.mjs); newType/newDays/ngSort: tab Game mới; puzzleKind/pzSort: tab Puzzle
  genre: "", newType: "", newDays: 30, ngSort: "", puzzleKind: "", pzSort: "",
  // Tab phụ video (Bilibili): số ngày, cách sắp, tìm thấy qua (từ khoá / game), chỉ puzzle
  vDays: 30, vSort: "likes", vFound: "", vPuzzle: false, vGenre: "", vCat: "", vType: "",
  // Tab phụ Video gameplay: nhóm game (puzzle / mới / tất cả), kiểu puzzle, nguồn video (taptap / bilibili)
  gpGroup: "puzzle", gpKind: "", gpSrc: "",
  // gpMode: "feed" = kho video gameplay puzzle, "games" = theo game trên bảng xếp hạng; gpList: "" | "new" | "hits"; gpSort
  gpMode: "feed", gpList: "", gpSort: "newest",
};
let META = null;
let renderSeq = 0;
let ready = null;

const sourceName = (key) => META.sources.find((s) => s.key === key)?.name ?? key;
const icon = (src, cls = "") =>
  `<img class="cn-icon ${cls}" loading="lazy" referrerpolicy="no-referrer" src="${esc(src ?? "")}" alt="" onerror="this.style.visibility='hidden'">`;

function deltaBadge(r) {
  if (r.isNew) return `<span class="cn-badge new">MỚI VÀO</span>`;
  if (r.delta == null) return "";
  if (r.delta > 0) return `<span class="cn-badge up">▲ ${r.delta}</span>`;
  if (r.delta < 0) return `<span class="cn-badge down">▼ ${-r.delta}</span>`;
  return `<span class="cn-badge flat">–</span>`;
}
const freshBadge = (r) => (r.isFresh ? ` <span class="cn-badge fresh" title="Phát hành ${esc(r.released)}">mới ra</span>` : "");

function gameCell(g, { line = true, small = false } = {}) {
  const sub = [g.developer, g.taglineVi || g.tagline].filter(Boolean).join(" · ");
  return `<div class="cn-game">${icon(g.icon, small ? "sm" : "")}
    <div class="cn-game-text">
      <div class="cn-game-title">${esc(g.title)}${freshBadge(g)}</div>
      ${g.titleVi ? `<div class="cn-game-vi">${esc(g.titleVi)}</div>` : ""}
      ${line && sub ? `<div class="cn-game-line">${esc(sub)}</div>` : ""}
    </div></div>`;
}
const tagsHtml = (g) => {
  const tags = g.tags?.length ? g.tags : g.genre ? [{ zh: g.genre, vi: g.genreVi }] : [];
  return tags.slice(0, 4).map((t) => `<span class="cn-tag" title="${esc(t.zh)}">${esc(t.vi || t.zh)}</span>`).join("");
};
function statsHtml(g) {
  const s = g.stats ?? {}, out = [];
  if (g.score) out.push(`★ ${g.score}`);
  if (s.fans) out.push(`${num(s.fans)} theo dõi`);
  if (s.reserve) out.push(`${num(s.reserve)} đặt trước`);
  if (s.hits) out.push(`${num(s.hits)} lượt tải`);
  if (s.note) out.push(esc(s.note));
  return out.join("<br>");
}
const attrs = (g) => `data-cn-source="${esc(g.source)}" data-cn-app="${esc(g.appId)}"`;

// ---------- Bảng tổng hợp ----------
const SHORT = { wechat: "WeChat", douyin: "Douyin", taptap: "TapTap", ios: "App Store", tencent: "应用宝", xiaomi: "Xiaomi" };
function memberChips(r) {
  const kindOf = Object.fromEntries(META.sources.map((s) => [s.key, s.kind]));
  return `<div class="cn-chips">${(r.members ?? []).map((m) => `<span class="cn-chip ${kindOf[m.source] === "mini" ? "mini" : ""}" data-cn-source="${esc(m.source)}" data-cn-app="${esc(m.appId)}"
    title="${esc(sourceName(m.source))} · ${esc(m.boardName)}${m.boards > 1 ? ` (+${m.boards - 1} bảng khác)` : ""}">
    <b>${esc(SHORT[m.source] ?? m.source)} #${m.rank}</b><small>${esc(m.boardName)}</small></span>`).join("")}</div>`;
}

async function renderAggregate(main, seq) {
  const c = await api("aggregate", { date: state.date, kind: state.kind });
  if (seq !== renderSeq) return;
  if (!c.rows.length) return void (main.innerHTML = `<div class="cn-empty">Chưa có dữ liệu.</div>`);
  const needle = state.q.trim().toLowerCase();
  const rows = c.rows.filter((r) => (!state.onlyNew || r.isNew || r.isFresh || r.isDiscovered)
    && genreOk(r) && (!needle ||
    [r.title, r.titleVi, r.developer, ...r.tags.flatMap((t) => [t.zh, t.vi])].join(" ").toLowerCase().includes(needle)));
  const badge = (r) => r.isNew ? `<span class="cn-badge new">MỚI VÀO</span>` : deltaBadge(r)
    + (r.isDiscovered && !r.isNew ? ` <span class="cn-badge fresh">lần đầu thấy</span>` : "");
  main.innerHTML = `
    <p class="hint">Gộp cùng một game ở mọi nguồn${state.kind ? ` (chỉ ${state.kind === "mini" ? "mini game" : "app store"})` : ""}, ngày ${dmy(c.date)}${c.prevDate ? `, so với ${dmy(c.prevDate)}` : ""}.
      Điểm = cộng điểm của từng nguồn; mỗi nguồn lấy bảng tốt nhất, hạng 1 được 100, hạng cuối bảng gần 0. Game có mặt ở nhiều kênh sẽ lên cao.
      Bảng "đặt trước" không tính. ${rows.length}/${c.rows.length} game (trong ${c.total} game đang có mặt).</p>
    <div class="panel flush"><div class="table-wrap"><table class="cn-table">
      <thead><tr><th class="num">#</th><th>Đổi</th><th>Game</th><th class="num">Điểm</th><th>Có mặt ở</th><th>Thể loại</th><th class="num">Phát hành</th></tr></thead>
      <tbody>${rows.map((r) => `<tr ${attrs(r)}>
        <td class="cn-rank">${r.rank}</td><td>${badge(r)}</td><td>${gameCell(r)}</td>
        <td class="num cn-score">${r.score}</td><td>${memberChips(r)}</td><td>${genreHtml(r)}${tagsHtml(r)}</td>
        <td class="num cn-small">${esc(r.released ?? "")}</td>
      </tr>`).join("")}</tbody></table></div></div>`;
}

// ---------- Tổng quan ----------
async function renderOverview(main, seq) {
  const o = await api("overview", { source: state.source });
  if (seq !== renderSeq) return;
  if (!o.date) return void (main.innerHTML = `<div class="cn-empty">Chưa có dữ liệu.</div>`);
  const item = (r, right) => `<div class="cn-item" ${attrs(r)}>${gameCell(r, { small: true })}<div class="cn-right">${right}</div></div>`;
  const list = (rows, right) => rows.length ? `<div class="cn-list">${rows.map((r) => item(r, right(r))).join("")}</div>` : `<p class="hint">Không có.</p>`;
  let html = "";
  if (!o.hasHistory)
    html += `<div class="notice">Mới có dữ liệu một ngày (${dmy(o.date)}). Mục "mới vào bảng" và "tăng mạnh" sẽ có từ lần cập nhật ngày mai; hiện xem được game mới phát hành và top đầu mỗi bảng.</div>`;
  if (o.discovered?.length)
    html += `<div class="panel"><h2>Lần đầu xuất hiện trong 7 ngày qua · ${o.discovered.length} game</h2>
      <p class="hint">Game chưa từng có mặt trên bảng nào của ${esc(sourceName(state.source))} trước đó.</p>
      <div class="cn-grid">${o.discovered.map((r) => item(r, `<span class="cn-small">#${r.best}<br>${dmy(r.firstSeen)}</span>`)).join("")}</div></div>`;
  if (o.fresh.length)
    html += `<div class="panel"><h2>Mới phát hành trong ${META.freshDays} ngày, đang có mặt trên bảng · ${o.fresh.length} game</h2>
      <p class="hint">Sắp theo ngày phát hành. Số bên phải là thứ hạng tốt nhất và bảng đang có mặt.</p>
      <div class="cn-grid">${o.fresh.map((r) => item(r, `<span class="cn-small">#${r.best} · ${dmy(r.released)}<br>${esc(r.onBoards.split(",").slice(0, 2).join(", "))}</span>`)).join("")}</div></div>`;
  html += `<div class="cn-grid">` + o.boards.map((b) => `<div class="panel">
      <div class="cn-board-head"><h2>${esc(b.name)}${b.zh ? ` <span class="cn-small">${esc(b.zh)}</span>` : ""}</h2>
        <a href="#/china/chart" data-cn-board="${esc(b.key)}">Xem cả bảng (${b.total}) →</a></div>
      ${b.prevDate ? `
        <div class="cn-subhead">Mới vào bảng (so với ${dmy(b.prevDate)})</div>${list(b.entered, (r) => `<b>#${r.rank}</b>`)}
        <div class="cn-subhead">Tăng mạnh</div>${list(b.up, (r) => `<b>#${r.rank}</b> ${deltaBadge(r)}`)}`
      : `<div class="cn-subhead">Top 5</div>`}
      <div id="cn-top-${esc(b.key)}"></div>
    </div>`).join("") + `</div>`;
  main.innerHTML = html;
  // Ngày đầu chưa có so sánh: hiện top 5 mỗi bảng để trang không trống
  if (!o.hasHistory)
    for (const b of o.boards) {
      const c = await api("chart", { source: state.source, board: b.key });
      if (seq !== renderSeq) return;
      const el = document.getElementById(`cn-top-${b.key}`);
      if (el) el.innerHTML = list(c.rows.slice(0, 5), (r) => `<b>#${r.rank}</b>`);
    }
}

// ---------- Bảng xếp hạng ----------
async function renderChart(main, seq) {
  const c = await api("chart", { source: state.source, board: state.board, date: state.date });
  if (seq !== renderSeq) return;
  if (!c.rows.length) return void (main.innerHTML = `<div class="cn-empty">Chưa có dữ liệu cho bảng này.</div>`);
  const needle = state.q.trim().toLowerCase();
  const rows = c.rows.filter((r) => (!state.onlyNew || r.isNew || r.isFresh) && genreOk(r) && (!needle ||
    [r.title, r.titleVi, r.developer, r.genre, r.genreVi, r.tagline, r.taglineVi, ...r.tags.flatMap((t) => [t.zh, t.vi])]
      .join(" ").toLowerCase().includes(needle)));
  main.innerHTML = `
    <p class="hint">${esc(sourceName(state.source))} · ngày ${dmy(c.date)}${c.prevDate ? `, so với ${dmy(c.prevDate)}` : " (chưa có ngày trước để so sánh)"} · ${rows.length}/${c.rows.length} game</p>
    <div class="panel flush"><div class="table-wrap"><table class="cn-table">
      <thead><tr><th class="num">#</th><th>Đổi</th><th>Game</th><th>Thể loại</th><th>Chỉ số</th><th class="num">Phát hành</th><th class="num">Ngày trên bảng</th></tr></thead>
      <tbody>${rows.map((r) => `<tr ${attrs(r)}>
        <td class="cn-rank">${r.rank}</td><td>${deltaBadge(r)}</td><td>${gameCell(r)}</td>
        <td>${genreHtml(r)}${tagsHtml(r)}</td><td class="cn-small">${statsHtml(r)}</td>
        <td class="num cn-small">${esc(r.released ?? "")}</td><td class="num cn-small">${r.days}</td>
      </tr>`).join("")}</tbody></table></div></div>`;
}

// ---------- Thể loại chuẩn hoá (lib/china/genres.mjs) ----------
const genreName = (k) => META.genres?.find((g) => g.key === k)?.name ?? k;
const kindName = (k) => META.puzzleKinds?.find((p) => p.key === k)?.name ?? k;
const genreOk = (r) => !state.genre || r.genres?.includes(state.genre);
// Nhãn thể loại: kiểu puzzle nổi bật trước, rồi tối đa 3 thể loại khác
function genreHtml(r) {
  const out = r.puzzle ? [`<span class="cn-gtag puzzle" title="Puzzle">${esc(kindName(r.puzzle))}</span>`] : [];
  for (const g of (r.genres ?? []).filter((k) => k !== "puzzle").slice(0, 3)) out.push(`<span class="cn-gtag">${esc(genreName(g))}</span>`);
  return out.length ? `<div>${out.join("")}</div>` : "";
}
const textOf = (r) => [r.title, r.titleVi, r.developer, r.tagline, r.taglineVi, ...(r.tags ?? []).flatMap((t) => [t.zh, t.vi]),
  ...(r.genres ?? []).map(genreName), r.puzzle ? kindName(r.puzzle) : ""].join(" ").toLowerCase();
const dayBefore = (n, from) => { const d = new Date(from + "T12:00:00"); d.setDate(d.getDate() - n); return d.toLocaleDateString("sv-SE"); };

// ---------- Game mới ----------
async function renderNewGames(main, seq) {
  const d = await api("newgames");
  if (seq !== renderSeq) return;
  if (!d.rows?.length) return void (main.innerHTML = `<div class="cn-empty">Chưa có dữ liệu.</div>`);
  const since = dayBefore(state.newDays, d.date);
  const kindOf = Object.fromEntries(META.sources.map((s) => [s.key, s.kind]));
  const inDays = (r) => (r.isReleased && r.released >= since) || (r.isDiscovered && r.firstSeen >= since);
  const TYPE = {
    released: (r) => r.isReleased && r.released >= since,
    newBoard: (r) => r.onNewBoard,
    upcoming: (r) => r.isUpcoming,
    discovered: (r) => r.isDiscovered && r.firstSeen >= since,
    "": (r) => inDays(r) || r.onNewBoard || r.isUpcoming,
  };
  const needle = state.q.trim().toLowerCase();
  const base = d.rows.filter((r) => (!state.kind || r.members.some((m) => kindOf[m.source] === state.kind)) && genreOk(r)
    && (!needle || textOf(r).includes(needle)));
  const count = (k) => base.filter(TYPE[k]).length;
  const rows = base.filter(TYPE[state.newType] ?? TYPE[""]);
  // "Mới phát hành trước": game có ngày phát hành / ngày lên bảng lần đầu xếp theo ngày, còn lại theo hạng
  const newest = (r) => (r.isReleased ? r.released : r.isDiscovered ? r.firstSeen : "");
  const follow = (r) => (r.stats?.reserve ?? 0) + (r.stats?.fans ?? 0);
  const sorters = {
    "": (a, b) => newest(b).localeCompare(newest(a)) || a.best - b.best,
    rank: (a, b) => a.best - b.best,
    follow: (a, b) => follow(b) - follow(a) || a.best - b.best,
  };
  rows.sort(sorters[state.ngSort] ?? sorters[""]);
  const why = (r) => [
    r.isReleased ? `<span class="cn-badge fresh">Phát hành ${dmy(r.released)}</span>` : "",
    r.onNewBoard ? `<span class="cn-badge new">Bảng game mới</span>` : "",
    r.isUpcoming ? `<span class="cn-badge flat">Sắp ra mắt</span>` : "",
    r.isDiscovered ? `<span class="cn-badge up">Lên bảng ${dmy(r.firstSeen)}</span>` : "",
  ].join("");
  main.innerHTML = `
    <p class="hint">Game mới ở mọi nguồn, gộp theo tên, ngày ${dmy(d.date)}. Trong ${state.newDays} ngày: ${count("released")} mới phát hành,
      ${count("discovered")} lần đầu lên bảng; đang có ${count("newBoard")} game trên các bảng game mới và ${count("upcoming")} game sắp ra mắt.
      Chỉ App Store và TapTap có ngày phát hành; mini game, 应用宝, Xiaomi chỉ biết qua bảng game mới hoặc ngày lần đầu lên bảng
      (tính từ ngày thứ hai có dữ liệu). Đang hiện ${rows.length} game.</p>
    ${rows.length ? `<div class="panel flush"><div class="table-wrap"><table class="cn-table">
      <thead><tr><th>Game</th><th>Vì sao mới</th><th>Có mặt ở</th><th>Thể loại</th><th>Chỉ số</th></tr></thead>
      <tbody>${rows.map((r) => `<tr ${attrs(r)}>
        <td>${gameCell(r)}</td><td><div class="cn-why">${why(r)}</div></td><td>${memberChips(r)}</td>
        <td>${genreHtml(r)}${tagsHtml(r)}</td><td class="cn-small">${statsHtml(r)}</td>
      </tr>`).join("")}</tbody></table></div></div>` : `<div class="cn-empty">Không có game nào khớp bộ lọc.</div>`}`;
}

// ---------- Puzzle ----------
async function renderPuzzle(main, seq) {
  const d = await api("puzzle", { kind: state.kind });
  if (seq !== renderSeq) return;
  if (!d.rows?.length) return void (main.innerHTML = `<div class="cn-empty">Chưa có dữ liệu.</div>`);
  const needle = state.q.trim().toLowerCase();
  const rows = d.rows.filter((r) => (!state.puzzleKind || r.puzzle === state.puzzleKind)
    && (!state.onlyNew || r.isNew7 || r.isNew || r.isFresh || r.isDiscovered) && (!needle || textOf(r).includes(needle)));
  if (state.pzSort === "newest") rows.sort((a, b) => String(b.released ?? "").localeCompare(String(a.released ?? "")) || a.puzzleRank - b.puzzleRank);
  const card = (k, n, new7, lead, label) => `<button class="cn-pcard ${state.puzzleKind === k ? "active" : ""}" data-cn-pkind="${esc(k)}">
      <div class="cn-pcard-head"><b>${esc(label)}</b><span>${n}</span></div>
      <div class="cn-small">${new7 ? `<span class="cn-badge fresh">${new7} mới 7 ngày</span>` : "&nbsp;"}</div>
      ${lead ? `<div class="cn-pcard-lead">${icon(lead.icon, "sm")}<span title="${esc(lead.titleVi ?? "")}">${esc(lead.title)}</span></div>` : ""}
    </button>`;
  const totalNew = d.rows.filter((r) => r.isNew7).length;
  main.innerHTML = `
    <div class="cn-pcards">
      ${card("", d.total, totalNew, d.rows[0], "Tất cả puzzle")}
      ${d.kinds.map((k) => card(k.key, k.n, k.new7, k.lead, k.name)).join("")}
    </div>
    <p class="hint">Game puzzle đang có mặt trên bảng ở mọi nguồn${state.kind ? ` (chỉ ${state.kind === "mini" ? "mini game" : "app store"})` : ""}, ngày ${dmy(d.date)},
      xếp theo điểm của Bảng tổng hợp. Kiểu puzzle đoán từ tên tiếng Trung, tag và bảng của nền tảng (vd bảng Puzzle của App Store),
      nên có thể lệch. Bấm thẻ để lọc theo kiểu. Đang hiện ${rows.length}/${d.total} game.</p>
    ${rows.length ? `<div class="panel flush"><div class="table-wrap"><table class="cn-table">
      <thead><tr><th class="num">#</th><th>Đổi</th><th>Game</th><th class="num">Điểm</th><th>Có mặt ở</th><th>Kiểu / thể loại</th><th class="num">Phát hành</th></tr></thead>
      <tbody>${rows.map((r) => `<tr ${attrs(r)}>
        <td class="cn-rank">${r.puzzleRank}</td><td>${r.isNew7 ? `<span class="cn-badge fresh">mới 7 ngày</span>` : deltaBadge(r)}</td><td>${gameCell(r)}</td>
        <td class="num cn-score">${r.score}</td><td>${memberChips(r)}</td><td>${genreHtml(r)}</td>
        <td class="num cn-small">${esc(r.released ?? "")}</td>
      </tr>`).join("")}</tbody></table></div></div>` : `<div class="cn-empty">Không có game nào khớp bộ lọc.</div>`}`;
}

// ---------- Video (Bilibili) ----------
const PLATFORM = { bilibili: "Bilibili", douyin: "Douyin" };
async function renderVideos(main, seq) {
  const platform = state.view;
  const d = await api("videos", { platform });
  if (seq !== renderSeq) return;
  // Ô "Tìm thấy qua": từ khoá trước, rồi tên game
  const sel = $("#cn-vfound");
  const found = [...d.foundBy].sort((a, b) => a.startsWith("game:") - b.startsWith("game:") || a.localeCompare(b));
  sel.innerHTML = `<option value="">Tất cả từ khoá và game</option>` + found.map((f) => `<option value="${esc(f)}">${esc(f.replace(/^game: /, "Game: "))}</option>`).join("");
  sel.value = found.includes(state.vFound) ? state.vFound : "";
  const CAT_VI = { 手机游戏: "Game mobile", 单机游戏: "Game đơn (PC/console)", 网络游戏: "Game online", 电子竞技: "Thể thao điện tử",
    桌游棋牌: "Cờ bài / board game", 音游: "Game âm nhạc", GMV: "GMV (video cắt ghép)", Mugen: "Mugen" };
  $("#cn-vgenre").innerHTML = `<option value="">Tất cả thể loại</option>` + (d.genres ?? []).map((g) => `<option value="${esc(g.key)}">${esc(g.name)} (${g.n})</option>`).join("");
  $("#cn-vgenre").value = (d.genres ?? []).some((g) => g.key === state.vGenre) ? state.vGenre : "";
  $("#cn-vcat").innerHTML = `<option value="">Tất cả khu</option>` + (d.categories ?? []).map((c) => `<option value="${esc(c.key)}">${esc(CAT_VI[c.key] ?? c.key)} (${c.n})</option>`).join("");
  $("#cn-vcat").value = (d.categories ?? []).some((c) => c.key === state.vCat) ? state.vCat : "";
  const vGenreName = Object.fromEntries((d.genres ?? []).map((g) => [g.key, g.name]));
  if (!d.items.length) return void (main.innerHTML = `<div class="cn-empty">Chưa có video ${esc(PLATFORM[platform])}.${STATIC ? "" : ` Bấm "Cập nhật Trung Quốc" để lấy (khoảng 3 phút).`}</div>`);
  const since = dayBefore(state.vDays - 1, new Date().toLocaleDateString("sv-SE"));
  const needle = state.q.trim().toLowerCase();
  const rows = d.items.filter((v) => v.pubdate >= since && (!state.vFound || v.foundBy === state.vFound) && (!state.vPuzzle || v.puzzle)
    && (!state.vType || v.kind === state.vType)
    && (!state.vGenre || v.genres?.includes(state.vGenre)) && (!state.vCat || v.category === state.vCat)
    && (!needle || [v.title, v.titleVi, v.author, v.game, v.category, ...v.tags].join(" ").toLowerCase().includes(needle)));
  const sorters = {
    likes: (a, b) => b.likes - a.likes,
    likesGain: (a, b) => (b.likesGain ?? -1) - (a.likesGain ?? -1) || b.likes - a.likes,
    play: (a, b) => b.play - a.play,
    favs: (a, b) => b.favs - a.favs,
    comments: (a, b) => b.comments - a.comments,
    newest: (a, b) => b.pubdate.localeCompare(a.pubdate) || b.likes - a.likes,
  };
  rows.sort(sorters[state.vSort] ?? sorters.likes);
  const shown = rows.slice(0, 300);
  const gain = (n) => (n > 0 ? ` <span class="cn-badge up" title="Tăng so với lần lấy trước">+${num(n)}</span>` : "");
  main.innerHTML = `
    <p class="hint">Video ${esc(PLATFORM[platform])} khu Game đăng trong ${state.vDays} ngày, tìm theo từ khoá về game mới và theo tên các game ở tab Game mới,
      cập nhật mỗi ngày (lần cuối ${dmy(d.lastFetch)}). Mức tăng (xanh) so với lần lấy trước. ${rows.length} video${rows.length > shown.length ? `, hiện ${shown.length} đầu` : ""}.</p>
    ${shown.length ? `<div class="cn-vgrid">${shown.map((v, i) => `
      <a class="cn-video" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">
        <div class="cn-vthumb">${v.cover ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(v.cover)}@320w_200h_1c.webp" alt="" onerror="this.style.visibility='hidden'">` : ""}
          <span class="cn-vrank">#${i + 1}</span>${v.duration ? `<span class="cn-vdur">${esc(v.duration)}</span>` : ""}</div>
        <div class="cn-vbody">
          <div class="cn-vtitle" title="${esc(v.title)}">${esc(v.titleVi || v.title)}</div>
          ${v.titleVi ? `<div class="cn-vzh">${esc(v.title)}</div>` : ""}
          <div class="cn-vstats"><span>♥ <b>${num(v.likes)}</b>${gain(v.likesGain)}</span><span>▶ ${num(v.play)}${gain(v.playGain)}</span>
            <span>★ ${num(v.favs)}</span><span>💬 ${num(v.comments)}</span></div>
          <div class="cn-vmeta">${esc(v.author ?? "")} · ${dmy(v.pubdate)}${v.category ? ` · ${esc(v.category)}` : ""}</div>
          <div>${v.kind ? `<span class="cn-vkind ${esc(v.kind)}">${esc(VKIND[v.kind] ?? v.kind)}</span>` : ""}${v.puzzle ? `<span class="cn-gtag puzzle">${esc(kindName(v.puzzle))}</span>` : ""}${(v.genres ?? []).filter((k) => k !== "puzzle").slice(0, 2).map((k) => `<span class="cn-gtag">${esc(vGenreName[k] ?? k)}</span>`).join("")}${v.game ? `<span class="cn-gtag" title="Tìm theo tên game mới">${esc(v.game)}</span>` : `<span class="cn-tag">${esc(v.foundBy)}</span>`}</div>
        </div>
      </a>`).join("")}</div>` : `<div class="cn-empty">Không có video nào khớp bộ lọc.</div>`}`;
}

// ---------- Video gameplay ----------
// Mỗi game một thẻ: video chính thức trên TapTap (ảnh động xem trước) và clip Bilibili đúng tên game, gameplay trước.
// Bấm clip Bilibili để xem ngay bằng trình phát nhúng; bấm video TapTap để xem ảnh động lớn và mở trang video TapTap.
const VKIND = { trial: "Thử chơi", official: "Giới thiệu chính thức", taptap: "Video chính thức", gameplay: "Gameplay", review: "Đánh giá", pv: "PV / giới thiệu", other: "Khác" };
const fmtDur = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
let gpVideos = new Map();
// Danh sách video giữ lại trong phiên xem để đổi bộ lọc không phải tải lại; xoá khi tải lại meta (sau một lần cập nhật)
const gpCache = new Map();
const gpData = async (path) => gpCache.get(path) ?? gpCache.set(path, await api(path)).get(path);

function gpTile(g, v) {
  const id = `${v.source}:${v.id}`;
  gpVideos.set(id, { ...v, game: g });
  const dur = v.duration ? `<span class="cn-gp-dur">${fmtDur(v.duration)}</span>` : "";
  if (v.source === "taptap") {
    const tall = (v.aspect ?? 1) < 1;
    return `<button type="button" class="cn-gp-tile ${tall ? "tall" : "wide"}" data-cn-gp="${esc(id)}" title="${esc(v.title)} · bấm để xem lớn">
      <div class="cn-gp-media"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(v.anim || v.cover)}" alt="" onerror="this.style.visibility='hidden'">
        <span class="cn-gp-src taptap">TapTap</span>${dur}</div>
      <div class="cn-gp-cap"><span class="cn-vkind ${esc(v.kind)}">${esc(VKIND[v.kind] ?? v.kind)}</span></div>
    </button>`;
  }
  return `<button type="button" class="cn-gp-tile bili" data-cn-gp="${esc(id)}" title="${esc(v.title)} · bấm để xem ngay">
    <div class="cn-gp-media">${v.cover ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(v.cover)}@320w_200h_1c.webp" alt="" onerror="this.style.visibility='hidden'">` : ""}
      <span class="cn-gp-src bili">Bilibili</span>${dur}<span class="cn-gp-play">▶</span></div>
    <div class="cn-gp-cap"><span class="cn-vkind ${esc(v.kind)}">${esc(VKIND[v.kind] ?? v.kind)}</span>
      <span class="cn-gp-title">${esc(v.titleVi || v.title)}</span>
      <span class="cn-small">▶ ${num(v.play)}${v.pubdate ? ` · ${dmy(v.pubdate)}/${v.pubdate.slice(2, 4)}` : ""}</span></div>
  </button>`;
}

// Hai chế độ: kho video gameplay puzzle (mặc định, không phụ thuộc bảng xếp hạng) và video theo game trên bảng xếp hạng
async function renderGameplay(main, seq) {
  $("#view-china").dataset.cnGpmode = state.gpMode;
  return state.gpMode === "games" ? renderGameplayGames(main, seq) : renderPuzzleFeed(main, seq);
}

// Kho video gameplay puzzle: video chính thức của mọi game gắn tag puzzle trên TapTap (cả game mới ra, game nhỏ, mini game)
// và clip gameplay Bilibili của game puzzle trên bảng xếp hạng. Thẻ theo kiểu puzzle để lọc, lưới ảnh động xem trước.
async function renderPuzzleFeed(main, seq) {
  const d = await gpData("puzzlevideos");
  if (seq !== renderSeq) return;
  if (!d.items?.length) return void (main.innerHTML = `<div class="cn-empty">Chưa có video.${STATIC ? "" : ` Video được lấy ở bước "Kho video gameplay puzzle" của lần cập nhật Trung Quốc.`}</div>`);
  const needle = state.q.trim().toLowerCase();
  const base = d.items.filter((v) => (!state.gpSrc || v.source === state.gpSrc)
    && (!state.kind || (state.kind === "mini" ? v.mini : !v.mini))
    && (!state.gpList || (state.gpList === "new" ? v.inNew : v.inHits))
    && (!needle || lc([v.game, v.gameVi, v.title, v.titleVi, v.tagline, v.taglineVi, ...(v.tags ?? []).flatMap((t) => [t.zh, t.vi])].join(" ")).includes(needle)));
  const n = new Map();
  for (const v of base) n.set(v.pkind, (n.get(v.pkind) ?? 0) + 1);
  const kinds = (d.kinds ?? []).filter((k) => n.get(k.key)).map((k) => ({ ...k, n: n.get(k.key) }));
  $("#cn-gpkind").innerHTML = `<option value="">Mọi kiểu</option>` + kinds.map((k) => `<option value="${esc(k.key)}">${esc(k.name)} (${k.n})</option>`).join("");
  $("#cn-gpkind").value = kinds.some((k) => k.key === state.gpKind) ? state.gpKind : "";
  const rows = base.filter((v) => !state.gpKind || v.pkind === state.gpKind);
  const date = (v) => v.released ?? "";
  const sorters = {
    newest: (a, b) => date(b).localeCompare(date(a)) || (b.fans ?? b.play ?? 0) - (a.fans ?? a.play ?? 0),
    fans: (a, b) => (b.fans ?? b.play ?? 0) - (a.fans ?? a.play ?? 0),
    short: (a, b) => (a.duration ?? 1e9) - (b.duration ?? 1e9),
  };
  rows.sort(sorters[state.gpSort] ?? sorters.newest);
  const shown = rows.slice(0, 240);
  gpVideos = new Map();
  const card = (key, label, count) => `<button type="button" class="cn-pcard ${state.gpKind === key ? "active" : ""}" data-cn-gpk="${esc(key)}">
    <div class="cn-pcard-head"><b>${esc(label)}</b><span>${count}</span></div></button>`;
  const tile = (v) => {
    const id = `${v.source}:${v.id}`;
    gpVideos.set(id, { ...v, kind: v.source === "taptap" ? "taptap" : "gameplay", game: { title: v.game, titleVi: v.gameVi } });
    const img = v.source === "taptap" ? v.anim || v.cover : v.cover ? `${v.cover}@320w_200h_1c.webp` : "";
    const when = (d) => `${dmy(d)}/${d.slice(2, 4)}`;
    const meta = [v.released ? `Game ra ${when(v.released)}` : "", v.posted ? `đăng ${when(v.posted)}` : "",
      v.fans ? `${num(v.fans)} theo dõi` : "", v.play ? `▶ ${num(v.play)}` : ""].filter(Boolean).join(" · ");
    return `<button type="button" class="cn-pv ${v.source}" data-cn-gp="${esc(id)}" title="${esc(v.titleVi || v.title || "")}">
      <div class="cn-pv-media">${img ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(img)}" alt="" onerror="this.style.visibility='hidden'">` : ""}
        <span class="cn-gp-src ${v.source === "taptap" ? "taptap" : "bili"}">${v.source === "taptap" ? "TapTap" : "Bilibili"}</span>
        ${v.duration ? `<span class="cn-gp-dur">${fmtDur(v.duration)}</span>` : ""}${v.source === "bilibili" ? `<span class="cn-gp-play">▶</span>` : ""}</div>
      <div class="cn-pv-cap"><b class="cn-pv-game">${esc(v.game)}</b>${v.gameVi ? `<span class="cn-small cn-pv-vi">${esc(v.gameVi)}</span>` : ""}
        <div><span class="cn-gtag puzzle">${esc(kindName(v.pkind))}</span>${v.mini ? `<span class="cn-gtag">Mini game</span>` : ""}</div>
        ${meta ? `<span class="cn-small">${meta}</span>` : ""}</div>
    </button>`;
  };
  main.innerHTML = `
    <div class="cn-pcards">${card("", "Tất cả", base.length)}${kinds.map((k) => card(k.key, k.name, k.n)).join("")}</div>
    <p class="hint">Video gameplay của game puzzle, không phụ thuộc bảng xếp hạng. <b>TapTap</b>: video chính thức của mọi game gắn tag puzzle
      (益智, 消除, 解谜, 合成, 三消, 找茬, 解压, 拼图), cả game mới ra trong ngày, game nhỏ và mini game; ảnh động là vài giây trích từ video.
      <b>Bilibili</b>: clip gameplay người chơi quay của game puzzle trên bảng xếp hạng, bấm để xem ngay. Kiểu puzzle đoán từ tên game,
      không đoán được thì vào "Puzzle khác". ${rows.length} video${rows.length > shown.length ? `, hiện ${shown.length} đầu` : ""}.</p>
    ${shown.length ? `<div class="cn-pv-grid">${shown.map(tile).join("")}</div>` : `<div class="cn-empty">Không có video nào khớp bộ lọc.</div>`}`;
}

async function renderGameplayGames(main, seq) {
  const d = await gpData("gameplay");
  if (seq !== renderSeq) return;
  $("#cn-gpkind").innerHTML = `<option value="">Mọi kiểu</option>` + (d.kinds ?? []).map((k) => `<option value="${esc(k.key)}">${esc(k.name)} (${k.n})</option>`).join("");
  $("#cn-gpkind").value = (d.kinds ?? []).some((k) => k.key === state.gpKind) ? state.gpKind : "";
  if (!d.games?.length) return void (main.innerHTML = `<div class="cn-empty">Chưa có video gameplay.${STATIC ? "" : ` Video được lấy ở bước "Video gameplay" của lần cập nhật Trung Quốc.`}</div>`);
  const kindOf = Object.fromEntries(META.sources.map((s) => [s.key, s.kind]));
  const needle = state.q.trim().toLowerCase();
  const games = d.games.filter((g) => (state.gpGroup === "puzzle" ? g.isPuzzle : state.gpGroup === "new" ? g.isNew : true)
    && (!state.gpKind || g.puzzle === state.gpKind)
    && (!state.kind || (g.members ?? []).some((m) => kindOf[m.source] === state.kind))
    && (!needle || textOf(g).includes(needle) || g.videos.some((v) => lc(`${v.title} ${v.titleVi ?? ""}`).includes(needle))))
    .map((g) => ({ ...g, videos: g.videos.filter((v) => !state.gpSrc || v.source === state.gpSrc) }))
    .filter((g) => g.videos.length);
  gpVideos = new Map();
  const GROUP = { puzzle: "game puzzle", new: "game mới", "": "game puzzle và game mới" };
  main.innerHTML = `
    <p class="hint">Video cho thấy cách chơi của từng ${GROUP[state.gpGroup] ?? "game"}, xếp như tab Puzzle (game mới xếp theo hạng tốt nhất).
      <b>TapTap</b>: video chính thức của nhà phát hành, ảnh động là vài giây trích từ video. <b>Bilibili</b>: clip có đúng tên game trong tiêu đề,
      gameplay trước, bấm để xem ngay. Mỗi game tra lại sau ${d.recheckDays} ngày${d.pending ? `; còn ${d.pending} game chưa tra, sẽ tra dần mỗi ngày` : ""}${d.noVideo ? `; ${d.noVideo} game đã tra nhưng chưa tìm thấy video` : ""}.
      Đang hiện ${games.length} game.</p>
    ${games.length ? `<div class="cn-gp-list">${games.map((g) => `
      <div class="cn-gp-game">
        <div class="cn-gp-head">
          <div class="cn-gp-name" ${attrs(g)} title="Bấm để xem chi tiết game">${gameCell(g, { small: true, line: false })}</div>
          <div class="cn-gp-badges">${g.puzzleRank ? `<span class="cn-badge flat" title="Hạng trong tab Puzzle">#${g.puzzleRank} puzzle</span>` : ""}
            ${g.isNew ? `<span class="cn-badge fresh">Game mới</span>` : ""}${genreHtml(g)}</div>
          ${memberChips(g)}
        </div>
        <div class="cn-gp-strip">${g.videos.map((v) => gpTile(g, v)).join("")}</div>
      </div>`).join("")}</div>` : `<div class="cn-empty">Không có game nào khớp bộ lọc.</div>`}`;
}

function openPlayer(id) {
  const v = gpVideos.get(id);
  if (!v) return;
  let dlg = $("#cn-player");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "cn-player";
    dlg.className = "cn-player";
    $("#view-china").append(dlg);
    // Đóng là dừng video (xoá iframe)
    dlg.addEventListener("close", () => { dlg.innerHTML = ""; });
  }
  const g = v.game;
  const body = v.source === "bilibili"
    ? `<div class="cn-player-frame"><iframe src="https://player.bilibili.com/player.html?isOutside=true&bvid=${encodeURIComponent(v.id)}&autoplay=1&danmaku=0&high_quality=1"
        allow="autoplay; fullscreen; encrypted-media" allowfullscreen referrerpolicy="no-referrer" title="Trình phát Bilibili"></iframe></div>`
    : `<div class="cn-player-anim"><img referrerpolicy="no-referrer" src="${esc(v.anim || v.cover)}" alt=""></div>
       <p class="cn-small">Ảnh động vài giây trích từ ${esc((VKIND[v.kind] ?? "video").toLowerCase())} của nhà phát hành${v.duration ? ` (video dài ${fmtDur(v.duration)})` : ""}.
       TapTap không cho phát video từ trang khác, bấm "Xem trên TapTap" để xem đủ.</p>`;
  dlg.innerHTML = `
    <div class="cn-player-head">
      <div><b>${esc(g.title)}</b>${g.titleVi ? ` <span class="cn-small">${esc(g.titleVi)}</span>` : ""}
        <div class="cn-small">${esc(v.titleVi || v.title)}${v.titleVi ? ` · ${esc(v.title)}` : ""}</div></div>
      <button type="button" class="btn" data-cn-close-player>Đóng</button>
    </div>
    ${body}
    <div class="cn-player-links"><a class="btn primary" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">Xem trên ${v.source === "bilibili" ? "Bilibili" : "TapTap"}</a>
      ${v.author ? `<span class="cn-small">Người đăng: ${esc(v.author)}${v.play ? ` · ▶ ${num(v.play)}` : ""}</span>` : ""}</div>`;
  if (!dlg.open) dlg.showModal();
}

// ---------- Thể loại ----------
async function renderTags(main, seq) {
  const t = await api("tags", { source: state.source });
  if (seq !== renderSeq) return;
  if (!t.tags.length) return void (main.innerHTML = `<div class="cn-empty">Chưa có dữ liệu.</div>`);
  const max = t.tags[0].games;
  main.innerHTML = `<div class="panel"><h2>Thể loại xuất hiện nhiều nhất · ${esc(sourceName(state.source))} · ${dmy(t.date)}</h2>
    <p class="hint">Đếm trên ${t.total} game đang có mặt ở mọi bảng của nguồn này. "Mới" = phát hành trong ${META.freshDays} ngày hoặc lần đầu thấy trong 7 ngày.</p>
    ${t.tags.map((g) => `<div class="cn-tagrow">
      <div><b>${esc(g.vi || g.zh)}</b> <span class="cn-small">${g.vi ? esc(g.zh) : ""}</span>
        <div class="cn-small">${g.games} game${g.fresh ? ` · <span class="cn-badge fresh">${g.fresh} mới</span>` : ""}</div>
        <div class="cn-bar"><i style="width:${Math.round((g.games / max) * 100)}%"></i></div></div>
      <div class="cn-minis">${g.top.map((a) => `<span class="cn-mini" ${attrs(a)} title="${esc(a.titleVi ?? "")}">
        <img loading="lazy" referrerpolicy="no-referrer" src="${esc(a.icon ?? "")}" alt=""><span>${esc(a.title)}</span></span>`).join("")}</div>
    </div>`).join("")}</div>`;
}

// ---------- Tin ngành ----------
async function renderNews(main, seq) {
  const n = await api("news", { source: state.newsSource, q: state.q });
  if (seq !== renderSeq) return;
  const sel = $("#cn-news-source");
  sel.innerHTML = `<option value="">Tất cả</option>` + n.sources.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join("");
  sel.value = state.newsSource;
  const name = Object.fromEntries(n.sources.map((s) => [s.key, s.name]));
  main.innerHTML = n.items.length ? `<div class="cn-news-list">${n.items.map((i) => `<article class="panel cn-news">
      <div class="cn-small"><b>${esc(name[i.source] ?? i.source)}</b> · ${new Date(i.published).toLocaleDateString("vi-VN")}</div>
      <h3><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${esc(i.titleVi || i.title)}</a></h3>
      ${i.titleVi ? `<p>${esc(i.title)}</p>` : ""}
    </article>`).join("")}</div>` : `<div class="cn-empty">Chưa có tin.</div>`;
}

// ---------- Tìm game ----------
async function renderSearch(main, seq) {
  if (state.q.trim().length < 1) return void (main.innerHTML = `<div class="cn-empty">Gõ tên game hoặc nhà phát triển vào ô Lọc.</div>`);
  const r = await api("search", { q: state.q });
  if (seq !== renderSeq) return;
  main.innerHTML = r.results.length ? `<div class="panel"><div class="cn-grid">${r.results.map((g) =>
    `<div class="cn-item" ${attrs(g)}>${gameCell(g, { small: true })}<div class="cn-right cn-small">${esc(sourceName(g.source))}<br>${dmy(g.lastSeen)}</div></div>`
  ).join("")}</div></div>` : `<div class="cn-empty">Không tìm thấy.</div>`;
}

// ---------- Chi tiết game ----------
function spark(points) {
  const W = 200, H = 40, P = 5;
  const ranks = points.map((p) => p.rank);
  const lo = Math.min(...ranks), hi = Math.max(...ranks);
  const x = (i) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1));
  const y = (r) => (hi === lo ? H / 2 : P + ((r - lo) * (H - 2 * P)) / (hi - lo));
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(last).toFixed(1)}" cy="${y(points[last].rank).toFixed(1)}" r="3" fill="var(--accent)"/></svg>`;
}

async function openDetail(source, appId) {
  const dlg = $("#cn-detail");
  dlg.innerHTML = `<div class="cn-empty">Đang tải…</div>`;
  if (!dlg.open) dlg.showModal();
  const g = await api("game", { source, appId });
  if (g.notFound) return void (dlg.innerHTML = `<div class="cn-empty">Không tìm thấy game. <button class="btn" data-cn-close>Đóng</button></div>`);
  const a = g.app, s = a.stats ?? {};
  const byBoard = Object.values(Object.groupBy(g.history, (h) => h.board));
  const q = encodeURIComponent(a.title);
  const kv = [
    ["Nguồn", sourceName(a.source)], ["Nhà phát triển", a.developer], ["Điểm", a.score ? `★ ${a.score}` : null],
    ["Theo dõi", s.fans ? num(s.fans) : null], ["Đặt trước", s.reserve ? num(s.reserve) : null],
    ["Lượt tải", s.hits ? num(s.hits) : null], ["Đánh giá", s.reviews ? num(s.reviews) : null],
    ["Phát hành", a.released], ["Thấy lần đầu", a.firstSeen], ["Ghi chú", s.note],
    ["Kiểu puzzle", a.puzzle ? kindName(a.puzzle) : null],
    ["Thể loại", (a.genres ?? []).filter((k) => k !== "puzzle").map(genreName).join(", ") || null],
  ].filter(([, v]) => v);
  dlg.innerHTML = `
    <div class="cn-d-head">${icon(a.icon)}
      <div><h2>${esc(a.title)}</h2>${a.titleVi ? `<div class="cn-game-vi">${esc(a.titleVi)}</div>` : ""}<div style="margin-top:4px">${tagsHtml(a)}</div></div>
      <button class="btn cn-d-close" data-cn-close>Đóng</button></div>
    <div class="cn-d-body">
      <div class="cn-kv">${kv.map(([k, v]) => `<div>${esc(k)}<b>${esc(v)}</b></div>`).join("")}</div>
      ${a.taglineVi || a.tagline ? `<p><b>${esc(a.taglineVi || a.tagline)}</b>${a.taglineVi ? `<br><span class="cn-small">${esc(a.tagline)}</span>` : ""}</p>` : ""}
      ${a.descr ? `<div><p>${esc(a.descrVi || a.descr)}</p>${a.descrVi ? `<details><summary>Bản gốc tiếng Trung</summary><p class="cn-small">${esc(a.descr)}</p></details>` : ""}</div>` : ""}
      <div><h3>Thứ hạng gần đây</h3><div class="cn-hist" style="margin-top:8px">${byBoard.map((pts) => {
        const last = pts.at(-1), first = pts[0];
        const d = first.rank - last.rank;
        return `<div class="cn-hist-card"><div class="cn-small">${esc(last.name)}</div>
          <b>#${last.rank}</b> <span class="cn-small">${pts.length > 1 ? `${pts.length} ngày · ${d > 0 ? "▲" + d : d < 0 ? "▼" + -d : "đứng yên"}` : dmy(last.date)}</span>${spark(pts)}</div>`;
      }).join("") || `<span class="cn-small">Không có trên bảng nào trong 30 ngày qua.</span>`}</div></div>
      ${g.elsewhere.length ? `<div><h3>Cùng tên ở nguồn khác</h3><div class="cn-links" style="margin-top:8px">${g.elsewhere.map((e) =>
        `<a href="#" data-cn-source="${esc(e.source)}" data-cn-app="${esc(e.appId)}">${esc(sourceName(e.source))}<small>${e.best ? `#${e.best} · ` : ""}${dmy(e.lastSeen)}</small></a>`).join("")}</div></div>` : ""}
      <div><h3>Tra cứu thêm</h3><div class="cn-links" style="margin-top:8px">
        ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Trang nguồn<small>${esc(sourceName(a.source))}</small></a>` : ""}
        ${META.lookupLinks.map((l) => `<a href="${esc(l.url.replace("{q}", q))}" target="_blank" rel="noopener noreferrer">${esc(l.name)}<small>${esc(l.desc)}</small></a>`).join("")}
      </div></div>
    </div>`;
  dlg.scrollTop = 0;
}

// ---------- Điều khiển ----------
function fillControls() {
  const src = META.sources.find((s) => s.key === state.source) ?? META.sources[0];
  if (!src) return;
  state.source = src.key;
  $("#cn-source").innerHTML = META.sources.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join("");
  $("#cn-source").value = state.source;
  if (!src.boards.some((b) => b.key === state.board)) state.board = src.boards[0]?.key ?? null;
  $("#cn-board").innerHTML = src.boards.map((b) => `<option value="${esc(b.key)}">${esc(b.name)}${b.zh ? ` · ${esc(b.zh)}` : ""}</option>`).join("");
  $("#cn-board").value = state.board;
  $("#cn-date").innerHTML = `<option value="">Mới nhất</option>` + (META.dates ?? []).map((d) => `<option>${d}</option>`).join("");
  $("#cn-date").value = state.date;
  $("#cn-genre").innerHTML = `<option value="">Tất cả thể loại</option>` + (META.genres ?? []).map((g) => `<option value="${esc(g.key)}">${esc(g.name)}</option>`).join("");
  $("#cn-genre").value = state.genre;
}

function render() {
  const seq = ++renderSeq;
  $("#view-china").dataset.cnView = state.view;
  document.querySelectorAll("#cn-tabs .subtab").forEach((t) => t.classList.toggle("active", t.dataset.cnTab === state.view));
  const main = $("#cn-main");
  if (!META?.sources?.length && state.view !== "news")
    return void (main.innerHTML = `<div class="cn-empty">Chưa có dữ liệu thị trường Trung Quốc.${STATIC ? "" : ` Bấm "Cập nhật Trung Quốc" để lấy lần đầu (khoảng 3–5 phút).`}</div>`);
  ({ aggregate: renderAggregate, newgames: renderNewGames, puzzle: renderPuzzle, gameplay: renderGameplay, bilibili: renderVideos, overview: renderOverview, chart: renderChart,
    tags: renderTags, news: renderNews, search: renderSearch })[state.view](main, seq)
    .catch((e) => { main.innerHTML = `<div class="cn-empty">Lỗi: ${esc(e.message)}</div>`; });
}

async function loadMeta() {
  gpCache.clear();
  META = await api("meta");
  if (!META?.sources) META = { sources: [], genres: [], puzzleKinds: [], dates: [], lookupLinks: [], freshDays: 30 };
  fillControls();
  setStatus({ lastRun: META.lastRun });
}

const STEP = { minigame: "mini game", ios: "App Store", taptap: "TapTap", tencent: "应用宝", xiaomi: "Xiaomi", developers: "nhà phát triển", news: "tin ngành", bilibili: "video Bilibili", puzzlevideos: "kho video puzzle", gameplay: "video gameplay", translate: "dịch", export: "xuất web" };
function setStatus(s) {
  const el = $("#cn-status"), btn = $("#cn-refresh");
  const when = s.lastRun ? new Date(s.lastRun.finished_at).toLocaleString("vi-VN") : null;
  if (STATIC) {
    btn.hidden = true;
    el.textContent = when ? `Dữ liệu Trung Quốc cập nhật ${when}` : "";
    return;
  }
  btn.disabled = !!s.running;
  el.title = "";
  if (s.elsewhere) el.textContent = "Đang cập nhật Trung Quốc ở tiến trình khác (quy trình 08:30 hoặc npm run china)…";
  else if (s.running) el.textContent = `Đang cập nhật Trung Quốc: ${STEP[s.step] ?? "…"} ${s.detail ?? ""}`;
  else if (when) {
    el.textContent = `Dữ liệu Trung Quốc cập nhật ${when}${s.lastRun.failed ? ` · ${s.lastRun.failed} lỗi` : ""}`;
    if (s.lastRun.failed) try { el.title = JSON.parse(s.lastRun.errors).map((e) => `${e.what}: ${e.error}`).join("\n"); } catch {}
  } else el.textContent = "Chưa cập nhật lần nào";
}
async function poll() {
  const s = await api("status");
  setStatus(s);
  if (s.running) setTimeout(poll, 3000);
  else { await loadMeta(); render(); }
}

function bind() {
  $("#cn-refresh").onclick = async () => {
    const r = await fetch("/api/china/refresh", { method: "POST" }).then((x) => x.json());
    if (!r.started) $("#cn-status").textContent = "Đang có một lần cập nhật Trung Quốc khác chạy, thử lại sau.";
    poll();
  };
  $("#cn-source").onchange = (e) => { state.source = e.target.value; localStorage.setItem("ct-source", state.source); state.board = null; fillControls(); render(); };
  $("#cn-board").onchange = (e) => { state.board = e.target.value; render(); };
  $("#cn-kind").onchange = (e) => { state.kind = e.target.value; render(); };
  $("#cn-date").onchange = (e) => { state.date = e.target.value; render(); };
  $("#cn-news-source").onchange = (e) => { state.newsSource = e.target.value; render(); };
  $("#cn-only-new").onchange = (e) => { state.onlyNew = e.target.checked; render(); };
  $("#cn-genre").onchange = (e) => { state.genre = e.target.value; render(); };
  $("#cn-newtype").onchange = (e) => { state.newType = e.target.value; render(); };
  $("#cn-newdays").onchange = (e) => { state.newDays = Number(e.target.value); render(); };
  $("#cn-ng-sort").onchange = (e) => { state.ngSort = e.target.value; render(); };
  $("#cn-pz-sort").onchange = (e) => { state.pzSort = e.target.value; render(); };
  $("#cn-vdays").onchange = (e) => { state.vDays = Number(e.target.value); render(); };
  $("#cn-vsort").onchange = (e) => { state.vSort = e.target.value; render(); };
  $("#cn-vfound").onchange = (e) => { state.vFound = e.target.value; render(); };
  $("#cn-vpuzzle").onchange = (e) => { state.vPuzzle = e.target.checked; render(); };
  $("#cn-vgenre").onchange = (e) => { state.vGenre = e.target.value; render(); };
  $("#cn-vcat").onchange = (e) => { state.vCat = e.target.value; render(); };
  $("#cn-vtype").onchange = (e) => { state.vType = e.target.value; render(); };
  $("#cn-gpgroup").onchange = (e) => { state.gpGroup = e.target.value; render(); };
  $("#cn-gpkind").onchange = (e) => { state.gpKind = e.target.value; render(); };
  $("#cn-gpsrc").onchange = (e) => { state.gpSrc = e.target.value; render(); };
  $("#cn-gpmode").onchange = (e) => { state.gpMode = e.target.value; state.gpKind = ""; render(); };
  $("#cn-gplist").onchange = (e) => { state.gpList = e.target.value; render(); };
  $("#cn-gpsort").onchange = (e) => { state.gpSort = e.target.value; render(); };
  let qTimer;
  $("#cn-q").oninput = (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; render(); }, 250); };

  $("#view-china").addEventListener("click", (e) => {
    // Tab Video gameplay: bấm video để xem; bấm nền tối hoặc nút Đóng để tắt
    const gp = e.target.closest("[data-cn-gp]");
    if (gp) return openPlayer(gp.dataset.cnGp);
    // Thẻ kiểu puzzle của kho video: bấm lần nữa để bỏ lọc
    const gpk = e.target.closest("[data-cn-gpk]");
    if (gpk) { state.gpKind = state.gpKind === gpk.dataset.cnGpk ? "" : gpk.dataset.cnGpk; return render(); }
    const player = $("#cn-player");
    if (player && (e.target === player || e.target.closest("[data-cn-close-player]"))) return player.close();
    const dlg = $("#cn-detail");
    if (e.target.closest("[data-cn-close]") || e.target === dlg) return dlg.close();
    const pcard = e.target.closest("[data-cn-pkind]");
    if (pcard) { state.puzzleKind = state.puzzleKind === pcard.dataset.cnPkind ? "" : pcard.dataset.cnPkind; return render(); }
    // "Xem cả bảng" ở Tổng quan: chọn bảng rồi để link #/china/chart chuyển tab
    const boardLink = e.target.closest("a[data-cn-board]");
    if (boardLink) { state.board = boardLink.dataset.cnBoard; state.date = ""; fillControls(); return; }
    const g = e.target.closest("[data-cn-app]");
    if (g) { e.preventDefault(); openDetail(g.dataset.cnSource, g.dataset.cnApp); }
  });
}

// Gọi từ route() của app.js với tab phụ trong đường dẫn #/china/<tab>
export async function showChina(sub) {
  state.view = VIEWS.includes(sub) ? sub : "aggregate";
  if (!ready) {
    bind();
    ready = loadMeta().then(() => { if (!STATIC) api("status").then((s) => s.running && poll()); });
  }
  await ready;
  if ($("#cn-detail").open) $("#cn-detail").close();
  if ($("#cn-player")?.open) $("#cn-player").close();
  render();
}
