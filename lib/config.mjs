// Cấu hình theo dõi. Sửa danh sách dưới đây rồi khởi động lại server.

export const PORT = 4317;

// Số app lấy mỗi bảng xếp hạng. Thực tế store chỉ trả tối đa:
// Google Play 200 (một số bảng ít hơn), App Store 100 (Apple giới hạn dù thư viện cho xin 200)
export const NUM = 200;

// Số ngày hiển thị trên sparkline
export const SPARK_DAYS = 14;

export const STORES = [
  { key: "gplay", name: "Google Play" },
  { key: "ios", name: "App Store" },
];

export const COUNTRIES = [
  { code: "us", name: "Mỹ" },
  { code: "vn", name: "Việt Nam" },
  { code: "in", name: "Ấn Độ" },
  { code: "br", name: "Brazil" },
  { code: "gb", name: "Anh" },
];

// gplay / ios: tên hằng số trong thư viện scraper; null = store đó không có mục này
export const CATEGORIES = [
  { key: "all", name: "Tất cả game", gplay: "GAME", ios: "GAMES" },
  { key: "puzzle", name: "Puzzle", gplay: "GAME_PUZZLE", ios: "GAMES_PUZZLE" },
  { key: "casual", name: "Casual", gplay: "GAME_CASUAL", ios: null },
  { key: "arcade", name: "Arcade", gplay: "GAME_ARCADE", ios: "GAMES_ARCADE" },
];

export const COLLECTIONS = [
  { key: "free", name: "Top miễn phí", gplay: "TOP_FREE", ios: "TOP_FREE_IOS" },
  { key: "grossing", name: "Top doanh thu", gplay: "GROSSING", ios: "TOP_GROSSING_IOS" },
];

// Nguồn tin ngành. type "rss" (RSS/Atom) hoặc "sensortower" (trang blog, không có RSS).
// mobileOnly: nguồn tổng hợp cả PC/console, chỉ giữ bài có nhắc tới mobile.
export const NEWS_SOURCES = [
  { key: "mobilegamer", name: "mobilegamer.biz", type: "rss", url: "https://mobilegamer.biz/feed/" },
  { key: "gdr", name: "GameDev Reports", type: "rss", url: "https://gamedevreports.substack.com/feed" },
  { key: "sensortower", name: "Sensor Tower", type: "sensortower", url: "https://sensortower.com/blog" },
  { key: "naavik", name: "Naavik", type: "rss", url: "https://naavik.co/feed/" },
  { key: "dof", name: "Deconstructor of Fun", type: "rss", url: "https://www.deconstructoroffun.com/blog?format=rss" },
  { key: "lancaric", name: "Lancaric (UA/Playable)", type: "rss", url: "https://lancaric.substack.com/feed" },
  { key: "bog", name: "Business of Games", type: "rss", url: "https://businessofgames.icartic.com/feed" },
  { key: "pocketgamer", name: "Pocket Gamer", type: "rss", url: "https://www.pocketgamer.com/news/index.rss" },
  { key: "gamedeveloper", name: "Game Developer", type: "rss", url: "https://www.gamedeveloper.com/rss.xml", mobileOnly: true },
  { key: "gibiz", name: "GamesIndustry.biz", type: "rss", url: "https://www.gamesindustry.biz/feed", mobileOnly: true },
];

// Bỏ tin cũ hơn số ngày này
export const NEWS_MAX_AGE_DAYS = 120;
// Chu kỳ tự làm mới tin khi server chạy
export const NEWS_REFRESH_HOURS = 3;

// Nhà phát hành theo dõi sẵn. gplay/ios: regex khớp đúng tên tài khoản nhà phát hành trên store
// (một studio có thể có nhiều tài khoản, vd Lion Studios / Lion Studios Plus).
export const PUBLISHER_SEEDS = [
  { name: "Voodoo", gplay: /^VOODOO$/i, ios: /^Voodoo$/i },
  { name: "Rollic Games", gplay: /^Rollic Games$/i, ios: /^Rollic Games$/i },
  { name: "Supersonic", gplay: /^Supersonic Studios LTD$/i, ios: /^Supersonic Studios LTD$/i },
  { name: "SayGames", gplay: /^SayGames Ltd$/i, ios: /^SayGames LTD$/i },
  { name: "CrazyLabs", gplay: /^CrazyLabs LTD$/i, ios: /^Crazy Labs$/i },
  { name: "Homa", gplay: /^Homa$/i, ios: /^HOMA GAMES$/i },
  { name: "Lion Studios", gplay: /^Lion Studios( Plus)?$/i, ios: /^Lion Studios( Plus)?$/i },
  { name: "Grand Games", gplay: /^Grand Games A\.Ş\.$/i, ios: /^Grand Games A\.Ş\.$/i },
  { name: "Learnings (Oakever Games)", term: "Oakever Games", gplay: /^Oakever Games$/i, ios: /^Oakever Games$/i },
  { name: "Dream Games", gplay: /^Dream Games(, Ltd\.)?$/i, ios: /^Dream Games(, Ltd\.)?$/i },
  { name: "Peak", term: "Peak Games", gplay: /^Peak$/i, ios: /^Peak( Games)?$/i },
  { name: "Century Games", gplay: /^Century Games (Innovation )?Pte\. Ltd\.$/i, ios: /^Century Games (Innovation )?Pte\. Ltd\.$/i },
  { name: "Easybrain", gplay: /^Easybrain$/i, ios: /^Easybrain Ltd$/i },
  { name: "Lumi Games", gplay: /^Lumi Games$/i, ios: /^Lumi Games$/i },
  { name: "ABI Games", gplay: /^ABI GAMES PTE\. LTD\.$/i, ios: /^(ABI GLOBAL LTD\.|ABIGAMES PTE\. LTD)$/i },
  { name: "Miniclip", gplay: /^Miniclip\.com$/i, ios: /^Miniclip\.com$/i },
];
// Số app tối đa lấy mỗi nhà phát hành
export const PUBLISHER_MAX_APPS = 120;

