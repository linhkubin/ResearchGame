// Xuất bản web tĩnh vào data/site và đẩy lên GitHub Pages.
//   npm run publish            xuất + đẩy
//   npm run export             chỉ xuất (xem thử bằng: npx serve data/site)
import { exportSite, publishSite, exportStatus } from "./lib/export.mjs";

const pushToo = !process.argv.includes("--no-push");
const t = Date.now();
const r = await exportSite();
console.log(`Đã xuất ${r.files} file JSON, ${r.icons} icon trong ${((Date.now() - t) / 1000).toFixed(1)} giây.`);
if (pushToo) {
  publishSite();
  console.log("Đã đẩy lên GitHub Pages.", exportStatus.publishedAt);
}
