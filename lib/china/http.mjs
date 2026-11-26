export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET có timeout và thử lại một lần. as: "json" | "text"
export async function get(url, { as = "text", timeout = 25000, retries = 1, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === "json" ? await res.json() : await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(2500);
    }
  }
  throw lastErr;
}

export const stripHtml = (s) => String(s ?? "").replace(/<br[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
