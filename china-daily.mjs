// Lấy dữ liệu tab "Trung Quốc" rồi xuất bản tĩnh vào data/site/china: npm run china
// Quy trình 08:30 (lib/daily.mjs, bước "china") chạy file này trong tiến trình con có giới hạn thời gian.
import { runDaily, dailyStatus } from "./lib/china/daily.mjs";

const stamp = () => new Date().toLocaleString("vi-VN");
const timer = setInterval(() => {
  if (dailyStatus.detail) console.log(`[${stamp()}]   ${dailyStatus.step}: ${dailyStatus.detail}`);
}, 15000);

console.log(`[${stamp()}] Bắt đầu lấy dữ liệu thị trường Trung Quốc`);
const ran = await runDaily((msg) => console.log(`[${stamp()}] ${msg}`));
clearInterval(timer);
if (ran) console.log(`[${stamp()}] Xong${dailyStatus.errors.length ? ` (${dailyStatus.errors.length} lỗi)` : ""}`);
// Request bị bỏ dở do timeout có thể giữ socket mở, làm tiến trình không tự thoát
process.exit(0);
