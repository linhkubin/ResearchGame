# Tab "Trung Quốc"

Theo dõi game thị trường Trung Quốc để tìm ý tưởng, ngay trong web Chart Tracker (http://localhost:4317/#/china, bản công khai https://linhkubin.github.io/ResearchGame/#/china). Trước 25/11/2026 phần này là web riêng `china-tracker/` (cổng 4318) nhúng bằng iframe; nay đã gộp hẳn vào Chart Tracker.

## Chạy

```
npm run china          # lấy dữ liệu Trung Quốc hôm nay rồi xuất dữ liệu tĩnh: khoảng 3–5 phút
npm run china-export   # chỉ xuất lại dữ liệu tĩnh vào data/site/china
```

Quy trình 08:30 của Chart Tracker (`npm run daily`) đã có bước "china" (chạy `china-daily.mjs` trong tiến trình con, tối đa 45 phút) trước bước đăng, nên không cần lịch riêng. Trên web máy còn có nút "Cập nhật Trung Quốc" trong tab.

- Mã: `lib/china/` (nguồn, database, thể loại, xuất tĩnh), API `/api/china/…` ở `lib/china/routes.mjs`, giao diện `public/china.js`.
- Dữ liệu: `data/china.db` (SQLite riêng, không chung với `charts.db`).
- Mỗi lúc chỉ một lần lấy dữ liệu Trung Quốc được chạy (khoá trong bảng `locks` của `china.db`). Lần thứ hai, dù từ nút trên web, `npm run china` hay quy trình 08:30, tự bỏ qua. Khoá của tiến trình đã chết hoặc giữ quá 90 phút được coi là hết hạn.

## Nguồn dữ liệu

| Nguồn | Lấy gì | Giới hạn |
|---|---|---|
| Mini game WeChat | Bảng 人气 / 畅销 / 畅玩 theo ngày, từ trang công khai `rank.gravity-engine.com` (引力引擎) | Chỉ top 20 mỗi bảng; top 100 cần đăng nhập |
| Mini game Douyin | Bảng 热门 / 畅销 / 新游 / 发行人热度, cùng trang trên | Chỉ top 20 mỗi bảng |
| TapTap | 9 bảng Android: thịnh hành, game mới, đặt trước, chơi nhiều, casual, idle, quản lý, roguelike, indie | Tối đa 150 game mỗi bảng |
| App Store Trung Quốc | Top miễn phí và top doanh thu: tất cả game, puzzle, casual, mô phỏng, chiến thuật | 100 game mỗi bảng |
| Tencent 应用宝 | Bảng 热门 / 新游 / 预约 trên `sj.qq.com` (dữ liệu SSR) | 20 game mỗi bảng |
| Xiaomi | Danh mục game trên `app.mi.com` (tất cả, casual, chạy/vượt màn, chiến thuật, hành động, RPG), xếp theo độ phổ biến | Tối đa 90 game mỗi danh mục; tên game thường kèm chữ quảng cáo sau dấu "-" |
| Tin ngành | RSS của GameLook, 游戏茶馆, 36Kr (lọc bài về game) | |

Tên game, thể loại, câu giới thiệu và tiêu đề tin được dịch sang tiếng Việt qua Google Translate (endpoint công khai, không cần key); mỗi chuỗi chỉ dịch một lần rồi lưu lại. Google chặn tạm (HTTP 429) khi dịch nhiều trong thời gian ngắn; khi đó bước dịch dừng và để lần sau. Tắt ở `TRANSLATE.enabled` trong `lib/china/config.mjs`.

### Ghi chú kỹ thuật từng nguồn (`lib/china/sources.mjs`)

- **TapTap**: API `webapiv2/app-top/v2/hits` bắt buộc có tham số `X-UA` (xem `tapUrl`) và User-Agent kiểu trình duyệt. `limit` tối đa 10 mỗi request (lớn hơn báo lỗi validation); mỗi bảng tối đa 150 game, bảng danh mục chỉ 50. Bảng sell/pop với `platform=ios` trả rỗng. Danh sách không có tên nhà phát triển: gọi `app/v4/detail` cho từng game (trường `information`, mục 厂商), nghỉ 200 ms mỗi lần, dừng sau 5 lỗi liên tiếp. Game ở bảng đặt trước có `released = null`. Bỏ các mục `is_ad`.
- **Mini game WeChat/Douyin** (`rank.gravity-engine.com`): dữ liệu nằm trong thẻ `script#rank-initial-state` của trang SSR; công khai chỉ top 20 mỗi bảng. Douyin đôi khi trả `game_type_main_name` là số ("1") và `publisher_name` là "--": coi cả hai là null.
- **App Store Trung Quốc**: feed RSS iTunes, tối đa 100 game mỗi bảng; thể loại luôn là "游戏", thể loại thật chỉ suy ra từ bảng game đang có mặt (vd free-puzzle).
- **Google Translate** (endpoint `client=gtx`, POST): gộp tới 40 chuỗi hoặc 1600 ký tự mỗi request, nối bằng "\n"; số dòng trả về lệch thì dịch lại từng chuỗi. Dịch nhiều sẽ bị 429 vài giờ đến vài ngày (23/11/2026 bị chặn sau khoảng 300 request, 25/11 mới mở). Mỗi chuỗi dịch một lần, lưu ở bảng `tr`.
- **Tin ngành**: GameLook, 游戏茶馆, 36Kr (lọc tiêu đề theo regex) chạy được. Feed 游戏葡萄 trả 404; 游戏陀螺, 竞核, GameRes, 手游那点事 không vào được từ máy này.
- **Icon**: link thẳng CDN (gravity OSS, tapimg, mzstatic, file.market.xiaomi.com, pp.myapp.com) hiện được trên GitHub Pages với referrer "no-referrer"; không cần chép icon như Google Play.
- **Thể loại / puzzle** (`genres.mjs`): game chỉ có tag puzzle mà mang thể loại xung đột (action, moba, rpg, towerdef, sandbox, racing, roguelike, strategy) không được tính là puzzle. `genreIndex()` phân loại theo cụm đủ mọi nguồn (theo `nameKey`), để khi lọc kênh mini game, 向僵尸开炮 không thành puzzle chỉ vì WeChat gắn "益智". Bộ nhớ đệm `boardsNow`/`genreIndex` lấy `MAX(rowid)` của bảng `ranks` làm khoá.
- **Lịch sử**: "mới vào bảng", "tăng mạnh", "lần đầu lên bảng" cần dữ liệu từ những ngày trước (có từ 23/11/2026); ngày đầu có dữ liệu của mỗi nguồn không được tính là "lần đầu". Đừng xoá `data/china.db` để lấy lại từ đầu.
- **Bảng `runs`**: lần chạy được ghi trước bước xuất (rồi cập nhật lại khi xong), nếu không bản tĩnh sẽ hiện giờ của lần chạy trước.

## Các tab phụ (`#/china/<tab>`)

- **Bảng tổng hợp** (mặc định): gộp cùng một game ở mọi nguồn theo tên. Mỗi nguồn lấy bảng tốt nhất của game: hạng 1 được 100 điểm, hạng cuối gần 0; cộng điểm các nguồn. Lọc theo kênh (app store / mini game) và thể loại. Bảng "đặt trước" không tính điểm (`AGGREGATE` trong `lib/china/config.mjs`).
- **Game mới**: mới phát hành trong 7/14/30/60 ngày (chỉ App Store và TapTap có ngày phát hành), đang ở bảng "game mới" của nền tảng (TapTap 新品, 应用宝 新游, Douyin 新游), sắp ra mắt (bảng đặt trước), lần đầu lên bảng. Lọc theo loại, số ngày, kênh, thể loại; sắp theo ngày phát hành, hạng tốt nhất, hoặc theo dõi + đặt trước trên TapTap (`NEW_GAMES`).
- **Puzzle**: mọi game puzzle đang có mặt trên bảng, xếp theo điểm của Bảng tổng hợp; thẻ cho từng kiểu, bấm để lọc.
- **Bilibili** (`lib/china/videos.mjs`): video khu Game đăng trong 30 ngày, tìm mỗi ngày theo từ khoá về game mới và theo tên 40 game của tab Game mới (`VIDEOS` trong `lib/china/config.mjs`), sắp theo lượt thích; lưu số liệu mỗi ngày (`video_stats`) để tính mức tăng. Dùng API tìm kiếm công khai (`tids=4` = khu Game, `pubtime_begin_s`), không cần đăng nhập; chỉ cần cookie `buvid3` lấy từ trang chủ. Gọi nhanh quá sẽ bị chặn (-412), nên cách nhau 1,5 giây. Video được tính là puzzle khi thuộc một game mới đã phân loại puzzle, hoặc tìm thấy qua từ khoá trong `VIDEOS.puzzleTerms`.
- **Douyin: chưa có.** Không đăng nhập thì Douyin trả trang mã xác minh (CAPTCHA), không tìm cách vượt. `fetchDouyin()` trong `videos.mjs` đã viết sẵn (mở trang tìm kiếm bằng Edge ẩn với cookie tài khoản phụ ở `data/douyin-cookie.txt`, đọc phản hồi API của trang) nhưng chưa gắn vào quy trình hay giao diện, vì chưa có tài khoản để thử. Muốn bật: thêm bước gọi trong `lib/china/daily.mjs`, dòng xuất `videos/douyin.json` trong `export.mjs`, và tab phụ `douyin` (dùng lại `renderVideos`) trong `public/china.js`/`index.html`.
- **Tổng quan**, **Bảng xếp hạng**, **Thể loại**, **Tin ngành**, **Tìm game**. Bấm một game để xem mô tả (đã dịch), lịch sử thứ hạng 30 ngày và link tra cứu (Bilibili, Douyin, Xiaohongshu, YouTube).

Thể loại chuẩn hoá ở `lib/china/genres.mjs`: tag tiếng Trung của TapTap / 应用宝 / Xiaomi, thể loại của WeChat / Douyin và bảng đang có mặt được quy về khoảng 18 nhóm. Kiểu puzzle đoán từ tên tiếng Trung theo từ khoá; key kiểu giống `public/puzzle.js` (thêm "chess" cho cờ). Phân loại tự động nên có thể lệch.

## Bản công khai

`lib/china/export.mjs` xuất mỗi API thành file JSON trong `data/site/china/data` (bước cuối của `npm run china`). `staticChina` trong `public/china.js` đọc lại các file này khi `window.STATIC_SITE`. Lệnh đăng của Chart Tracker chỉ xoá `data/` và `icons/` của nó trong `data/site`, không đụng `china/`.

- Chỉ có ngày dữ liệu mới nhất; lịch sử 30 ngày nằm trong trang chi tiết game.
- Không gọi được Google Translate: mỗi lần xuất dịch sẵn mô tả cho tối đa 150 game chưa có bản dịch, hạng cao trước.
- Icon dùng thẳng link ảnh của store (`referrerpolicy="no-referrer"`).
- Thêm API `/api/china/…` hoặc tham số mới thì sửa cả `lib/china/routes.mjs`, `lib/china/export.mjs` và `staticChina` trong `public/china.js`.

## Chưa có

- Quảng cáo: Meta/Google/TikTok không phủ Trung Quốc; dữ liệu nằm ở DataEye, AppGrowing, 广大大 (trả phí, cần đăng nhập).
- Huawei AppGallery: API web đòi mã xác thực riêng (Interface-Code), không lấy tự động được; không tìm cách vượt qua. OPPO / vivo / Honor chưa có trang web công khai cho bảng xếp hạng.
- Danh sách cấp phép 版号 của NPPA: `nppa.gov.cn` không truy cập được từ máy này.
