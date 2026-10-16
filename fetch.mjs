// Lấy dữ liệu một lần rồi thoát (dùng cho Task Scheduler hoặc chạy tay): npm run fetch
import { runFetch, progress } from "./lib/fetcher.mjs";

const timer = setInterval(() => {
  const c = progress.current;
  if (c) console.log(`[${progress.done}/${progress.total}] ${c.store} ${c.country} ${c.category} ${c.collection}`);
}, 5000);

await runFetch();
clearInterval(timer);
console.log(`Xong: ${progress.done - progress.errors.length}/${progress.total} bảng.`);
for (const e of progress.errors) console.log("Lỗi:", e.store, e.country, e.category, e.collection, "-", e.error);
