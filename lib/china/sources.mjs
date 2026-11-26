// Lấy bảng xếp hạng từ từng nguồn. Mỗi hàm gọi onBoard(board, apps) cho từng bảng lấy được,
// và onError(tên bảng, lỗi) khi một bảng hỏng (các bảng khác vẫn chạy tiếp).
import { IOS, TAPTAP, MINIGAME, TENCENT, XIAOMI } from "./config.mjs";
import { get, sleep, stripHtml } from "./http.mjs";
import { db } from "./db.mjs";

// ---------- App Store Trung Quốc ----------
export async function fetchIos(onBoard, onError) {
  let ord = 0;
  for (const cat of IOS.categories)
    for (const col of IOS.collections) {
      const board = { key: `${col.key}-${cat.key}`, name: `${col.name} · ${cat.name}`, ord: ord++ };
      try {
        const j = await get(
          `https://itunes.apple.com/${IOS.country}/rss/${col.feed}/limit=${IOS.limit}/genre=${cat.genre}/json`, { as: "json" });
        const entries = [].concat(j.feed?.entry ?? []);
        onBoard(board, entries.map((e) => ({
          appId: e.id?.attributes?.["im:id"],
          title: e["im:name"]?.label,
          developer: e["im:artist"]?.label ?? null,
          icon: e["im:image"]?.at(-1)?.label ?? null,
          url: (e.id?.label ?? "").replace(/\?uo=\d+$/, ""),
          genre: e.category?.attributes?.label ?? null,
          descr: (e.summary?.label ?? "").slice(0, 1500),
          released: (e["im:releaseDate"]?.label ?? "").slice(0, 10) || null,
        })));
      } catch (e) { onError(`ios ${board.key}`, e); }
      await sleep(300);
    }
}

// ---------- TapTap ----------
const TAP_UA = "X-UA=" + encodeURIComponent("V=1&PN=WebApp&LANG=zh_CN&VN_CODE=102&LOC=CN&PLT=PC&DS=Android&OS=Windows");
const tapUrl = (path, params) => `https://www.taptap.cn/webapiv2/${path}?${params}&${TAP_UA}`;

function tapApp(a) {
  const st = a.stat ?? {};
  return {
    appId: String(a.id),
    title: a.title,
    icon: a.icon?.medium_url ?? a.icon?.url ?? null,
    url: `https://www.taptap.cn/app/${a.id}`,
    tags: (a.tags ?? []).map((t) => t.value).filter(Boolean),
    tagline: a.rec_text || null,
    descr: stripHtml(a.description?.text ?? "").slice(0, 1500) || null,
    score: Number(st.rating?.score) || null,
    stats: {
      hits: st.hits_total ?? null, fans: st.fans_count ?? null, reserve: st.reserve_count ?? null,
      reviews: st.review_count ?? null, labels: a.title_labels ?? [],
    },
    released: a.released_time ? new Date(a.released_time * 1000).toLocaleDateString("sv-SE") : null,
  };
}

export async function fetchTapTap(onBoard, onError) {
  let ord = 0;
  for (const b of TAPTAP.boards) {
    const board = { ...b, ord: ord++ };
    const apps = [];
    try {
      for (let from = 0; from < TAPTAP.limit; from += 10) {
        const j = await get(tapUrl("app-top/v2/hits", `from=${from}&limit=10&platform=android&type_name=${b.key}`), { as: "json" });
        if (!j.success) throw new Error(j.data?.msg ?? "TapTap từ chối");
        const list = (j.data.list ?? []).filter((x) => x.app && !x.is_ad);
        apps.push(...list.map((x) => tapApp(x.app)));
        if (!j.data.next_page || !list.length) break;
        await sleep(250);
      }
      if (apps.length) onBoard(board, apps);
    } catch (e) {
      // Lấy được một phần vẫn lưu, để hôm đó không trống hẳn
      if (apps.length >= 20) onBoard(board, apps);
      onError(`taptap ${b.key}`, e);
    }
  }
}

// Bảng xếp hạng TapTap không có tên nhà phát triển: tra trang chi tiết cho game chưa có (mỗi game một lần)
export async function fillTapTapDevelopers(onProgress = () => {}) {
  const todo = db.prepare(
    `SELECT app_id FROM apps WHERE source = 'taptap' AND developer IS NULL ORDER BY last_seen DESC, first_seen DESC LIMIT ?`
  ).all(TAPTAP.maxDetailLookups);
  const set = db.prepare(`UPDATE apps SET developer = ?, descr = COALESCE(?, descr) WHERE source = 'taptap' AND app_id = ?`);
  let done = 0, fails = 0;
  for (const { app_id } of todo) {
    try {
      const j = await get(tapUrl("app/v4/detail", `id=${app_id}`), { as: "json", retries: 0 });
      const a = j.data?.app ?? j.data ?? {};
      const info = [].concat(a.information ?? []);
      const pick = (...titles) => info.find((i) => titles.includes(i.title) && i.text)?.text;
      // "" = đã tra nhưng không có, để lần sau không tra lại
      set.run(pick("厂商", "开发商", "开发") ?? pick("发行商", "发行", "供应商") ?? "",
        stripHtml(a.description?.text ?? "").slice(0, 1500) || null, app_id);
      fails = 0;
    } catch {
      if (++fails >= 5) break;
    }
    onProgress(++done, todo.length);
    await sleep(200);
  }
  return done;
}

