// Quy trình hằng ngày (dùng cho Task Scheduler): npm run daily
import { runDaily, dailyStatus } from "./lib/daily.mjs";
import { progress } from "./lib/fetcher.mjs";

const stamp = () => new Date().toLocaleString("vi-VN");
const timer = setInterval(() => {
  if (dailyStatus.step === "charts") console.log(`[${stamp()}] bảng xếp hạng ${progress.done}/${progress.total}`);
}, 15000);

console.log(`[${stamp()}] Bắt đầu quy trình hằng ngày`);
await runDaily((msg) => console.log(`[${stamp()}] ${msg}`));
clearInterval(timer);
console.log(`[${stamp()}] Xong${dailyStatus.error ? ` (có lỗi: ${dailyStatus.error})` : ""}`);
