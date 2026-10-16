# Chart Tracker

Web theo dõi bảng xếp hạng game trên Google Play và App Store, dùng để phát hiện game đang lên.
Dữ liệu lấy bằng [google-play-scraper](https://github.com/facundoolano/google-play-scraper),
[app-store-scraper](https://github.com/facundoolano/app-store-scraper) và iTunes Lookup API của Apple, không cần API key.

## Chạy

```bash
npm start
```

Mở http://localhost:4317. Hoặc nhấp đúp `start.bat`.

## Cập nhật dữ liệu

Quy trình hằng ngày (`npm run daily`): lấy bảng xếp hạng → lấy game của nhà phát hành đang theo dõi → lấy tin ngành → quét quảng cáo → tạo bản tóm tắt → đăng bản công khai.

- **Task Scheduler**: tác vụ `ChartTracker Daily` chạy lúc 08:30 mỗi ngày (chạy bù khi máy vừa bật nếu lỡ giờ). Log ở `data/daily.log`.
- **Server dự phòng**: khi server đang chạy, sau 08:30 nếu hôm nay chưa có bản tóm tắt thì tự chạy quy trình. Khoá `data/daily.lock` ngăn hai tiến trình chạy chồng nhau.
- Nút **Cập nhật ngay** chạy toàn bộ quy trình (ghi đè dữ liệu cùng ngày).
- Tin ngành còn tự làm mới mỗi 3 giờ khi server chạy.

Gỡ tác vụ: `Unregister-ScheduledTask -TaskName "ChartTracker Daily"` (PowerShell).

## Các trang

- **Ô tìm kiếm** (trên cùng): tìm game hoặc nhà phát hành trong toàn bộ dữ liệu đã theo dõi, không phân biệt dấu. Hiện hạng tốt nhất hiện tại, hoặc lần cuối thấy nếu game đã rơi khỏi chart. Enter mở kết quả đầu.
- **Tổng quan**: theo quốc gia, game tăng từ 10 bậc, game mới vào top 50, game nổi bật trên nhiều bảng.
- **Tóm tắt**: bản tóm tắt mỗi sáng cho các quốc gia trong `DIGEST_COUNTRIES` (mặc định Mỹ, Việt Nam): tín hiệu mạnh, tăng hạng, mới vào top, game mới của nhà phát hành, tin đáng đọc. Xem lại được các ngày trước.
- **Bảng xếp hạng**: top 200 (Google Play) / 100 (App Store) theo store, quốc gia, thể loại, bảng, ngày; lọc theo tên và theo diễn biến (tăng/giảm/mới).
- **Nhà phát hành**: 16 studio theo dõi sẵn (`PUBLISHER_SEEDS`) và các studio bạn thêm. Báo game mới phát hiện; lần lấy đầu của mỗi tài khoản chỉ ghi nhận danh sách gốc.
- **Tin ngành**: tin từ mobilegamer.biz, GameDev Reports, Sensor Tower, Naavik, Deconstructor of Fun, Lancaric, Business of Games, Pocket Gamer, Game Developer, GamesIndustry.biz; gắn thẻ game đang có trong chart.
- **Trang game** (bấm vào bất kỳ game nào): hạng tốt nhất, số bảng đang có mặt, số ngày trong chart, cú tăng lớn nhất; biểu đồ nhiều bảng; bảng thứ hạng từng ngày (xuất CSV); nút theo dõi nhà phát hành; link xem quảng cáo (Meta Ad Library, Google Ads Transparency, TikTok, YouTube).

- **Quảng cáo**: quảng cáo đang chạy trên Meta Ad Library (Facebook, Instagram, Audience Network…) của game đang lên ở Mỹ + top 10 Free/Grossing hai store (tối đa 30 game, quét cùng quy trình hằng ngày, khoảng 30 giây mỗi game). Mỗi game: tìm trang nhà quảng cáo bằng cách khớp App Store ID / package trong link quảng cáo, rồi lấy toàn bộ quảng cáo đang chạy của trang đó. Sắp xếp theo điểm tổng hợp, số ngày chạy, thứ tự lượt hiển thị (Meta tự xếp theo tổng lượt hiển thị nhưng không công bố con số), số bản dùng chung creative, mới nhất; lọc theo game, định dạng, số ngày chạy, chỉ quảng cáo mới. Bấm ảnh để xem video ngay. Trang chi tiết game có nút "Quét quảng cáo" để quét riêng (game đó được thêm vào danh sách quét hằng ngày).
  - Cần Edge hoặc Chrome trên máy (chạy ẩn qua `puppeteer-core`). Cấu hình ở `ADS` trong `lib/config.mjs` (quốc gia, số game, trọng số điểm).
  - Meta không phân biệt playable và không công bố chi tiêu/lượt hiển thị; playable chạy trên AppLovin/Unity/Mintegral cần công cụ trả phí.
  - Link ảnh/video của Meta hết hạn sau vài ngày; quét lại sẽ làm mới.

## Bản công khai (GitHub Pages)

Web chỉ xem tại **https://linhkubin.github.io/ResearchGame/**, cập nhật từ máy này:

- Cuối quy trình hằng ngày, `lib/export.mjs` xuất mọi dữ liệu thành file JSON + icon (WebP 96px) vào `data/site`, rồi force-push lên nhánh `gh-pages` (mỗi lần một commit duy nhất để nhánh không phình).
- Trên bản công khai, `public/static-api.js` đọc các file JSON thay cho server; các nút cập nhật, theo dõi/bỏ theo dõi, quét quảng cáo bị ẩn. Bảng xếp hạng chỉ có ngày mới nhất; trang game chỉ xuất cho game có trong chart 60 ngày gần nhất (`PUBLISH.gameDays`).
- Đăng tay: `npm run publish`. Chỉ xuất để xem thử: `npm run export` rồi mở `data/site` bằng một web server tĩnh.
- Tắt đăng tự động: `PUBLISH.enabled = false` trong `lib/config.mjs`.
- Dữ liệu trên bản công khai ai có link cũng xem được.

Mục tăng hạng cần ít nhất 2 ngày dữ liệu.

## Tuỳ chỉnh

Sửa `lib/config.mjs` rồi khởi động lại server: quốc gia, thể loại, bảng, số app mỗi bảng, nguồn tin (`NEWS_SOURCES`), nhà phát hành (`PUBLISHER_SEEDS`), giờ chạy (`DAILY_TIME`, nhớ sửa cả giờ trong Task Scheduler), quốc gia tóm tắt (`DIGEST_COUNTRIES`), link quảng cáo (`AD_LINKS`).

## Lưu ý

- Đây là scraper, không phải API chính thức: có thể hỏng khi store đổi giao diện. Khi đó chạy `npm update`.
- Độ sâu tối đa: Google Play 200 mỗi bảng, App Store 100. Danh sách game của nhà phát hành: Google Play tối đa ~100, App Store tối đa 200.
- Chỉ có thứ hạng, band lượt cài, số đánh giá và điểm; không có số lượt tải/doanh thu chính xác.
- Dữ liệu lưu ở `data/charts.db` (SQLite), icon ở `data/icons/`.
