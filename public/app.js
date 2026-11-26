// ================= tiện ích chung =================
import { staticApi } from "./static-api.js";
import { puzzleKind, matchPuzzle, countKinds, setPuzzleIds, puzzleKindName } from "./puzzle.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https:\/\//.test(u ?? "") ? esc(u) : "");
// Bỏ dấu để lọc ("lien quan" ~ "Liên Quân")
const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

// Bản tĩnh trên GitHub Pages (lib/export.mjs chèn cờ này): đọc file JSON thay cho server
const STATIC = !!window.STATIC_SITE;
if (STATIC) document.documentElement.classList.add("static");
const api = (path, opts) => (STATIC ? staticApi(path, opts) : fetch(path, opts).then((r) => r.json()));
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

// Icon: bản tĩnh dùng file chép kèm; bản local đi qua proxy server (tránh bị Google chặn 429)
const iconSrc = (u) => (/^icons\//.test(u ?? "") ? u : /^https:\/\//.test(u ?? "") ? `/icon?u=${encodeURIComponent(u)}` : "");
const iconImg = (a, cls = "icon") =>
  `<img class="${cls}" src="${iconSrc(a.icon)}" alt="" loading="lazy" data-letter="${esc((a.title ?? "?").trim().charAt(0).toUpperCase())}">`;

// Ảnh lỗi: thay bằng ô chữ cái đầu
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.letter) return;
  const tile = document.createElement("span");
  tile.className = img.className + " icon-fallback";
  tile.textContent = img.dataset.letter;
  img.replaceWith(tile);
}, true);

const fmtDate = (d) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "");
const relTime = (iso) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days <= 0) return "hôm nay";
  if (days === 1) return "hôm qua";
  if (days < 30) return `${days} ngày trước`;
  return d.toLocaleDateString("vi-VN");
};
const gameHref = (store, appId) => `#/game/${store}/${encodeURIComponent(appId)}`;
const pubHref = (store, devId) => `#/publisher/${store}/${encodeURIComponent(devId)}`;
const storeBadge = (s) => `<span class="sbadge ${s}">${s === "gplay" ? "Google Play" : "App Store"}</span>`;

let meta = null;
let view = "overview";
let chartData = null;

// ---------- lưu lựa chọn ----------
const PREF_KEY = "chart-tracker-prefs";
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) ?? {}; } catch { return {}; } })();
function savePrefs() {
  for (const id of ["country", "compare", "store", "category", "collection"]) prefs[id] = $("#" + id).value;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
}

// ---------- lọc game puzzle (thanh #genre-bar, dùng chung mọi tab danh sách game) ----------
// genre: "" = mọi game, "puzzle" = mọi puzzle, còn lại = một kiểu trong PUZZLE_KINDS (public/puzzle.js)
let genre = prefs.genre ?? "";
const pzTag = (kind) => (kind ? `<span class="tag pz" title="Kiểu puzzle (đoán theo tên game)">${esc(puzzleKindName(kind))}</span>` : "");

// Lọc danh sách theo lựa chọn puzzle; toKey(item) -> { title, store, appId, hint }.
// Đồng thời vẽ thanh lọc với số game của từng kiểu trong danh sách (trước khi lọc puzzle).
// unique(item): khoá gộp khi một game xuất hiện nhiều lần (vd nhiều bảng), để đếm theo game chứ không theo dòng
function puzzleFilter(items, toKey, unique) {
  const seen = new Map();
  const tagged = items.map((it) => {
    const kind = puzzleKind(toKey(it));
    if (unique) seen.set(unique(it), kind);
    return { it, kind };
  });
  const kinds = unique ? [...seen.values()] : tagged.map((t) => t.kind);
  renderGenreBar(kinds);
  return tagged.filter((t) => matchPuzzle(genre, t.kind));
}

function renderGenreBar(kinds) {
  const total = kinds.length, nPuzzle = kinds.filter(Boolean).length;
  const list = countKinds(kinds);
  // Kiểu đang chọn mà danh sách này không có: vẫn hiện (số 0) để bỏ chọn được
  if (genre && genre !== "puzzle" && !list.some((k) => k.key === genre)) list.push({ key: genre, name: puzzleKindName(genre), n: 0 });
  const chip = (key, name, n) =>
    `<button class="genre-chip${genre === key ? " on" : ""}${n ? "" : " zero"}" data-genre="${esc(key)}">${esc(name)}<span class="n">${n}</span></button>`;
  $("#genre-bar").innerHTML = `<span class="gb-label">Puzzle</span>`
    + chip("", "Mọi game", total) + chip("puzzle", "Tất cả puzzle", nPuzzle)
    + list.map((k) => chip(k.key, k.name, k.n)).join("")
    + `<span class="gb-hint" title="Puzzle = từng vào bảng Puzzle của store trong 30 ngày, hoặc tên/thể loại có từ khoá puzzle. Kiểu game đoán theo từ khoá trong tên.">Kiểu game đoán theo tên ⓘ</span>`;
}

function setGenre(g) {
  genre = g;
  prefs.genre = g;
  savePrefs();
  if (view === "chart") renderChart();
  else if (view === "newgames") renderNewGames();
  else if (view === "playables") renderPlayables();
  else route();
}

const nameOf = (list, key, field = "key") => list.find((x) => x[field] === key)?.name ?? key;
const comboLabel = (c) => `${nameOf(meta.countries, c.country, "code")} · ${nameOf(meta.categories, c.category)} · ${nameOf(meta.collections, c.collection)}`;

function fillSelect(el, items, valueKey, saved) {
  el.innerHTML = items.map((x) => `<option value="${esc(x[valueKey])}">${esc(x.name)}</option>`).join("");
  if (saved && items.some((x) => x[valueKey] === saved)) el.value = saved;
}

// App Store không có mục Casual: ẩn thể loại không hỗ trợ theo store đang chọn
function refreshCategoryOptions() {
  const store = $("#store").value;
  const cur = $("#category").value;
  fillSelect($("#category"), meta.categories.filter((c) => c[store]), "key", cur || prefs.category);
}

function setNotice(text) {
  $("#notice").hidden = !text;
  $("#notice").textContent = text ?? "";
}

// ---------- khối hiển thị dùng chung ----------
function deltaBadge(r) {
  if (r.isNew) return `<span class="badge new">MỚI</span>`;
  if (r.delta == null) return `<span class="badge same">–</span>`;
  if (r.delta > 0) return `<span class="badge up">▲ ${r.delta}</span>`;
  if (r.delta < 0) return `<span class="badge down">▼ ${-r.delta}</span>`;
  return `<span class="badge same">0</span>`;
}

function sparkline(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return `<span class="muted">–</span>`;
  const w = 90, h = 26, n = values.length - 1 || 1;
  const max = Math.max(...pts.map(([, v]) => v)), min = Math.min(...pts.map(([, v]) => v));
  const span = Math.max(max - min, 1);
  const xy = pts.map(([i, v]) => [(i / n) * (w - 4) + 2, ((v - min) / span) * (h - 6) + 3]);
  const last = xy[xy.length - 1];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${xy.map((p) => p.join(",")).join(" ")}"/><circle cx="${last[0]}" cy="${last[1]}" r="2.4"/></svg>`;
}

function appCell(a) {
  return `${iconImg(a)}
    <div class="meta"><div class="title">${esc(a.title)}</div><div class="dev">${esc(a.developer)}</div>`;
}

// Một dòng game trong danh sách (Tổng quan, Tóm tắt)
function listItem(it, extra = "", kind = null) {
  const move = it.prevRank ? `#${it.prevRank} → #${it.rank}` : `#${it.rank}`;
  return `<li><a class="row-link" href="${gameHref(it.store, it.appId)}">
    ${appCell(it)}
      <div class="tags">${pzTag(kind)}${extra || `<span class="tag">${esc(it.storeName)} · ${esc(it.categoryName)} · ${esc(it.collectionName)}</span>`}</div>
    </div>
    <div class="right">${it.prevRank ? deltaBadge(it) : `<span class="badge new">MỚI</span>`}<div class="rankmove">${move}</div></div>
  </a></li>`;
}
const emptyLi = (t) => `<li class="empty">${esc(t)}</li>`;
const multiTags = (m) => m.hits.map((h) =>
  `<span class="tag">${esc(h.storeName)} · ${esc(h.categoryName)} · ${esc(h.collectionName)} ${h.prevRank ? `▲${h.delta}` : "mới"}</span>`).join("");

// ================= Tổng quan =================
let ovCache = null;
async function loadOverview() {
  const country = $("#country").value, compare = $("#compare").value;
  // Giữ bản vừa tải: đổi lựa chọn puzzle chỉ lọc lại, không gọi lại API (lần đầu có thể mất vài giây)
  const key = `${country}-${compare}`;
  if (ovCache?.key !== key) ovCache = { key, ov: await api(`/api/overview?country=${country}&compare=${compare}`) };
  const ov = ovCache.ov;
  const noCompare = ov.compared === 0;
  const msg = !ov.latest ? "Chưa có dữ liệu." : noCompare ? "Cần ít nhất 2 ngày dữ liệu để so sánh." : "Không có.";
  setNotice(ov.latest && noCompare
    ? `Mới có dữ liệu ngày ${fmtDate(ov.latest)}. Mục tăng hạng và game mới sẽ xuất hiện từ lần cập nhật ngày tiếp theo.`
    : null);
  const lists = rankLists(ov);
  const none = genre ? "Không có game thuộc kiểu puzzle đang chọn." : msg;
  const fill = (el, rows, max, withMulti) => {
    $(el).innerHTML = rows.length ? rows.slice(0, max).map(({ it, kind }) => listItem(it, withMulti ? multiTags(it) : "", kind)).join("")
      : emptyLi(ov.latest && !noCompare ? none : msg);
  };
  fill("#ov-multi", lists.multi, 30, true);
  fill("#ov-climbers", lists.climbers, 40);
  fill("#ov-new", lists.newcomers, 40);
}

// Lọc puzzle cho bộ ba danh sách (Tổng quan, mỗi quốc gia trong Tóm tắt); thanh lọc đếm theo game, không theo dòng
const rankKey = (x) => ({ title: x.title, store: x.store, appId: x.appId, hint: x.category === "puzzle" ? "puzzle" : "" });
function rankLists(src, extraUnique = []) {
  const all = [...src.multi.map((x) => ["multi", x]), ...src.climbers.map((x) => ["climbers", x]), ...src.newcomers.map((x) => ["newcomers", x]), ...extraUnique];
  const kept = puzzleFilter(all, ([, x]) => rankKey(x), ([, x]) => `${x.store}:${x.appId}`);
  const out = { multi: [], climbers: [], newcomers: [], extra: [] };
  for (const { it: [list, x], kind } of kept) out[list in out ? list : "extra"].push({ it: x, kind });
  return out;
}