// Giờ chạy quy trình hằng ngày (lấy chart, nhà phát hành, tin, tạo tóm tắt)
export const DAILY_TIME = "08:30";
// Quốc gia đưa vào bản tóm tắt mỗi sáng
export const DIGEST_COUNTRIES = ["us", "vn"];

// Link xem quảng cáo. {q} = tên game, {dev} = nhà phát hành, {devq} = nhà phát hành đã bỏ hậu tố "Ltd", "A.Ş."… (đã mã hoá URL).
// copy: sao chép tên vào clipboard trước khi mở (trang không nhận từ khoá qua URL).
// count: hiện số quảng cáo của game trên thư viện đó ("meta", "apple", "google"; xem lib/adcounts.mjs).
export const AD_LINKS = [
  { name: "Meta Ad Library", count: "meta", desc: "Facebook, Instagram, Audience Network",
    url: "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&media_type=all&search_type=keyword_unordered&q={q}" },
  { name: "Apple Ad Repository", count: "apple", desc: "Quảng cáo App Store ở các nước EU", copy: "q",
    url: "https://adrepository.apple.com/" },
  { name: "Google Ads Transparency", count: "google", desc: "Google, YouTube, AdMob · tìm theo nhà phát hành", copy: "dev",
    url: "https://adstransparency.google.com/?region=anywhere" },
  // adv_name khớp tên nhà quảng cáo (pháp nhân), không khớp tên game; không có ngoặc kép thì TikTok tìm mờ ra công ty khác
  { name: "TikTok Ad Library", desc: "Quảng cáo TikTok khu vực EU · tìm theo nhà phát hành",
    url: "https://library.tiktok.com/ads?region=all&adv_name=%22{devq}%22&query_type=1&sort_type=last_shown_date,desc" },
  { name: "TikTok Creative Center", desc: "Top Ads theo ngành game", copy: "q",
    url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=&industry=game" },
  { name: "YouTube: quảng cáo", desc: "Video quảng cáo được đăng lại",
    url: "https://www.youtube.com/results?search_query=%22{q}%22+game+ads" },
  { name: "YouTube: gameplay", desc: "Gameplay thật để so với quảng cáo",
    url: "https://www.youtube.com/results?search_query=%22{q}%22+gameplay" },
];

// Kho quảng cáo (tab Quảng cáo): Meta Ad Library, App Store (Apple Ad Repository), Google Ads Transparency.
// Meta cần Edge hoặc Chrome trên máy (chạy ẩn qua puppeteer-core).
export const ADS = {
  // Chạy cùng quy trình hằng ngày (mất khoảng 15-25 giây mỗi game)
  daily: true,
  // Chọn game: game đang lên ở các quốc gia này + top N bảng "Tất cả game" (miễn phí, doanh thu)
  countries: ["us"],
  topN: 10,
  maxGames: 30,
  // Số lần cuộn trang khi lấy quảng cáo của một nhà quảng cáo (mỗi lần ~10 nhóm quảng cáo)
  pageScrolls: 8,
  // Quốc gia lọc trên Ad Library: "ALL" hoặc mã như "US"
  adCountry: "ALL",
  // Bỏ trống để tự tìm Edge/Chrome
  browserPath: "",
  // Trọng số điểm xếp hạng (tổng = 1): số ngày chạy, thứ tự lượt hiển thị Meta trả về,
  // số bản dùng chung creative, số nền tảng
  weights: { days: 0.4, impressions: 0.3, variants: 0.2, platforms: 0.1 },
  // Quảng cáo bắt đầu chạy trong số ngày này được gắn nhãn "mới"
  newDays: 14,
  // Quảng cáo đã dừng (App Store, Google) vẫn hiện nhưng điểm nhân hệ số này
  stoppedFactor: 0.7,
  // App Store: Apple Ad Repository, 25 nước EU, 90 ngày gần nhất
  apple: true,
  // Google Ads Transparency: lấy tối đa N quảng cáo mới nhất của nhà quảng cáo, mỗi lượt quét đọc nội dung
  // tối đa googleMaxFetch quảng cáo chưa từng đọc (mỗi cái ~150-400KB, đọc một lần rồi lưu lại)
  google: true,
  googleMaxCreatives: 120,
  googleMaxFetch: 80,
};

// Đăng bản web tĩnh (chỉ đọc) lên GitHub Pages sau mỗi lần chạy quy trình hằng ngày.
// Bản tĩnh được xuất vào data/site rồi force-push lên nhánh `branch` của `repo`.
export const PUBLISH = {
  enabled: true,
  repo: "https://github.com/linhkubin/ResearchGame.git",
  branch: "gh-pages",
  // Chỉ xuất trang chi tiết cho game có trong chart trong số ngày này
  gameDays: 60,
};

// Mọi tổ hợp store × quốc gia × thể loại × bảng mà store hỗ trợ
export function allCombos() {
  const combos = [];
  for (const s of STORES)
    for (const c of COUNTRIES)
      for (const cat of CATEGORIES) {
        if (!cat[s.key]) continue;
        for (const col of COLLECTIONS)
          combos.push({ store: s.key, country: c.code, category: cat.key, collection: col.key });
      }
  return combos;
}
