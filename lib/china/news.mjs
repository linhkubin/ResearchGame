import { createHash } from "node:crypto";
import { db } from "./db.mjs";
import { NEWS_SOURCES, NEWS_MAX_AGE_DAYS } from "./config.mjs";
import { get, stripHtml } from "./http.mjs";
import { vi } from "./translate.mjs";

const field = (item, tag) => {
  const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim() : "";
};

function parseRss(xml) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map(([item]) => {
    const t = new Date(field(item, "pubDate"));
    return {
      title: stripHtml(field(item, "title")),
      link: field(item, "link"),
      published: isNaN(t) ? null : t.toISOString(),
      summary: stripHtml(field(item, "description")).replace(/\s+/g, " ").slice(0, 300),
    };
  });
}

const upsert = db.prepare(`
  INSERT INTO news (id, source, title, link, published, summary, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET title = excluded.title, summary = excluded.summary
`);

export async function runNewsFetch(onError = () => {}) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - NEWS_MAX_AGE_DAYS * 864e5).toISOString();
  let added = 0;
  for (const src of NEWS_SOURCES) {
    try {
      let items = parseRss(await get(src.url)).filter((i) => i.title && i.link);
      if (src.match) items = items.filter((i) => src.match.test(i.title));
      for (const i of items) {
        if (i.published && i.published < cutoff) continue;
        const id = createHash("sha1").update(i.link).digest("hex").slice(0, 16);
        added += Number(upsert.run(id, src.key, i.title, i.link, i.published ?? now, i.summary, now).changes);
      }
    } catch (e) { onError(`tin ${src.name}`, e); }
  }
  db.prepare(`DELETE FROM news WHERE published < ?`).run(cutoff);
  return added;
}

export function listNews({ source = null, q = "", days = 30 } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = db.prepare(
    `SELECT * FROM news WHERE published >= ? ${source ? "AND source = ?" : ""} ORDER BY published DESC LIMIT 400`
  ).all(...(source ? [since, source] : [since]));
  const needle = q.trim().toLowerCase();
  return {
    sources: NEWS_SOURCES.map((s) => ({ key: s.key, name: s.name })),
    items: rows.map((n) => ({ ...n, titleVi: vi(n.title) }))
      .filter((n) => !needle || `${n.title} ${n.titleVi ?? ""} ${n.summary}`.toLowerCase().includes(needle)),
  };
}

export const recentNewsTitles = (days = 14) =>
  db.prepare(`SELECT title FROM news WHERE published >= ?`).all(new Date(Date.now() - days * 864e5).toISOString()).map((r) => r.title);