// ================= Bảng xếp hạng =================
function comboQuery() {
  return ["store", "country", "category", "collection"].map((k) => `${k}=${encodeURIComponent($("#" + k).value)}`).join("&");
}

async function loadChart(keepDate = false) {
  const date = keepDate ? $("#date").value : "";
  chartData = await api(`/api/chart?${comboQuery()}&compare=${$("#compare").value}${date ? `&date=${date}` : ""}`);
  $("#date").innerHTML = chartData.dates.map((d) => `<option value="${d}">${fmtDate(d)}</option>`).join("");
  if (chartData.date) $("#date").value = chartData.date;
  if (!chartData.date) setNotice("Bảng này chưa có dữ liệu.");
  else if (!chartData.compareDate) setNotice(`Dữ liệu ngày ${fmtDate(chartData.date)}. Chưa có ngày trước đó để so sánh thay đổi thứ hạng.`);
  else setNotice(`So sánh ${fmtDate(chartData.date)} với ${fmtDate(chartData.compareDate)}.`);
  renderChart();
}

function renderChart() {
  if (!chartData) return;
  const q = norm($("#search").value.trim());
  const mv = $("#movement").value;
  const store = $("#store").value;
  const cat = $("#category").value;
  const rows = puzzleFilter(chartData.rows.filter((r) => {
    if (q && !norm(`${r.title} ${r.developer}`).includes(q)) return false;
    if (mv === "up") return r.delta > 0;
    if (mv === "down") return r.delta < 0;
    if (mv === "new") return r.isNew;
    return true;
  }), (r) => ({ title: r.title, store, appId: r.appId, hint: cat === "puzzle" ? "puzzle" : "" }));
  $("#chart-body").innerHTML = rows.length ? rows.map(({ it: r, kind }) => `
    <tr data-href="${gameHref(store, r.appId)}">
      <td class="num rank">${r.rank}</td>
      <td class="num">${deltaBadge(r)}</td>
      <td><a class="game" href="${gameHref(store, r.appId)}">${appCell(r)}${kind ? `<div class="tags">${pzTag(kind)}</div>` : ""}</div></a></td>
      <td class="hide-sm">${sparkline(r.spark)}</td>
      <td class="num hide-sm">${r.score != null ? r.score.toFixed(1) : `<span class="muted">–</span>`}</td>
      <td class="hide-sm muted">${fmtDate(r.firstSeen)}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="muted center">Không có game phù hợp.</td></tr>`;

  $("#dropped-count").textContent = chartData.dropped.length;
  $("#dropped").innerHTML = chartData.dropped.length
    ? chartData.dropped.map((d) => `<li><a class="row-link" href="${gameHref(store, d.appId)}">${appCell(d)}</div><span class="rankmove">trước đó #${d.prevRank}</span></a></li>`).join("")
    : emptyLi("Không có.");
}

// ================= Tin ngành =================
let newsLoaded = false;
let newsPollTimer = null;

function gameChips(games) {
  return games.length ? `<div class="chips">${games.map((g) => `
    <a class="chip${g.climbing ? " climbing" : ""}" title="${esc(g.title)} · ${esc(g.label)}" href="${gameHref(g.store, g.appId)}">
      ${iconImg(g)} ${esc(g.name)} <span class="muted">#${g.rank}</span>${g.climbing ? ` <span class="up">▲ đang lên</span>` : ""}
    </a>`).join("")}</div>` : "";
}

function newsCard(n, withSummary = true) {
  return `<article class="news">
    <div class="news-top">
      <span class="news-src">${esc(n.sourceName)}</span>
      <span>${relTime(n.published)}</span>
      ${n.isData ? `<span class="flag data">Số liệu</span>` : ""}
    </div>
    <h3><a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a></h3>
    ${withSummary && n.summary ? `<p>${esc(n.summary.length > 260 ? n.summary.slice(0, 260) + "…" : n.summary)}</p>` : ""}
    ${gameChips(n.games)}
  </article>`;
}

async function loadNews() {
  const params = new URLSearchParams({
    source: $("#news-source").value,
    days: $("#news-days").value,
    onlyData: $("#news-data").checked ? "1" : "0",
    onlyMatched: $("#news-matched").checked ? "1" : "0",
    q: $("#news-q").value.trim(),
  });
  const data = await api(`/api/news?${params}`);
  if (!newsLoaded) {
    const cur = $("#news-source").value;
    $("#news-source").innerHTML = `<option value="">Tất cả nguồn</option>` +
      data.sources.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join("");
    $("#news-source").value = cur;
    newsLoaded = true;
  }
  setNotice(null);
  const st = data.status;
  const errs = st.errors?.length ? ` · ${st.errors.length} nguồn lỗi (${st.errors.map((e) => esc(e.source)).join(", ")})` : "";
  const matched = data.items.filter((i) => i.games.length).length;
  $("#news-meta").innerHTML = st.running
    ? "Đang lấy tin…"
    : `${data.items.length} bài · ${matched} bài nhắc game trong chart · cập nhật ${st.lastFetch ? fmtDateTime(st.lastFetch) : "chưa"}${errs}`;
  $("#news-refresh").disabled = st.running;
  $("#news-list").innerHTML = data.items.length ? data.items.map((n) => newsCard(n)).join("")
    : `<div class="panel muted center">Không có bài phù hợp.</div>`;
  clearTimeout(newsPollTimer);
  if (st.running) newsPollTimer = setTimeout(() => view === "news" && loadNews(), 2000);
}

// ================= Quảng cáo =================
let adsPollTimer = null;
let adsPendingGame = null;
const FORMAT_NAME = { VIDEO: "Video", IMAGE: "Ảnh", CAROUSEL: "Carousel", DCO: "Động (DCO)", DPA: "Catalog (DPA)",
  TEXT: "Chữ", ICON: "Icon", SCREENSHOT: "Icon + ảnh" };
const PLATFORM_NAME = { FACEBOOK: "FB", INSTAGRAM: "IG", AUDIENCE_NETWORK: "AN", MESSENGER: "MSG", THREADS: "TH",
  APPSTORE_SEARCH_RESULTS: "Kết quả tìm", APPSTORE_TODAY_TAB: "Today", APPSTORE_SEARCH_TAB: "Tab tìm", GOOGLE: "Google" };
const SOURCE_NAME = { meta: "Meta", apple: "App Store", google: "Google" };
// Ý nghĩa "bản nhân" và tên thư viện theo nguồn
const VARIANT_LABEL = { meta: "bản nhân", apple: "nước EU", google: "QC cùng video" };
const LIBRARY_NAME = { meta: "Ad Library", apple: "Apple Ads", google: "Google Ads" };
const isYoutube = (u) => /^https:\/\/www\.youtube\.com\//.test(u ?? "");

function adCard(a, i) {
  const p = a.parts;
  const src = a.source ?? "meta";
  const why = `Điểm ${a.score}/100${a.active ? "" : " (đã dừng, bị trừ điểm)"}\nSố ngày chạy: ${a.days} (${Math.round(p.days * 100)}%)\nThứ tự hiển thị: ${a.imprRank ? `#${a.imprRank}/${a.imprTotal}` : "không có, tính mức giữa"} (${Math.round(p.impressions * 100)}%)\nSố ${VARIANT_LABEL[src]}: ${a.variants} (${Math.round(p.variants * 100)}%)\nNền tảng/vị trí: ${a.platforms.length} (${Math.round(p.platforms * 100)}%)`;
  const media = a.thumb
    ? `<img src="${safeUrl(a.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="noimg">Không có ảnh xem trước</span>`;
  // Video YouTube (Google) không phát trực tiếp được trong thẻ: mở tab mới
  const playable = a.video && !isYoutube(a.video);
  const open = a.video && isYoutube(a.video) ? a.video : a.libraryUrl;
  return `<article class="ad-card${a.active ? "" : " stopped"}">
    <button class="ad-media" ${playable ? `data-video="${safeUrl(a.video)}"` : `data-open="${esc(open)}"`} title="${playable ? "Bấm để phát video" : a.video ? "Mở video trên YouTube" : `Mở trên ${LIBRARY_NAME[src]}`}">
      ${media}
      <span class="ad-rank">#${i + 1}</span>
      <span class="ad-src ${esc(src)}">${esc(SOURCE_NAME[src] ?? src)}</span>
      <span class="ad-score" title="${esc(why)}">${a.score}</span>
      ${a.video ? `<span class="play">▶ video${playable ? "" : " ↗"}</span>` : ""}
    </button>
    <div class="ad-body">
      <div class="ad-game">${iconImg({ icon: a.icon, title: a.gameName })}<a href="${gameHref(a.store, a.appId)}">${esc(a.gameName)}</a></div>
      <div class="ad-title" title="${esc(a.body ?? "")}">${esc(a.title || a.body || a.page || "")}</div>
      <div class="ad-nums">
        <div><strong>${a.days}</strong><span>ngày chạy</span></div>
        <div><strong>${a.imprRank ? `#${a.imprRank}` : "–"}</strong><span>${a.imprRank ? `hiển thị /${a.imprTotal}` : "thứ tự hiển thị"}</span></div>
        <div><strong>${a.variants}</strong><span>${VARIANT_LABEL[src]}</span></div>
      </div>
      <div class="ad-foot">
        ${a.isNew ? `<span class="badge new">MỚI</span>` : ""}
        ${a.active ? "" : `<span class="tag down" title="Lần hiển thị cuối ${fmtDate(a.endDate)}">đã dừng</span>`}
        <span class="tag">${esc(FORMAT_NAME[a.format] ?? a.format ?? "?")}</span>
        <span class="tag" title="${esc(a.platforms.join(", "))}">${a.platforms.map((x) => PLATFORM_NAME[x] ?? x).join(" ")}</span>
        <span class="tag">từ ${fmtDate(a.startDate)}</span>
        <a class="tag link" href="${esc(a.libraryUrl)}" target="_blank" rel="noopener">${LIBRARY_NAME[src]} ↗</a>
      </div>
    </div>
  </article>`;
}

async function loadAds() {
  if (adsPendingGame) {
    if (![...$("#ads-game").options].some((o) => o.value === adsPendingGame))
      $("#ads-game").add(new Option(adsPendingGame, adsPendingGame));
    $("#ads-game").value = adsPendingGame;
    adsPendingGame = null;
  }
  const params = new URLSearchParams({
    sort: $("#ads-sort").value, game: $("#ads-game").value, format: $("#ads-format").value, source: $("#ads-source").value,
    minDays: $("#ads-min-days").value, onlyNew: $("#ads-new").checked ? "1" : "0",
    onlyActive: $("#ads-active").checked ? "1" : "0", q: $("#ads-q").value.trim(),
  });
  const d = await api(`/api/ads?${params}`);
  setNotice(null);
  const curGame = $("#ads-game").value, curFormat = $("#ads-format").value, curSource = $("#ads-source").value;
  $("#ads-source").innerHTML = `<option value="">Tất cả nguồn</option>` + Object.entries(d.sources ?? SOURCE_NAME)
    .map(([k, n]) => `<option value="${esc(k)}">${esc(n)}${d.sourceCounts?.[k] != null ? ` (${d.sourceCounts[k]})` : ""}</option>`).join("");
  $("#ads-source").value = curSource;
  $("#ads-game").innerHTML = `<option value="">Tất cả game (${d.games.length})</option>` +
    d.games.map((g) => `<option value="${esc(g.key)}">${esc(g.name)}${g.adCount != null ? ` (${g.adCount})` : ""}${g.lastError ? " ⚠" : ""}</option>`).join("");
  $("#ads-game").value = curGame;
  $("#ads-format").innerHTML = `<option value="">Tất cả</option>` +
    d.formats.map((f) => `<option value="${esc(f)}">${esc(FORMAT_NAME[f] ?? f)}</option>`).join("");
  $("#ads-format").value = curFormat;

  const st = d.status, w = d.weights;
  const errs = st.errors?.length ? ` · ${st.errors.length} game lỗi (${st.errors.map((e) => esc(e.game)).join(", ")})` : "";
  const last = d.games.map((g) => g.lastScan).filter(Boolean).sort().pop();
  $("#ads-meta").innerHTML = (st.running
    ? `Đang quét ${st.done}/${st.total}${st.current ? `: ${esc(st.current)}` : ""}… `
    : `${d.total} quảng cáo · ${d.games.length} game · quét lần cuối ${last ? fmtDate(last) : "chưa"}${errs}. `)
    + `Một kho chung từ Meta Ad Library, App Store (Apple Ad Repository, chỉ các nước EU, chậm 7 ngày) và Google Ads Transparency, xếp theo cùng một điểm: `
    + `${Math.round(w.days * 100)}% số ngày chạy + ${Math.round(w.impressions * 100)}% thứ tự hiển thị nguồn trả về + ${Math.round(w.variants * 100)}% số bản nhân (App Store: số nước; Google: số QC dùng cùng video) + ${Math.round(w.platforms * 100)}% số nền tảng; `
    + `quảng cáo đã dừng nhân ${d.stoppedFactor ?? 0.7}. Không nguồn nào công khai lượt xem nên số ngày chạy là chỉ số chính (di chuột lên điểm để xem chi tiết). Playable AppLovin/Unity cần công cụ trả phí.`;
  $("#ads-refresh").disabled = st.running;
  // Thanh puzzle đếm theo game (nhiều quảng cáo cùng một game chỉ tính một lần)
  const adItems = puzzleFilter(d.items, (a) => ({ title: a.gameName, store: a.store, appId: a.appId }), (a) => `${a.store}:${a.appId}`).map((t) => t.it);
  if (genre && adItems.length !== d.items.length) $("#ads-meta").insertAdjacentHTML("afterbegin", `<strong>${adItems.length}/${d.items.length} quảng cáo thuộc kiểu puzzle đang chọn.</strong> `);
  $("#ads-list").innerHTML = adItems.length ? adItems.map(adCard).join("")
    : `<div class="panel muted center">${d.items.length ? "Không có quảng cáo của game thuộc kiểu puzzle đang chọn." : d.games.length ? "Không có quảng cáo phù hợp." : `Chưa quét quảng cáo. Bấm "Quét lại" (khoảng 30 giây mỗi game) hoặc chờ quy trình hằng ngày.`}</div>`;
  clearTimeout(adsPollTimer);
  if (st.running) adsPollTimer = setTimeout(() => view === "ads" && loadAds(), 4000);
}

// Mục quảng cáo trong trang chi tiết game
async function loadGameAds(app) {
  const el = $("#game-ads");
  if (!el) return;
  const d = await api(`/api/ads/game?store=${app.store}&appId=${encodeURIComponent(app.appId)}`);
  const g = d.games?.find((x) => x.key === d.key);
  const scanning = d.status?.running;
  const head = g?.lastScan
    ? `${d.total} quảng cáo (${Object.entries(d.sourceCounts ?? {}).map(([k, n]) => `${SOURCE_NAME[k] ?? k} ${n}`).join(", ") || "không có"}) · quét ${fmtDate(g.lastScan)}${g.lastError ? ` · <span class="down">lỗi: ${esc(g.lastError)}</span>` : ""}`
    : "Chưa quét quảng cáo của game này.";
  el.innerHTML = `
    <div class="panel-head"><h2>Quảng cáo hiệu quả nhất</h2>
      <div class="actions">
        ${g?.lastScan ? `<a class="btn" href="#/ads" data-ads-game="${esc(d.key)}">Xem tất cả</a>` : ""}
        <button class="btn" data-action="scan-ads" data-store="${esc(app.store)}" data-app="${esc(app.appId)}"${scanning ? " disabled" : ""}>
          ${scanning ? `Đang quét ${esc(d.status.current ?? "")}…` : g?.lastScan ? "Quét lại" : "Quét quảng cáo"}</button>
      </div></div>
    <p class="hint">${head}${g?.manual ? " · đã thêm vào danh sách quét hằng ngày" : ""}</p>
    ${d.items.length ? `<div class="ad-grid">${d.items.map(adCard).join("")}</div>` : ""}`;
  if (scanning) setTimeout(() => view === "game" && game?.data.app.appId === app.appId && loadGameAds(app), 4000);
}

// ================= Game mới =================
let ngData = null;
let ngTrend = null;
let ngTab = "all";   // tab phụ: "all" | "puzzle" (#/newgames/puzzle)
let ngKind = "";     // kiểu puzzle đang chọn trong tab phụ Puzzle
const NG_SELECTS = ["ng-store", "ng-days", "ng-sort", "ng-genre", "ng-size", "ng-momentum", "ng-score", "ng-found", "ng-term"];
const NG_CHECKS = ["ng-noclone", "ng-nochart", "ng-rising", "ng-followed"];
// Quy mô tối thiểu: [lượt cài Android, số đánh giá iOS]
const NG_SIZE = { 1: [1e3, 10], 2: [1e4, 100], 3: [1e5, 1000], 4: [1e6, 10000] };
const GENRE_ALIAS = { Roleplaying: "Role Playing", "Role-Playing": "Role Playing" };
const ngGenres = (i) => [...new Set(String(i.genre ?? "").split(",").map((g) => g.trim()).filter((g) => g && g !== "Games" && g !== "Entertainment").map((g) => GENRE_ALIAS[g] ?? g))];
// Thể loại store + từ khoá đã tìm ra game (vd "sort puzzle") giúp nhận puzzle
const ngKindOf = (i) => puzzleKind({ title: i.title, store: i.store, appId: i.appId, hint: `${i.genre ?? ""} ${i.foundBy ?? ""}` });
const ngSize = (i) => (i.store === "gplay" ? i.minInstalls ?? 0 : (i.ratings ?? 0) * 100);
const ngGain = (i) => (i.store === "gplay" ? i.installsGain ?? 0 : (i.ratingsGain ?? 0) * 100);

function saveNgPrefs() {
  prefs.ng = {};
  for (const id of NG_SELECTS) prefs.ng[id] = $("#" + id).value;
  for (const id of NG_CHECKS) prefs.ng[id] = $("#" + id).checked;
  prefs.ngKind = ngKind;
  savePrefs();
}

// Danh sách thể loại và từ khoá (kèm số game) cho hai ô chọn
function fillNgOptions() {
  const count = (keysOf) => {
    const m = new Map();
    for (const i of ngData.items) for (const k of keysOf(i)) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const fill = (id, all, list) => {
    const cur = $("#" + id).value || prefs.ng?.[id] || "";
    $("#" + id).innerHTML = `<option value="">${all}</option>` + list.map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join("");
    if (list.some(([k]) => k === cur)) $("#" + id).value = cur;
  };
  fill("ng-genre", "Tất cả thể loại", count(ngGenres));
  fill("ng-term", "Tất cả từ khoá", count((i) => (i.foundBy ? [i.foundBy] : [])));
}

async function loadNewGames(force = false) {
  if (!ngData || force) { ngData = await api("/api/newgames"); fillNgOptions(); }
  setNotice(null);
  renderNewGames();
  const st = ngData.status;
  $("#ng-refresh").disabled = !!st.running;
  if (st.running) setTimeout(() => view === "newgames" && loadNewGames(true), 5000);
}

function renderNewGames() {
  if (!ngData) return;
  const v = (id) => $("#" + id).value, on = (id) => $("#" + id).checked;
  const store = v("ng-store"), days = Number(v("ng-days")), needle = norm(v("ng-q").trim());
  const genreSel = v("ng-genre"), term = v("ng-term"), minSize = NG_SIZE[v("ng-size")], minMom = Number(v("ng-momentum")) || 0;
  const minScore = Number(v("ng-score")) || 0, foundDays = Number(v("ng-found")) || 0;
  const foundSince = foundDays ? new Date(Date.now() - (foundDays - 1) * 864e5).toLocaleDateString("sv-SE") : "";
  // Mọi bộ lọc trừ kiểu puzzle (các thẻ kiểu puzzle đếm trên tập này)
  const base = ngData.items.filter((i) => (!store || i.store === store) && i.age <= days
    && (!on("ng-noclone") || !i.cluster) && (!on("ng-nochart") || !i.chart)
    && (!on("ng-rising") || ngGain(i) > 0) && (!on("ng-followed") || i.followed)
    && (!genreSel || ngGenres(i).includes(genreSel)) && (!term || i.foundBy === term)
    && (!minSize || (i.store === "gplay" ? (i.minInstalls ?? 0) >= minSize[0] : (i.ratings ?? 0) >= minSize[1]))
    && i.momentum >= minMom && (!minScore || (i.score ?? 0) >= minScore)
    && (!foundSince || (i.firstSeen ?? "") >= foundSince)
    && (!ngTrend || norm(i.title).replace(/[^\p{L}\p{N}]+/gu, " ").includes(ngTrend))
    && (!needle || norm(`${i.title} ${i.developer} ${i.genre}`).includes(needle)));
  const kindOf = new Map(base.map((i) => [i, ngKindOf(i)]));
  const puzzles = base.filter((i) => kindOf.get(i));
  let items = ngTab === "puzzle" ? puzzles.filter((i) => !ngKind || kindOf.get(i) === ngKind) : base;
  const sorters = {
    momentum: (a, b) => b.momentum - a.momentum || ngSize(b) - ngSize(a),
    gain: (a, b) => ngGain(b) - ngGain(a) || b.momentum - a.momentum,
    size: (a, b) => ngSize(b) - ngSize(a),
    score: (a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.ratings ?? 0) - (a.ratings ?? 0),
    released: (a, b) => b.released.localeCompare(a.released) || b.momentum - a.momentum,
    found: (a, b) => b.firstSeen.localeCompare(a.firstSeen) || b.released.localeCompare(a.released),
  };
  items = [...items].sort(sorters[v("ng-sort")] ?? sorters.momentum);

  // Tab phụ
  $("#ng-tabs").innerHTML = [["all", "#/newgames", "Tất cả game", base.length], ["puzzle", "#/newgames/puzzle", "Puzzle", puzzles.length]]
    .map(([k, href, name, n]) => `<a class="subtab${ngTab === k ? " active" : ""}" href="${href}">${name} <span class="n">${n}</span></a>`).join("");

  // Tab phụ Puzzle: một thẻ cho mỗi kiểu puzzle (số game, game ra 7 ngày qua, số studio, game dẫn đầu). Bấm để lọc.
  const pzEl = $("#ng-puzzle");
  pzEl.hidden = ngTab !== "puzzle";
  if (ngTab === "puzzle") {
    const card = (key, name, list) => {
      const top = [...list].sort(sorters.momentum)[0];
      const fresh = list.filter((i) => i.age <= 7).length, devs = new Set(list.map((i) => i.developer)).size;
      const rising = list.filter((i) => ngGain(i) > 0).length;
      return `<button class="pz-card${ngKind === key ? " on" : ""}${list.length ? "" : " zero"}" data-ng-kind="${esc(key)}">
        <span class="pz-name">${esc(name)}</span><span class="pz-n">${list.length}</span>
        <span class="pz-sub">${fresh ? `<b class="up">${fresh} mới 7 ngày</b> · ` : ""}${devs} studio${rising ? ` · ${rising} đang tăng` : ""}</span>
        <span class="pz-top">${top ? `Dẫn đầu: ${esc(top.title)}` : "Chưa có game"}</span></button>`;
    };
    const kinds = countKinds(puzzles.map((i) => kindOf.get(i))).sort((a, b) => b.n - a.n);
    if (ngKind && !kinds.some((k) => k.key === ngKind)) kinds.push({ key: ngKind, name: puzzleKindName(ngKind) });
    pzEl.innerHTML = `<div class="panel-head"><h2>Game puzzle mới theo kiểu</h2></div>
      <p class="hint">Đếm theo các bộ lọc đang chọn ở trên (store, số ngày, quy mô…). Kiểu game đoán theo từ khoá trong tên; bấm một thẻ để chỉ xem kiểu đó, bấm lại để bỏ.</p>
      <div class="pz-grid">${card("", "Tất cả puzzle", puzzles)}${kinds.map((k) => card(k.key, k.name, puzzles.filter((i) => kindOf.get(i) === k.key))).join("")}</div>`;
  }

  const st = ngData.status;
  const n = (s) => ngData.items.filter((i) => i.store === s).length;
  const errs = st.errors?.length ? ` · ${st.errors.length} lỗi` : "";
  $("#ng-meta").innerHTML = (st.running ? `Đang quét ${st.done}/${st.total} từ khoá (${esc(st.step ?? "")})… ` : "")
    + `<strong>${items.length} game</strong>${ngTab === "puzzle" ? ` puzzle${ngKind ? ` kiểu ${esc(puzzleKindName(ngKind))}` : ""}` : ""} · tổng ${n("gplay")} Google Play + ${n("ios")} App Store phát hành trong ${ngData.days} ngày · quét ${st.lastFetch ? fmtDate(st.lastFetch) : "chưa"}${errs}. `
    + `Quét riêng từng store theo ${ngData.terms} từ khoá thể loại (Mỹ); Google Play lan thêm theo "game tương tự". `
    + `Đà tăng = phân vị tốc độ trong cùng store (Android: lượt cài/ngày theo mốc của Google; iOS: đánh giá/ngày). Không phải toàn bộ game mới trên store.`;

  const tr = ngData.trends ?? [];
  $("#ng-trends").hidden = !tr.length;
  $("#ng-trends").innerHTML = `<h2>Kiểu game đang bị clone</h2>
    <p class="hint">Tên game có từ 3 studio cùng ra trong ${ngData.days} ngày. Bấm để lọc.</p>
    <div class="ng-trends">${tr.map((t) => `<button class="ng-trend${ngTrend === t.key ? " on" : ""}" data-trend="${esc(t.key)}">
      ${esc(t.name)} · ${t.devs} studio <span class="muted">(${[t.gplay ? `Android ${t.gplay}` : "", t.ios ? `iOS ${t.ios}` : ""].filter(Boolean).join(", ")})</span></button>`).join("")}</div>`;

  $("#ng-body").innerHTML = items.length ? items.slice(0, 500).map((i) => {
    const href = i.chart ? gameHref(i.store, i.appId) : safeUrl(i.url);
    const ext = i.chart ? "" : ` target="_blank" rel="noopener"`;
    const sizeTxt = i.store === "gplay"
      ? `${esc(i.installs ?? "–")}${i.ratings ? `<div class="muted">${fmtNum(i.ratings)} đánh giá</div>` : ""}`
      : `${fmtNum(i.ratings ?? 0)} đánh giá${i.score ? `<div class="muted">${i.score.toFixed(1)}★</div>` : ""}`;
    const speed = i.store === "gplay" ? (i.installsPerDay != null ? `${fmtNum(i.installsPerDay)}/ngày` : "–") : `${i.ratingsPerDay ?? 0} đg/ngày`;
    const g = i.store === "gplay" ? i.installsGain : i.ratingsGain;
    const gainTxt = g ? `<span class="up">+${fmtNum(g)}</span><div class="muted">${i.gainDays} ngày</div>` : `<span class="muted">–</span>`;
    return `<tr>
      <td><a class="game" href="${href}"${ext}>${iconImg(i)}<div class="meta">
        <div class="title">${esc(i.title)}</div><div class="dev">${esc(i.developer)}</div>
        <div class="tags">${storeBadge(i.store)}${pzTag(kindOf.get(i))}
          ${i.chart ? `<span class="tag up">đã vào chart #${i.chart.rank}</span>` : ""}
          ${i.followed ? `<span class="tag">NPH đang theo dõi</span>` : ""}
          ${i.cluster ? `<span class="tag" title="Số studio cùng ra game trùng tên">${i.cluster} bản trùng tên</span>` : ""}
          ${ngGenres(i).map((g) => `<span class="tag hide-sm">${esc(g)}</span>`).join("")}</div></div></a></td>
      <td>${fmtDate(i.released)}<div class="muted">${i.age} ngày</div></td>
      <td class="num">${sizeTxt}</td>
      <td class="num hide-sm">${speed}</td>
      <td class="num hide-sm">${gainTxt}</td>
      <td><span class="ng-bar" title="${i.momentum}/100"><i style="width:${i.momentum}%"></i></span> <span class="muted">${i.momentum}</span></td>
      <td class="hide-sm muted">${esc(i.foundBy ?? "")}${i.firstSeen ? `<div>thấy ${fmtDate(i.firstSeen)}</div>` : ""}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" class="muted center">${ngData.items.length ? "Không có game phù hợp." : `Chưa quét. Bấm "Quét lại" (vài phút) hoặc chờ quy trình hằng ngày.`}</td></tr>`;
}

// ================= Playable =================
let plData = null;
let plCurrent = null;
const PL_TYPE = { game: "Game", brand: "Thương hiệu", app: "Ứng dụng" };

async function loadPlayables(force = false) {
  if (!plData || force) plData = await api("/api/playables");
  setNotice(null);
  const cur = $("#pl-source").value;
  $("#pl-source").innerHTML = `<option value="">Tất cả nguồn</option>` + plData.sources.map((s) => {
    const n = plData.items.filter((i) => i.source === s.key).length;
    return `<option value="${esc(s.key)}">${esc(s.key)} (${n})</option>`;
  }).join("");
  $("#pl-source").value = cur;
  renderPlayables();
  const st = plData.status;
  $("#pl-refresh").disabled = !!st.running;
  if (st.running) setTimeout(() => view === "playables" && loadPlayables(true), 3000);
}

function renderPlayables() {
  if (!plData) return;
  const source = $("#pl-source").value, type = $("#pl-type").value, needle = norm($("#pl-q").value.trim());
  const onlyChart = $("#pl-chart").checked, onlyNew = $("#pl-new").checked;
  let items = plData.items.filter((i) => (!source || i.source === source) && (!type || i.type === type)
    && (!onlyChart || i.chart) && (!onlyNew || i.isNew) && (!needle || norm(`${i.name} ${i.category}`).includes(needle)));
  // Playable của thương hiệu / ứng dụng không phải game: không bao giờ là puzzle
  const kindOf = new Map(puzzleFilter(items, (i) => i.type && i.type !== "game" ? { title: "" }
    : { title: i.name, store: i.chart?.store, appId: i.chart?.appId, hint: i.category }).map(({ it, kind }) => [it, kind]));
  items = items.filter((i) => kindOf.has(i));
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sorters = {
    chart: (a, b) => (a.chart?.rank ?? 1e9) - (b.chart?.rank ?? 1e9) || byName(a, b),
    new: (a, b) => (b.firstSeen ?? "").localeCompare(a.firstSeen ?? "") || (b.updated ?? "").localeCompare(a.updated ?? "") || byName(a, b),
    name: byName,
    source: (a, b) => a.source.localeCompare(b.source) || byName(a, b),
  };
  items = [...items].sort(sorters[$("#pl-sort").value] ?? sorters.chart);

  const st = plData.status;
  const inChart = plData.items.filter((i) => i.chart).length;
  const errs = st.errors?.length ? ` · lỗi: ${st.errors.map((e) => esc(e.source)).join(", ")}` : "";
  $("#pl-meta").innerHTML = (st.running ? "Đang lấy danh sách… " : "")
    + `${items.length}/${plData.items.length} playable · ${inChart} của game đang trong chart · cập nhật ${st.lastFetch ? fmtDate(st.lastFetch) : "chưa"}${errs}. `
    + `Nguồn: showcase công khai của ${plData.sources.filter((s) => s.site).map((s) => `<a href="${safeUrl(s.site)}" target="_blank" rel="noopener">${esc(s.key)}</a>`).join(", ")} và portfolio studio khác. `
    + `Đây là playable studio làm cho khách hoặc bản demo, không phải toàn bộ playable đang chạy trên thị trường.`;
  $("#pl-list").innerHTML = items.length ? items.map((p) => {
    const idx = plData.items.indexOf(p);
    const thumb = p.thumb ? `<img src="${safeUrl(p.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : p.icon ? `<img src="${iconSrc(p.icon)}" alt="" loading="lazy">` : `<span class="noimg">${esc(p.name.charAt(0))}</span>`;
    return `<article class="pl-card">
      <button class="pl-thumb" data-pl-play="${idx}" title="Chơi thử ${esc(p.name)}">${thumb}
        <span class="pl-src">${esc(p.source)}</span><span class="pl-play">▶ Chơi thử</span></button>
      <div class="pl-body">
        <div class="pl-name" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="pl-foot">
          ${p.isNew ? `<span class="badge new">MỚI</span>` : ""}${pzTag(kindOf.get(p))}
          ${p.chart ? `<a class="tag up" href="${gameHref(p.chart.store, p.chart.appId)}" title="Hạng tốt nhất trong các bảng đang theo dõi">#${p.chart.rank} · ${p.chart.charts} bảng</a>` : ""}
          <span class="tag">${esc(PL_TYPE[p.type] ?? p.type)}</span>
          ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ""}
          <a class="tag link" href="${safeUrl(p.url)}" target="_blank" rel="noopener">↗</a>
          ${p.store ? `<a class="tag link" href="${safeUrl(p.store)}" target="_blank" rel="noopener">Store</a>` : ""}
        </div>
      </div>
    </article>`;
  }).join("") : `<div class="panel muted center">${plData.items.length ? "Không có playable phù hợp." : `Chưa có dữ liệu. Bấm "Lấy lại" (khoảng 30 giây) hoặc chờ quy trình hằng ngày.`}</div>`;
}

function openPlayable(p) {
  plCurrent = p;
  $("#pl-modal-title").textContent = p.name;
  $("#pl-modal-sub").textContent = `${p.source}${p.category ? " · " + p.category : ""}${p.chart ? ` · đang #${p.chart.rank} trong chart` : ""}`;
  $("#pl-modal-open").href = p.url;
  $("#pl-phone").classList.remove("land");
  playableFrame();
  $("#pl-modal").hidden = false;
  document.body.classList.add("pl-open");
  $("#pl-modal [data-pl=close]").focus();
}

// Chặn playable điều hướng cả trang khi bấm nút tải game; link store vẫn mở được ở tab mới
function playableFrame() {
  $("#pl-phone").innerHTML = `<iframe src="${safeUrl(plCurrent.url)}" title="${esc(plCurrent.name)}"
    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allow="autoplay; fullscreen"></iframe>`;
}

function closePlayable() {
  $("#pl-modal").hidden = true;
  $("#pl-phone").innerHTML = "";
  document.body.classList.remove("pl-open");
  plCurrent = null;
}

// ================= Tóm tắt =================
async function loadDigest(date) {
  setNotice(null);
  const el = $("#view-digest");
  const { digest: d, dates } = await api(`/api/digest${date ? `?date=${date}` : ""}`);
  if (!d) {
    el.innerHTML = `<div class="panel center muted">Chưa có bản tóm tắt. Bản đầu tiên sẽ được tạo sau lần cập nhật dữ liệu tiếp theo (mỗi ngày lúc ${esc(meta.dailyTime)}).
      <div style="margin-top:10px"><button class="btn" data-action="rebuild-digest">Tạo ngay từ dữ liệu hiện có</button></div></div>`;
    return;
  }
  // Gọi puzzleFilter một lần cho toàn bộ trang để thanh lọc đếm đúng; rồi tách lại theo quốc gia
  const tagged = rankLists({
    multi: d.countries.flatMap((c, ci) => c.multi.map((x) => ({ ...x, _c: ci }))),
    climbers: d.countries.flatMap((c, ci) => c.climbers.map((x) => ({ ...x, _c: ci }))),
    newcomers: d.countries.flatMap((c, ci) => c.newcomers.map((x) => ({ ...x, _c: ci }))),
  }, d.newApps.map((a) => ["newApps", { ...a, developer: a.publisher }]));
  const newApps = tagged.extra.map((t) => t.it);
  const countrySections = d.countries.map((c, ci) => {
    const msg = c.compared ? (genre ? "Không có game thuộc kiểu puzzle đang chọn." : "Không có.") : "Chưa đủ dữ liệu để so sánh.";
    const pick = (list) => tagged[list].filter((t) => t.it._c === ci);
    const li = (list, withMulti) => { const r = pick(list); return r.length ? r.map(({ it, kind }) => listItem(it, withMulti ? multiTags(it) : "", kind)).join("") : emptyLi(msg); };
    return `<section class="panel">
      <h2>${esc(c.name)}</h2>
      <div class="grid3 inner">
        <div><h3>Nổi bật trên nhiều bảng</h3><ul class="list">${li("multi", true)}</ul></div>
        <div><h3>Tăng hạng mạnh</h3><ul class="list">${li("climbers")}</ul></div>
        <div><h3>Mới vào top 50</h3><ul class="list">${li("newcomers")}</ul></div>
      </div>
    </section>`;
  }).join("");

  el.innerHTML = `
    <div class="digest-head">
      <div>
        <h2>Tóm tắt ngày ${fmtDate(d.date)}</h2>
        <p class="hint">Tạo lúc ${fmtDateTime(d.createdAt)} · so với ngày hôm trước · tự tạo mỗi ngày lúc ${esc(meta.dailyTime)}</p>
      </div>
      <div class="actions">
        <label class="inline">Ngày <select id="digest-date">${dates.map((x) => `<option value="${x}"${x === d.date ? " selected" : ""}>${fmtDate(x)}</option>`).join("")}</select></label>
        <button class="btn" data-action="rebuild-digest">Tạo lại</button>
      </div>
    </div>
    ${countrySections}
    <section class="panel">
      <h2>Game mới từ nhà phát hành đang theo dõi</h2>
      <p class="hint">Phát hiện trong 3 ngày gần nhất.</p>
      ${newAppsList(newApps, genre ? "Không có game mới thuộc kiểu puzzle đang chọn." : "Không có game mới.")}
    </section>
    <section class="panel">
      <h2>Tin đáng đọc</h2>
      <p class="hint">Bài số liệu và bài nhắc tới game đang lên, 3 ngày gần nhất.</p>
      <div class="news-list">${d.news.length ? d.news.map((n) => newsCard(n, false)).join("") : `<p class="muted">Không có.</p>`}</div>
    </section>`;
  $("#digest-date")?.addEventListener("change", (e) => loadDigest(e.target.value));
}

function newAppsList(apps, empty) {
  if (!apps.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul class="list">${apps.map((a) => `<li><a class="row-link" href="${safeUrl(a.url)}" target="_blank" rel="noopener">
    ${iconImg(a)}
    <div class="meta"><div class="title">${esc(a.title)}</div>
      <div class="dev">${esc(a.publisher)} · ${storeBadge(a.store)}</div>
      <div class="tags"><span class="tag">thấy lần đầu ${fmtDate(a.firstSeen)}</span>
        ${a.released ? `<span class="tag">phát hành ${esc(String(a.released).length > 12 ? fmtDate(a.released) : a.released)}</span>` : ""}
        ${a.installs ? `<span class="tag">${esc(a.installs)} lượt cài</span>` : ""}
        ${a.bestRank ? `<span class="tag up">đang ở #${a.bestRank}</span>` : ""}</div>
    </div></a></li>`).join("")}</ul>`;
}

// ================= Nhà phát hành =================
async function loadPublishers() {
  setNotice(null);
  const el = $("#view-publishers");
  const data = await api("/api/publishers");
  const groups = new Map();
  for (const p of data.publishers) {
    const k = p.seed ?? p.name;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const st = data.status;
  el.innerHTML = `
    <p class="hint">${data.publishers.length} tài khoản của ${groups.size} nhà phát hành · cập nhật cùng quy trình hằng ngày.
      ${st.running ? ` Đang lấy dữ liệu ${st.done}/${st.total}…` : ""}
      Theo dõi thêm: mở trang một game rồi bấm "Theo dõi nhà phát hành".</p>
    <section class="panel">
      <h2>Game mới phát hiện (14 ngày)</h2>
      <p class="hint">Lần lấy đầu tiên của mỗi tài khoản chỉ ghi nhận danh sách gốc; game ra sau đó mới được tính là mới.</p>
      ${newAppsList(data.newApps, "Chưa có game mới.")}
    </section>
    <div class="pub-grid">
      ${[...groups].map(([name, accts]) => `
        <article class="panel pub-card">
          <h2>${esc(name)}</h2>
          <ul class="list">${accts.map((p) => `<li><a class="row-link" href="${pubHref(p.store, p.devId)}">
            <div class="meta"><div class="title">${esc(p.name)}</div>
              <div class="tags">${storeBadge(p.store)}
                <span class="tag">${p.apps} game</span>
                <span class="tag">${p.inChart} trong chart${p.bestRank ? ` · tốt nhất #${p.bestRank}` : ""}</span>
                ${p.newApps ? `<span class="tag up">${p.newApps} mới</span>` : ""}
                ${p.lastError ? `<span class="tag down" title="${esc(p.lastError)}">lỗi</span>` : ""}</div>
            </div></a></li>`).join("")}</ul>
        </article>`).join("")}
    </div>`;
}

async function loadPublisher(store, devId) {
  setNotice(null);
  const el = $("#view-publisher");
  const d = await api(`/api/publisher?store=${store}&devId=${encodeURIComponent(devId)}`);
  if (d.notFound) {
    el.innerHTML = `<div class="panel center muted">Chưa theo dõi nhà phát hành này. <a href="#/publishers">Về danh sách</a></div>`;
    return;
  }
  const p = d.publisher;
  const inChart = d.apps.filter((a) => a.bestRank).length;
  const apps = puzzleFilter(d.apps, (a) => ({ title: a.title, store: p.store, appId: a.appId }));
  el.innerHTML = `
    <a class="back" href="#/publishers">← Nhà phát hành</a>
    <div class="page-head">
      <div>
        <h2>${esc(p.name)}</h2>
        <div class="tags">${storeBadge(p.store)}${p.seed ? `<span class="tag">${esc(p.seed)}</span>` : ""}
          <span class="tag">${d.apps.length} game · ${inChart} đang trong chart</span>
          <span class="tag">cập nhật ${fmtDateTime(p.lastFetch) || "chưa"}</span></div>
        ${p.lastError ? `<p class="down">Lỗi lần lấy gần nhất: ${esc(p.lastError)}</p>` : ""}
      </div>
      <button class="btn" data-action="unfollow" data-store="${esc(p.store)}" data-dev="${esc(p.devId)}">Bỏ theo dõi</button>
    </div>
    <div class="panel flush"><div class="table-wrap"><table>
      <thead><tr><th>Game</th><th class="num">Hạng tốt nhất</th><th class="hide-sm">Phát hành</th><th class="hide-sm">Lượt cài / đánh giá</th><th class="hide-sm">Thấy lần đầu</th></tr></thead>
      <tbody>${apps.length ? apps.map(({ it: a, kind }) => {
        const href = a.bestRank || a.charts ? gameHref(p.store, a.appId) : safeUrl(a.url);
        const ext = a.bestRank ? "" : ` target="_blank" rel="noopener"`;
        return `<tr>
          <td><a class="game" href="${href}"${ext}>${iconImg(a)}<div class="meta"><div class="title">${esc(a.title)}${a.isNew ? ` <span class="badge new">MỚI</span>` : ""}</div>${kind ? `<div class="tags">${pzTag(kind)}</div>` : ""}</div></a></td>
          <td class="num">${a.bestRank ? `#${a.bestRank} <span class="muted">(${a.charts} bảng)</span>` : `<span class="muted">–</span>`}</td>
          <td class="hide-sm muted">${a.released ? esc(String(a.released).length > 12 ? fmtDate(a.released) : a.released) : "–"}</td>
          <td class="hide-sm muted">${[a.installs, a.ratings != null ? `${Number(a.ratings).toLocaleString("vi-VN")} đánh giá` : null].filter(Boolean).map(esc).join(" · ") || "–"}</td>
          <td class="hide-sm muted">${fmtDate(a.firstSeen)}</td>
        </tr>`;
      }).join("") : `<tr><td colspan="5" class="muted center">Không có game thuộc kiểu puzzle đang chọn.</td></tr>`}</tbody></table></div></div>`;
}

// ================= Trang chi tiết game =================
const LINE_COLORS = ["#3b5bdb", "#e8590c", "#2f9e44", "#c2255c", "#7048e8", "#1098ad", "#f08c00", "#5c940d", "#d6336c", "#495057"];
let game = null; // { data, visible:Set, period }

async function loadGame(store, appId) {
  setNotice(null);
  const el = $("#view-game");
  el.innerHTML = `<p class="muted">Đang tải…</p>`;
  const data = await api(`/api/game?store=${store}&appId=${encodeURIComponent(appId)}`);
  if (data.notFound) {
    el.innerHTML = `<div class="panel center muted">Game này chưa từng xuất hiện trong các bảng đang theo dõi.</div>`;
    return;
  }
  // Mặc định hiện 5 bảng game đang có hạng tốt nhất
  game = { data, visible: new Set(data.series.slice(0, 5).map((s) => s.key)), period: "30", devOpen: false, dev: null, adCounts: null };
  renderGame();
}

// Tên ngắn để tìm: bỏ phụ đề và dấu thừa ("Magic Sort!" -> "Magic Sort", "Block Out! - Color Sort" -> "Block Out")
const searchName = (t) => String(t ?? "").split(/\s[-–—|]\s|:/)[0].replace(/[!?™®©.]+/g, " ").replace(/\s+/g, " ").trim();
// Nhà phát hành bỏ hậu tố pháp lý: "Grand Games A.Ş." -> "Grand Games", "SayGames Ltd" -> "SayGames"
const LEGAL_SUFFIX = /([\s,.]+(ltd|limited|llc|inc|corp|co|sas|sa|gmbh|pte|plc|srl|jsc|a\.?ş|a\.?s|oy|ab|bv)\.?)+$/i;
const devName = (d) => String(d ?? "").replace(/\s+/g, " ").replace(/\.com$/i, "").replace(LEGAL_SUFFIX, "").trim();

function adLinkButtons(app) {
  const vals = { q: searchName(app.title), dev: app.developer ?? "", devq: devName(app.developer) };
  const url = (u) => u.replace(/\{(q|dev|devq)\}/g, (_, k) => encodeURIComponent(vals[k]));
  return meta.adLinks.map((l, i) => `<a class="adlink" href="${esc(url(l.url))}" target="_blank" rel="noopener"
      data-copy="${l.copy ? esc(l.copy === "dev" ? app.developer : app.title) : ""}" data-idx="${i}"${l.count ? ` data-count="${esc(l.count)}"` : ""}>
      <strong>${esc(l.name)}${l.count ? ` <em class="adcount muted">đang đếm…</em>` : ""}</strong>
      <span>${esc(l.desc)}${l.copy ? " · tự sao chép tên" : ""}</span>
      ${l.count ? `<small class="adcount-note"></small>` : ""}</a>`).join("");
}

// Số quảng cáo trên từng thư viện, điền vào các ô ở mục "Xem quảng cáo"
const fmtNum = (n) => Number(n).toLocaleString("vi-VN");
async function loadAdCounts(app) {
  if (!game.adCounts) game.adCounts = await api(`/api/ads/counts?store=${app.store}&appId=${encodeURIComponent(app.appId)}`);
  const c = game.adCounts;
  const fill = (key, count, note, cls = "") => {
    const a = document.querySelector(`.adlink[data-count="${key}"]`);
    if (!a) return;
    const em = a.querySelector(".adcount");
    em.textContent = count;
    em.className = `adcount ${cls}`;
    a.querySelector(".adcount-note").textContent = note;
  };
  const scanned = (key, m, what) => {
    if (!m) fill(key, "–", "Không có dữ liệu", "muted");
    else if (m.count == null) fill(key, "chưa quét", "Bấm \"Quét quảng cáo\" ở mục bên dưới", "muted");
    else fill(key, `${fmtNum(m.count)} QC`, `${what} · quét ${fmtDate(m.lastScan)}`, "count");
  };
  scanned("meta", c.meta, "đang chạy của game");
  scanned("apple", c.apple, "của game ở EU, 90 ngày");
  const g = c.google;
  if (!g || g.error) fill("google", "–", g?.error ? `Lỗi: ${g.error}` : "Bản công khai không đếm được", "muted");
  else if (!g.advertiser) fill("google", "không thấy", g.rejected?.length
    ? `Tài khoản trùng tên (${[...new Set(g.rejected)].join(", ")}) không quảng cáo game nào của nhà phát hành này: có thể là công ty khác cùng tên`
    : g.candidates?.length ? `Không có nhà quảng cáo trùng tên (gần nhất: ${g.candidates.join(", ")})` : "Không có nhà quảng cáo trùng tên", "muted");
  else {
    const gameCount = g.game?.count != null ? `${fmtNum(g.game.count)} của game (trong ${fmtNum(Math.min(g.max, 120))} QC mới nhất) · ` : "";
    fill("google", `${g.game?.count != null ? `${fmtNum(g.game.count)} / ` : ""}${g.min === g.max ? fmtNum(g.max) : `${fmtNum(g.min)}–${fmtNum(g.max)}`} QC`,
      `${gameCount}toàn bộ của "${g.advertiser}" (${g.region})${g.approx ? " · tên gần đúng" : ""} · đã xác minh có quảng cáo game của nhà phát hành${g.stale ? ` · số cũ ${fmtDate(g.stale)}` : ""}`, "count");
    // Mở thẳng trang nhà quảng cáo thay vì trang tìm kiếm
    const a = document.querySelector('.adlink[data-count="google"]');
    if (a && safeUrl(g.url)) {
      a.href = g.url;
      delete a.dataset.copy;
      a.querySelector("span").textContent = a.querySelector("span").textContent.replace(" · tự sao chép tên", " · mở thẳng trang nhà quảng cáo");
    }
  }
}

// Tất cả game của nhà phát hành (bấm tên nhà phát hành ở đầu trang game)
function devAppsPanel() {
  const d = game.dev;
  if (!d) return `<p class="muted">Đang lấy danh sách game của nhà phát hành…</p>`;
  if (d.error || !d.publisher) return `<p class="down">${esc(d.error ?? "Không lấy được danh sách game.")}</p>`;
  const p = d.publisher;
  const inChart = d.apps.filter((a) => a.bestRank).length;
  return `<div class="panel-head"><h2>Game của ${esc(p.name)}</h2>
      <div class="actions">
        ${d.followed ? `<a class="btn" href="${pubHref(p.store, p.devId)}">Trang nhà phát hành</a>`
          : `<button class="btn" data-action="follow" data-store="${esc(game.data.app.store)}" data-app="${esc(game.data.app.appId)}">+ Theo dõi</button>`}
        <button class="btn" data-action="dev-apps">Đóng</button>
      </div></div>
    <p class="hint">${d.apps.length} game · ${inChart} đang trong chart${d.followed ? "" : " · lấy trực tiếp từ store"}</p>
    <ul class="list dev-apps">${d.apps.map((a) => {
      const href = a.bestRank || a.charts ? gameHref(p.store, a.appId) : safeUrl(a.url);
      const ext = a.bestRank || a.charts ? "" : ` target="_blank" rel="noopener"`;
      const cur = a.appId === game.data.app.appId;
      return `<li${cur ? ` class="current"` : ""}><a class="row-link" href="${href}"${ext}>
        ${iconImg(a)}
        <div class="meta"><div class="title">${esc(a.title)}${a.isNew ? ` <span class="badge new">MỚI</span>` : ""}</div>
          <div class="tags">${a.bestRank ? `<span class="tag up">#${a.bestRank} · ${a.charts} bảng</span>` : `<span class="tag">ngoài chart ↗</span>`}
            ${a.score ? `<span class="tag">${Number(a.score).toFixed(1)}★</span>` : ""}
            ${a.released ? `<span class="tag">${esc(String(a.released).length > 12 ? fmtDate(a.released) : a.released)}</span>` : ""}</div>
        </div></a></li>`;
    }).join("")}</ul>`;
}

async function toggleDevApps() {
  game.devOpen = !game.devOpen;
  const el = $("#dev-apps");
  el.hidden = !game.devOpen;
  if (!game.devOpen) return;
  el.innerHTML = devAppsPanel();
  if (!game.dev) {
    const { app } = game.data;
    game.dev = await api(`/api/developer?store=${app.store}&appId=${encodeURIComponent(app.appId)}`)
      .catch((e) => ({ error: String(e.message ?? e) }));
    if (game?.data.app.appId === app.appId) $("#dev-apps").innerHTML = devAppsPanel();
  }
}

function renderGame() {
  const { data, visible, period } = game;
  const { app, stats, series } = data;
  const allDates = data.dates;
  const dates = period === "all" ? allDates : allDates.slice(-Number(period));
  const store = app.store;
  const seriesByKey = new Map(series.map((s, i) => [s.key, { ...s, color: LINE_COLORS[i % LINE_COLORS.length] }]));
  const shown = [...seriesByKey.values()].filter((s) => visible.has(s.key));
  const label = (key) => (key ? comboLabel(seriesByKey.get(key)) : "");
  const pub = data.publisher;

  $("#view-game").innerHTML = `
    <a class="back" href="javascript:history.back()">← Quay lại</a>
    <div class="page-head game-head">
      ${iconImg(app, "icon big")}
      <div class="grow">
        <h2>${esc(app.title)}</h2>
        <div class="dev"><button class="devlink" data-action="dev-apps" title="Xem tất cả game của nhà phát hành">${esc(app.developer)} ${game.devOpen ? "▴" : "▾"}</button> · ${storeBadge(store)}
          ${app.score != null ? ` · ${app.score.toFixed(1)}★` : ""}</div>
        <div class="tags">
          <a class="tag link" href="${safeUrl(app.url)}" target="_blank" rel="noopener">Mở trên store ↗</a>
          ${pub ? `<span class="tag up">Đang theo dõi nhà phát hành</span>`
            : `<button class="tag link" data-action="follow" data-store="${esc(store)}" data-app="${esc(app.appId)}">+ Theo dõi nhà phát hành</button>`}
        </div>
      </div>
    </div>

    <section class="panel" id="dev-apps"${game.devOpen ? "" : " hidden"}>${game.devOpen ? devAppsPanel() : ""}</section>

    <div class="stats">
      <div class="stat"><span>Hạng tốt nhất</span><strong>${stats.bestRank ? `#${stats.bestRank}` : "–"}</strong><em>${esc(label(stats.bestChart))}${stats.bestDate ? ` · ${fmtDate(stats.bestDate)}` : ""}</em></div>
      <div class="stat"><span>Đang có mặt</span><strong>${stats.chartsNow}</strong><em>bảng xếp hạng</em></div>
      <div class="stat"><span>Số ngày trong chart</span><strong>${stats.daysInChart}</strong><em>từ ${fmtDate(stats.firstInChart)}</em></div>
      <div class="stat"><span>Tăng mạnh nhất 1 ngày</span><strong>${stats.bigJump ? `▲ ${stats.bigJump}` : "–"}</strong><em>${stats.bigJump ? `${esc(label(stats.bigJumpChart))} · ${fmtDate(stats.bigJumpDate)}` : "chưa có"}</em></div>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Diễn biến thứ hạng</h2>
        <label class="inline">Khoảng <select id="game-period">
          ${[["7", "7 ngày"], ["30", "30 ngày"], ["90", "90 ngày"], ["all", "Toàn bộ"]].map(([v, t]) => `<option value="${v}"${v === period ? " selected" : ""}>${t}</option>`).join("")}
        </select></label></div>
      <p class="hint">Theo dõi từ ${fmtDate(allDates[0])}. Bấm vào tên bảng để bật/tắt đường.</p>
      <div class="legend">${[...seriesByKey.values()].map((s) => `
        <button class="lg${visible.has(s.key) ? " on" : ""}" data-key="${esc(s.key)}" style="--c:${s.color}">
          <i></i>${esc(comboLabel(s))} <span class="muted">${s.current ? `#${s.current}` : "ngoài bảng"}${s.trend7 ? ` ${s.trend7 > 0 ? "▲" : "▼"}${Math.abs(s.trend7)}` : ""}</span>
        </button>`).join("")}</div>
      ${multiLineChart(shown, dates)}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Thứ hạng từng ngày</h2><button class="btn" data-action="csv">Xuất CSV</button></div>
      <p class="hint">Hiện các bảng đang bật ở trên. "rơi" = có theo dõi bảng đó nhưng game không có trong top; "–" = chưa theo dõi bảng đó vào ngày này.</p>
      ${dayTable(shown, dates)}
    </section>

    <section class="panel">
      <h2>Xem quảng cáo</h2>
      <p class="hint">Mở thư viện quảng cáo, tìm sẵn theo tên game. Số QC: Meta đếm quảng cáo đang chạy của riêng game (lần quét gần nhất); Google đếm toàn bộ quảng cáo của nhà quảng cáo trùng tên nhà phát hành (Google không cho lọc theo game). Playable chạy trên AppLovin/Unity không có thư viện công khai; cần công cụ trả phí như AdMapix, SocialPeta.</p>
      <div class="adlinks">${adLinkButtons(app)}</div>
    </section>

    <section class="panel" id="game-ads"><p class="muted">Đang tải quảng cáo…</p></section>`;
  loadGameAds(app);
  loadAdCounts(app);
}

function multiLineChart(shown, dates) {
  if (!shown.length) return `<p class="muted">Chọn ít nhất một bảng ở trên.</p>`;
  const w = 760, h = 260, pl = 40, pr = 12, pt = 12, pb = 28;
  const ranks = shown.flatMap((s) => dates.map((d) => s.ranks[d]).filter((r) => r != null));
  const max = Math.max(10, ...ranks);
  const n = Math.max(dates.length - 1, 1);
  const X = (i) => pl + (dates.length === 1 ? (w - pl - pr) / 2 : (i / n) * (w - pl - pr));
  const Y = (r) => pt + ((r - 1) / (max - 1)) * (h - pt - pb);
  const ticks = [...new Set([1, Math.round(max / 4), Math.round(max / 2), Math.round((3 * max) / 4), max])].filter((t) => t >= 1);
  const step = Math.max(1, Math.ceil(dates.length / 8));
  const lines = shown.map((s) => {
    // Ngắt đường ở ngày game không có trong bảng
    const segs = [];
    let cur = [];
    dates.forEach((d, i) => {
      const r = s.ranks[d];
      if (r == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), Y(r), d, r]);
    });
    if (cur.length) segs.push(cur);
    return segs.map((seg) => `${seg.length > 1 ? `<polyline points="${seg.map((p) => p.slice(0, 2).join(",")).join(" ")}" style="stroke:${s.color}"/>` : ""}
      ${seg.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" style="fill:${s.color}"><title>${esc(comboLabel(s))}\n${fmtDate(p[2])}: #${p[3]}</title></circle>`).join("")}`).join("");
  }).join("");
  return `<svg class="mchart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Biểu đồ thứ hạng">
    ${ticks.map((t) => `<line class="grid" x1="${pl}" x2="${w - pr}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">#${t}</text>`).join("")}
    ${dates.map((d, i) => (i % step === 0 || i === dates.length - 1) ? `<text x="${X(i)}" y="${h - 8}" text-anchor="middle">${fmtDate(d).slice(0, 5)}</text>` : "").join("")}
    <g class="lines">${lines}</g>
  </svg>`;
}

function dayTable(shown, dates) {
  if (!shown.length) return "";
  const allDates = game.data.dates;
  const cell = (s, d) => {
    if (s.start && d < s.start) return `<td class="num muted">–</td>`;
    const r = s.ranks[d];
    const prevDate = allDates[allDates.indexOf(d) - 1];
    const p = prevDate && (!s.start || prevDate >= s.start) ? s.ranks[prevDate] : undefined;
    if (r == null) return `<td class="num">${p != null ? `<span class="down">rơi</span>` : `<span class="muted">ngoài</span>`}</td>`;
    let mv = "";
    if (prevDate && p == null && (!s.start || prevDate >= s.start)) mv = ` <span class="new-t">vào</span>`;
    else if (p != null && p !== r) mv = p > r ? ` <span class="up">▲${p - r}</span>` : ` <span class="down">▼${r - p}</span>`;
    return `<td class="num">#${r}${mv}</td>`;
  };
  return `<div class="table-wrap"><table class="daytable">
    <thead><tr><th>Ngày</th>${shown.map((s) => `<th class="num"><i class="dot" style="background:${s.color}"></i>${esc(comboLabel(s))}</th>`).join("")}</tr></thead>
    <tbody>${[...dates].reverse().map((d) => `<tr><td>${fmtDate(d)}</td>${shown.map((s) => cell(s, d)).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function exportCsv() {
  const { data } = game;
  const head = ["Ngày", ...data.series.map((s) => comboLabel(s))];
  const rows = data.dates.map((d) => [d, ...data.series.map((s) => s.ranks[d] ?? "")]);
  const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${data.app.title.replace(/[^\p{L}\p{N}]+/gu, "-")}-thu-hang.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ================= tìm kiếm toàn cục =================
let searchTimer = null;
let searchResults = [];

async function runGlobalSearch() {
  const q = $("#gsearch").value.trim();
  const box = $("#gsearch-results");
  if (q.length < 2) { box.hidden = true; return; }
  const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if ($("#gsearch").value.trim() !== q) return;
  searchResults = results;
  box.innerHTML = results.length ? results.map((r, i) => `
    <a class="gs-item${i === 0 ? " active" : ""}" href="${gameHref(r.store, r.appId)}">
      ${iconImg(r)}
      <div class="meta"><div class="title">${esc(r.title)}</div><div class="dev">${esc(r.developer)} · ${storeBadge(r.store)}</div></div>
      <div class="right">${r.best ? `<strong>#${r.best.rank}</strong><div class="rankmove">${r.charts} bảng</div>`
        : `<span class="muted">ngoài bảng</span><div class="rankmove">${r.last ? `lần cuối ${fmtDate(r.last.date)}` : ""}</div>`}</div>
    </a>`).join("") : `<div class="gs-empty">Không tìm thấy trong dữ liệu đã theo dõi.</div>`;
  box.hidden = false;
}

// ================= trạng thái cập nhật =================
let wasRunning = false;
const STEP_LABEL = { charts: "bảng xếp hạng", publishers: "nhà phát hành", news: "tin ngành", ads: "quảng cáo", playables: "thư viện playable", newgames: "game mới", digest: "tóm tắt", publish: "bản công khai", china: "thị trường Trung Quốc" };

async function pollStatus() {
  let s;
  try { s = await api("/api/status"); } catch { setTimeout(pollStatus, 10000); return; }
  const last = s.lastRun ? fmtDateTime(s.lastRun.finished_at) : null;
  $("#progress").hidden = !s.running;
  $("#refresh").disabled = s.running;
  if (s.running) {
    const step = s.daily.step;
    let pct = 0, txt = `Đang cập nhật ${STEP_LABEL[step] ?? ""}…`;
    if (step === "charts" || (!step && s.total)) { pct = s.done / Math.max(s.total, 1); txt = `Đang lấy bảng xếp hạng ${s.done}/${s.total}…`; }
    else if (step === "publishers") { pct = s.publishers.done / Math.max(s.publishers.total, 1); txt = `Đang lấy nhà phát hành ${s.publishers.done}/${s.publishers.total}…`; }
    else if (step === "ads" && s.ads.total) { pct = s.ads.done / s.ads.total; txt = `Đang quét quảng cáo ${s.ads.done}/${s.ads.total}…`; }
    else if (step) pct = 1;
    $("#progress-bar").style.width = `${Math.round(pct * 100)}%`;
    $("#status-text").textContent = txt;
  } else {
    const err = s.lastRun?.failed ? ` · ${s.lastRun.failed} bảng lỗi` : "";
    $("#status-text").textContent = last ? `Cập nhật: ${last}${err}` : "Chưa có dữ liệu";
  }
  if (wasRunning && !s.running) { ovCache = null; route(); }
  wasRunning = s.running;
  setTimeout(pollStatus, s.running ? 2000 : 30000);
}

// ================= điều hướng =================
const TAB_VIEWS = ["overview", "digest", "chart", "publishers", "news", "newgames", "ads", "playables", "china"];

// Tab "Trung Quốc": public/china.js (nạp khi mở tab lần đầu); tab phụ theo đường dẫn #/china/<tab>
async function loadChina(sub) {
  setNotice(null);
  const { showChina } = await import("./china.js");
  return showChina(sub);
}

function show(v) {
  view = v;
  document.body.dataset.view = v;
  document.querySelectorAll(".view").forEach((el) => { el.hidden = el.id !== `view-${v}`; });
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === v
    || (v === "game" && false) || (v === "publisher" && t.dataset.tab === "publishers")));
}

function route() {
  const [, name = "overview", a, b] = (location.hash || "#/overview").split("/").map(decodeURIComponent);
  $("#gsearch-results").hidden = true;
  if (name === "game" && a && b) { show("game"); return loadGame(a, b); }
  if (name === "publisher" && a && b) { show("publisher"); return loadPublisher(a, b); }
  const v = TAB_VIEWS.includes(name) ? name : "overview";
  show(v);
  prefs.view = v;
  savePrefs();
  if (v === "overview") return loadOverview();
  if (v === "chart") return loadChart();
  if (v === "news") return loadNews();
  if (v === "digest") return loadDigest();
  if (v === "publishers") return loadPublishers();
  if (v === "ads") return loadAds();
  if (v === "playables") return loadPlayables();
  if (v === "newgames") { ngTab = a === "puzzle" ? "puzzle" : "all"; return loadNewGames(); }
  if (v === "china") return loadChina(a);
}

async function init() {
  meta = await api("/api/meta");
  setPuzzleIds(meta.puzzleIds);
  $("#genre-bar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-genre]");
    if (b) setGenre(b.dataset.genre === genre ? "" : b.dataset.genre);
  });
  fillSelect($("#country"), meta.countries, "code", prefs.country);
  fillSelect($("#store"), meta.stores, "key", prefs.store);
  fillSelect($("#collection"), meta.collections, "key", prefs.collection);
  refreshCategoryOptions();
  if (prefs.compare) $("#compare").value = prefs.compare;

  for (const id of ["country", "compare", "category", "collection"])
    $("#" + id).addEventListener("change", () => { savePrefs(); route(); });
  $("#store").addEventListener("change", () => { refreshCategoryOptions(); savePrefs(); route(); });
  $("#date").addEventListener("change", () => loadChart(true));
  $("#search").addEventListener("input", renderChart);
  $("#movement").addEventListener("change", renderChart);
  $("#refresh").addEventListener("click", async () => { await post("/api/refresh"); pollStatus(); });

  // Cả hàng trong bảng xếp hạng bấm được
  $("#chart-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-href]");
    if (tr && !e.target.closest("a")) location.hash = tr.dataset.href;
  });

  for (const id of ["news-source", "news-days", "news-data", "news-matched"]) $("#" + id).addEventListener("change", loadNews);
  let qTimer;
  $("#news-q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(loadNews, 250); });
  $("#news-refresh").addEventListener("click", async () => { await post("/api/news/refresh"); loadNews(); });

  for (const id of ["ads-sort", "ads-source", "ads-game", "ads-format", "ads-min-days", "ads-new", "ads-active"]) $("#" + id).addEventListener("change", loadAds);
  let adsQTimer;
  $("#ads-q").addEventListener("input", () => { clearTimeout(adsQTimer); adsQTimer = setTimeout(loadAds, 250); });
  // Khôi phục bộ lọc Game mới đã lưu (thể loại và từ khoá điền sau khi có dữ liệu, xem fillNgOptions)
  for (const id of NG_SELECTS) if (prefs.ng?.[id] && [...$("#" + id).options].some((o) => o.value === prefs.ng[id])) $("#" + id).value = prefs.ng[id];
  for (const id of NG_CHECKS) $("#" + id).checked = !!prefs.ng?.[id];
  ngKind = prefs.ngKind ?? "";
  for (const id of [...NG_SELECTS, ...NG_CHECKS]) $("#" + id).addEventListener("change", () => { saveNgPrefs(); renderNewGames(); });
  $("#ng-q").addEventListener("input", renderNewGames);
  $("#ng-puzzle").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ng-kind]");
    if (!b) return;
    ngKind = ngKind === b.dataset.ngKind ? "" : b.dataset.ngKind;
    saveNgPrefs();
    renderNewGames();
  });
  $("#ng-reset").addEventListener("click", () => {
    for (const id of NG_SELECTS) $("#" + id).selectedIndex = id === "ng-days" ? 2 : 0;
    for (const id of NG_CHECKS) $("#" + id).checked = false;
    $("#ng-q").value = ""; ngTrend = null; ngKind = "";
    saveNgPrefs();
    renderNewGames();
  });
  $("#ng-trends").addEventListener("click", (e) => {
    const b = e.target.closest("[data-trend]");
    if (!b) return;
    ngTrend = ngTrend === b.dataset.trend ? null : b.dataset.trend;
    renderNewGames();
  });
  $("#ng-refresh").addEventListener("click", async () => {
    const r = await post("/api/newgames/refresh");
    if (!r.started) setNotice("Đang có quy trình cập nhật khác chạy, thử lại sau.");
    setTimeout(() => loadNewGames(true), 1500);
  });
  for (const id of ["pl-sort", "pl-source", "pl-type", "pl-chart", "pl-new"]) $("#" + id).addEventListener("change", renderPlayables);
  $("#pl-q").addEventListener("input", renderPlayables);
  $("#pl-refresh").addEventListener("click", async () => {
    await post("/api/playables/refresh");
    $("#pl-refresh").disabled = true;
    setTimeout(() => loadPlayables(true), 1500);
  });
  // Cửa sổ chơi thử playable
  $("#pl-modal").addEventListener("click", (e) => {
    const act = e.target.closest("[data-pl]")?.dataset.pl;
    if (e.target === $("#pl-modal") || act === "close") closePlayable();
    if (act === "reload") playableFrame();
    if (act === "rotate") $("#pl-phone").classList.toggle("land");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#pl-modal").hidden) closePlayable(); });
  $("#pl-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pl-play]");
    if (b) openPlayable(plData.items[Number(b.dataset.plPlay)]);
  });

  $("#ads-refresh").addEventListener("click", async () => {
    const r = await post("/api/ads/refresh");
    if (!r.started) setNotice("Đang có quy trình cập nhật khác chạy, thử lại sau.");
    loadAds();
  });

  // Tìm kiếm toàn cục
  $("#gsearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runGlobalSearch, 200); });
  $("#gsearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && searchResults[0]) { location.hash = gameHref(searchResults[0].store, searchResults[0].appId); $("#gsearch").blur(); }
    if (e.key === "Escape") $("#gsearch-results").hidden = true;
  });
  $("#gsearch").addEventListener("focus", () => { if (searchResults.length && $("#gsearch").value.trim().length >= 2) $("#gsearch-results").hidden = false; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".gsearch")) $("#gsearch-results").hidden = true; });

  // Các nút hành động trong trang (gắn một lần ở cấp document)
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) {
      const act = btn.dataset.action;
      if (act === "rebuild-digest") { btn.disabled = true; await post("/api/digest/rebuild"); loadDigest(); }
      if (act === "follow") {
        btn.disabled = true; btn.textContent = "Đang lấy danh sách game…";
        const r = await post("/api/publishers/follow", { store: btn.dataset.store, appId: btn.dataset.app });
        if (r.error) { btn.textContent = "Lỗi: " + r.error; return; }
        location.hash = pubHref(r.store, r.devId);
      }
      if (act === "unfollow" && confirm("Bỏ theo dõi nhà phát hành này? Danh sách game đã lưu của họ cũng bị xoá.")) {
        await post("/api/publishers/unfollow", { store: btn.dataset.store, devId: btn.dataset.dev });
        location.hash = "#/publishers";
      }
      if (act === "csv") exportCsv();
      if (act === "dev-apps" && game) {
        await toggleDevApps();
        const b = document.querySelector(".devlink");
        if (b) b.textContent = `${game.data.app.developer} ${game.devOpen ? "▴" : "▾"}`;
        if (game.devOpen) $("#dev-apps").scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      if (act === "scan-ads") {
        btn.disabled = true; btn.textContent = "Đang quét…";
        const r = await post("/api/ads/scan", { store: btn.dataset.store, appId: btn.dataset.app });
        if (r.error) { btn.textContent = r.error; return; }
        setTimeout(() => loadGameAds(game.data.app), 1500);
      }
      return;
    }
    const lg = e.target.closest(".lg[data-key]");
    if (lg && game) {
      game.visible.has(lg.dataset.key) ? game.visible.delete(lg.dataset.key) : game.visible.add(lg.dataset.key);
      renderGame();
      return;
    }
    // Thẻ quảng cáo: bấm ảnh để phát video ngay trong thẻ, không có video thì mở Ad Library
    const media = e.target.closest(".ad-media");
    if (media) {
      if (media.dataset.video) {
        media.querySelector("img, .noimg")?.replaceWith(Object.assign(document.createElement("video"),
          { src: media.dataset.video, controls: true, autoplay: true, playsInline: true }));
        media.querySelector(".play")?.remove();
        delete media.dataset.video;
      } else if (media.dataset.open) window.open(media.dataset.open, "_blank", "noopener");
      return;
    }
    // "Xem tất cả" ở trang game: chọn sẵn game trong tab Quảng cáo
    const ag = e.target.closest("[data-ads-game]");
    if (ag) adsPendingGame = ag.dataset.adsGame;
    // Link quảng cáo không nhận từ khoá qua URL: sao chép tên trước khi mở
    const ad = e.target.closest(".adlink[data-copy]");
    if (ad?.dataset.copy) navigator.clipboard?.writeText(ad.dataset.copy).catch(() => {});
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "game-period" && game) { game.period = e.target.value; renderGame(); }
  });

  window.addEventListener("hashchange", route);
  if (!location.hash && prefs.view && TAB_VIEWS.includes(prefs.view)) location.replace(`#/${prefs.view}`);
  route();
  pollStatus();
}

init();
