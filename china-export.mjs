// Chỉ xuất lại dữ liệu tĩnh của tab "Trung Quốc" vào data/site/china (không lấy dữ liệu mới): npm run china-export
import { runExport } from "./lib/china/export.mjs";

const t = Date.now();
const r = await runExport({ log: console.log });
if (r) console.log(`Xong trong ${((Date.now() - t) / 1000).toFixed(1)} giây.`);
// Request dịch bị bỏ dở do timeout có thể giữ socket mở, làm tiến trình không tự thoát
process.exit(0);
