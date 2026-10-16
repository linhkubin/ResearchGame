import gplay from "google-play-scraper";
import store from "app-store-scraper";
import { NUM, CATEGORIES, COLLECTIONS, allCombos } from "./config.mjs";
import { saveSnapshot, logRun, today } from "./db.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const catOf = (key) => CATEGORIES.find((c) => c.key === key);
const colOf = (key) => COLLECTIONS.find((c) => c.key === key);

async function fetchCombo({ store: s, country, category, collection }) {
  const cat = catOf(category);
  const col = colOf(collection);
  if (s === "gplay") {
    const list = await gplay.list({
      category: gplay.category[cat.gplay],
      collection: gplay.collection[col.gplay],
      country, num: NUM, throttle: 5,
    });
    return list.map((x) => ({
      appId: x.appId, title: x.title, developer: x.developer, icon: x.icon, url: x.url,
      score: typeof x.score === "number" ? x.score : null, genre: null, released: null,
    }));
  }
  const list = await store.list({
    category: store.category[cat.ios],
    collection: store.collection[col.ios],
    country, num: Math.min(NUM, 200),
  });
  return list.map((x) => ({
    appId: String(x.id), title: x.title, developer: x.developer, icon: x.icon, url: x.url,
    score: null, genre: x.genre ?? null, released: x.released ?? null, devId: x.developerId ? String(x.developerId) : null,
  }));
}

export const progress = { running: false, done: 0, total: 0, current: null, errors: [] };

// Lấy toàn bộ bảng xếp hạng trong config và lưu snapshot của hôm nay
export async function runFetch() {
  if (progress.running) return false;
  const combos = allCombos();
  const date = today();
  const startedAt = new Date().toISOString();
  Object.assign(progress, { running: true, done: 0, total: combos.length, current: null, errors: [] });
  let ok = 0;
  try {
    for (const combo of combos) {
      progress.current = combo;
      let apps = null;
      for (let attempt = 1; attempt <= 2 && !apps; attempt++) {
        try {
          apps = await fetchCombo(combo);
        } catch (e) {
          if (attempt === 2) progress.errors.push({ ...combo, error: String(e.message ?? e) });
          else await sleep(3000);
        }
      }
      if (apps?.length) {
        saveSnapshot(date, combo, apps);
        ok++;
      }
      progress.done++;
      await sleep(400);
    }
  } finally {
    logRun(startedAt, ok, progress.errors.length, progress.errors);
    progress.running = false;
    progress.current = null;
  }
  return true;
}