// ---------- Mini game WeChat / Douyin (引力引擎) ----------
const realName = (s) => (s && !/^\d+$/.test(String(s)) ? String(s) : null);

export async function fetchMiniGames(onBoard, onError) {
  for (const src of MINIGAME.sources) {
    try {
      const html = await get(src.url);
      const m = html.match(/id="rank-initial-state"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) throw new Error("trang đổi cấu trúc: không thấy rank-initial-state");
      const state = JSON.parse(m[1]);
      state.ranks.forEach((r, ord) => {
        const board = { key: r.type, name: MINIGAME.boardNames[r.title] ?? r.title, zh: r.title, ord };
        const apps = (r.data?.list ?? []).filter((x) => x.app_info?.app_name).map((x) => {
          const i = x.app_info;
          const main = realName(i.game_type_main_name), sub = realName(i.game_type_sub_name);
          return {
            appId: String(i.app_id),
            title: i.app_name,
            developer: realName(i.publisher_name),
            icon: i.icon_url ?? null,
            url: src.url,
            genre: main,
            tags: [main, sub].filter(Boolean),
            tagline: (i.description || i.subtitle || "").slice(0, 200) || null,
            stats: { note: x.change_label?.first_msg ?? null, miniAppId: i.mini_app_id ?? null },
          };
        });
        if (apps.length) onBoard(board, apps, src.key);
      });
    } catch (e) { onError(`${src.key} mini game`, e); }
    await sleep(500);
  }
}

// ---------- Tencent 应用宝 (sj.qq.com) ----------
// Trang Next.js: dữ liệu bảng nằm trong __NEXT_DATA__ → dynamicCardResponse
const TENCENT_SKIP_TAGS = new Set(["支持iOS", "可预约", "腾讯", "网易", "端游移植"]);

export async function fetchTencent(onBoard, onError) {
  let ord = 0;
  for (const b of TENCENT.boards) {
    const board = { key: b.key, name: b.name, zh: b.zh, ord: ord++ };
    try {
      const html = await get(`https://sj.qq.com/${b.path}`);
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) throw new Error("trang đổi cấu trúc: không thấy __NEXT_DATA__");
      const comps = JSON.parse(m[1]).props?.pageProps?.dynamicCardResponse?.data?.components ?? [];
      const items = comps.find((c) => c.data?.itemData?.length)?.data.itemData ?? [];
      const apps = items.filter((x) => x.name && x.pkg_name).map((x) => {
        const tags = String(x.tags ?? "").split(",").map((t) => t.trim()).filter((t) => t && !TENCENT_SKIP_TAGS.has(t));
        return {
          appId: x.pkg_name,
          title: x.name,
          developer: x.developer || x.operator || null,
          icon: x.icon ?? null,
          url: `https://sj.qq.com/appdetail/${x.pkg_name}`,
          genre: x.cate_name_new || tags[0] || null,
          tags: tags.slice(0, 6),
          tagline: x.editor_intro || null,
          score: Number(x.average_rating) || null,
          stats: { publisher: x.operator || null, booking: x.is_booking === "1" || undefined },
        };
      });
      if (!apps.length) throw new Error("bảng trống");
      onBoard(board, apps);
    } catch (e) { onError(`tencent ${b.key}`, e); }
    await sleep(500);
  }
}

// ---------- Xiaomi (app.mi.com) ----------
export async function fetchXiaomi(onBoard, onError) {
  let ord = 0;
  for (const b of XIAOMI.boards) {
    const board = { key: b.key, name: b.name, zh: b.zh, ord: ord++ };
    const apps = [];
    try {
      for (let page = 0; apps.length < XIAOMI.limit; page++) {
        const j = await get(`https://app.mi.com/categotyAllListApi?page=${page}&categoryId=${b.category}&pageSize=30`, { as: "json" });
        const list = (j.data ?? []).filter((a) => a.displayName && a.packageName);
        apps.push(...list.map((a) => {
          let cn = null;
          try { cn = JSON.parse(a.ratingScoreJson ?? "{}").CN || null; } catch { /* bỏ qua */ }
          return {
            appId: a.packageName,
            title: a.displayName,
            developer: a.publisherName || null,
            icon: a.icon ?? null,
            url: `https://app.mi.com/details?id=${a.packageName}`,
            genre: a.level2CategoryName || a.level1CategoryName || null,
            tags: [a.level2CategoryName].filter(Boolean),
            tagline: a.brief || null,
            descr: stripHtml(a.introduction ?? "").slice(0, 1500) || null,
            score: cn,
            stats: { reviews: a.ratingTotalCount ?? null },
          };
        }));
        if (!j.hasNext || !list.length) break;
        await sleep(300);
      }
      if (apps.length) onBoard(board, apps.slice(0, XIAOMI.limit));
    } catch (e) {
      if (apps.length >= 20) onBoard(board, apps);
      onError(`xiaomi ${b.key}`, e);
    }
  }
}
