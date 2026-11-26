// Cấu hình tab "Trung Quốc" (thị trường game Trung Quốc). Sửa xong phải khởi động lại server Chart Tracker.

// Số ngày hiển thị trên biểu đồ lịch sử thứ hạng
export const HISTORY_DAYS = 30;

// App Store Trung Quốc: feed RSS của iTunes, tối đa 100 game mỗi bảng
export const IOS = {
  country: "cn",
  limit: 100,
  collections: [
    { key: "free", name: "Miễn phí", feed: "topfreeapplications" },
    { key: "grossing", name: "Doanh thu", feed: "topgrossingapplications" },
  ],
  categories: [
    { key: "all", name: "Tất cả game", genre: 6014 },
    { key: "puzzle", name: "Puzzle", genre: 7012 },
    { key: "casual", name: "Casual", genre: 7003 },
    { key: "sim", name: "Mô phỏng", genre: 7015 },
    { key: "strategy", name: "Chiến thuật", genre: 7017 },
  ],
};

// TapTap (store Android lớn nhất không qua kênh hãng máy). Mỗi bảng tối đa 150 game, 10 game mỗi request.
export const TAPTAP = {
  limit: 150,
  boards: [
    { key: "hot", name: "Thịnh hành", zh: "热门榜" },
    { key: "new", name: "Game mới", zh: "新品榜" },
    { key: "reserve", name: "Đặt trước", zh: "预约榜" },
    { key: "pop", name: "Chơi nhiều", zh: "热玩榜" },
    { key: "casual", name: "Casual", zh: "休闲" },
    { key: "idle", name: "Idle", zh: "放置" },
    { key: "management", name: "Quản lý / kinh doanh", zh: "经营" },
    { key: "roguelike", name: "Roguelike", zh: "Roguelike" },
    { key: "independent", name: "Game indie", zh: "独立" },
  ],
  // Bảng xếp hạng không trả tên nhà phát triển: tra trang chi tiết, tối đa N game mỗi lần chạy
  maxDetailLookups: 400,
};

// Mini game WeChat / Douyin: trang công khai của 引力引擎 (rank.gravity-engine.com), chỉ có top 20 mỗi bảng
export const MINIGAME = {
  sources: [
    { key: "wechat", url: "https://rank.gravity-engine.com/wechat/day/" },
    { key: "douyin", url: "https://rank.gravity-engine.com/douyin/day/" },
  ],
  // Tên tiếng Việt cho các bảng (theo tên tiếng Trung trên trang)
  boardNames: {
    "人气榜": "Nhân khí", "畅销榜": "Doanh thu", "畅玩榜": "Chơi nhiều",
    "热门榜": "Thịnh hành", "新游榜": "Game mới", "发行人热度榜": "Hot trên video/livestream",
  },
};

// Tencent 应用宝 (sj.qq.com): trang SSR của các bảng game, mỗi bảng 20 game
export const TENCENT = {
  boards: [
    { key: "hot", name: "Thịnh hành", zh: "热门游戏", path: "hot-game-list" },
    { key: "new", name: "Game mới", zh: "新游", path: "new-game-list" },
    { key: "reserve", name: "Đặt trước", zh: "预约", path: "reserve-game-list" },
  ],
};

// Xiaomi (app.mi.com): danh sách game theo danh mục, xếp theo độ phổ biến, tối đa 90 game mỗi danh mục
export const XIAOMI = {
  limit: 90,
  boards: [
    { key: "all", name: "Tất cả game", zh: "游戏", category: 15 },
    { key: "casual", name: "Casual / sáng tạo", zh: "休闲创意", category: 23 },
    { key: "runner", name: "Chạy / vượt màn", zh: "跑酷闯关", category: 26 },
    { key: "strategy", name: "Chiến thuật", zh: "战争策略", category: 16 },
    { key: "action", name: "Hành động / bắn súng", zh: "动作枪战", category: 17 },
    { key: "rpg", name: "RPG online", zh: "网游RPG", category: 19 },
  ],
};
// Huawei AppGallery: API web yêu cầu mã xác thực riêng (Interface-Code), không lấy tự động.

export const SOURCES = [
  { key: "wechat", name: "WeChat mini game", kind: "mini" },
  { key: "douyin", name: "Douyin mini game", kind: "mini" },
  { key: "taptap", name: "TapTap", kind: "app" },
  { key: "ios", name: "App Store Trung Quốc", kind: "app" },
  { key: "tencent", name: "Tencent 应用宝", kind: "app" },
  { key: "xiaomi", name: "Xiaomi", kind: "app" },
];

// Bảng tổng hợp: bảng nào không tính điểm (game chưa ra mắt)
export const AGGREGATE = {
  skipBoards: { taptap: ["reserve"], tencent: ["reserve"] },
  top: 200,
};

// Tin ngành tiếng Trung (RSS). match: chỉ giữ bài có tiêu đề khớp (cho nguồn tổng hợp)
export const NEWS_SOURCES = [
  { key: "gamelook", name: "GameLook", url: "http://www.gamelook.com.cn/feed" },
  { key: "chaguan", name: "游戏茶馆", url: "https://www.youxichaguan.com/feed" },
  { key: "36kr", name: "36Kr (lọc game)", url: "https://www.36kr.com/feed", match: /游戏|手游|小游戏|腾讯|网易|米哈游/ },
];
export const NEWS_MAX_AGE_DAYS = 60;

// Dịch tên game, thể loại, tiêu đề tin sang tiếng Việt qua Google Translate (endpoint công khai, không cần key).
// Chỉ gửi đi dữ liệu công khai lấy từ store. Kết quả được lưu lại, mỗi chuỗi chỉ dịch một lần.
export const TRANSLATE = {
  enabled: true,
  to: "vi",
  maxPerRun: 8000,
};

// Ngưỡng "tăng mạnh" ở tab Tổng quan (số bậc), theo nguồn
export const MOVER_DELTA = { ios: 15, taptap: 15, wechat: 3, douyin: 3, tencent: 4, xiaomi: 10 };
// Game phát hành trong số ngày này được gắn nhãn "mới ra"
export const FRESH_DAYS = 30;

// Tab "Game mới": cửa sổ thời gian tối đa (client lọc tiếp 7/14/30/60 ngày) và các bảng "game mới" / "đặt trước"
// của từng nền tảng
export const NEW_GAMES = {
  days: 60,
  newBoards: { taptap: ["new"], tencent: ["new"], douyin: ["fresh_game"] },
  reserveBoards: { taptap: ["reserve"], tencent: ["reserve"] },
};

// Tab phụ "Bilibili" (lib/china/videos.mjs): video về game mới đăng trong `days` ngày, sắp theo lượt thích.
// Mỗi ngày tìm theo `terms` (mỗi từ khoá `pages` trang × 20 video, nhiều lượt xem trước, chỉ khu Game) và theo tên
// `gameNames` game mới của tab Game mới. Cách nhau `delayMs` để Bilibili không chặn (-412).
export const VIDEOS = {
  days: 30,
  maxRows: 2000,
  // Video tìm thấy qua các từ khoá này được tính là video game puzzle
  puzzleTerms: ["益智游戏", "解谜游戏", "消除游戏"],
  bilibili: {
    terms: [
      "新游", "新游推荐", "手游推荐", "新手游", "公测", "首曝", "新游测评", "手游测评", "试玩",
      "小游戏", "微信小游戏", "抖音小游戏", "益智游戏", "解谜游戏", "休闲游戏", "消除游戏", "独立游戏", "好玩的手游",
    ],
    pages: 2,
    gameNames: 40,
    delayMs: 1500,
  },
  // Douyin: mở trang tìm kiếm bằng Edge/Chrome ẩn với cookie của tài khoản PHỤ (file cookieFile, tương đối với thư mục
  // chart-tracker, nằm trong data/ nên không lên git). publishTime: đăng trong 1 / 7 / 180 ngày (bộ lọc của Douyin).
  douyin: {
    cookieFile: "data/douyin-cookie.txt",
    terms: ["新游", "新游推荐", "手游推荐", "公测", "小游戏", "抖音小游戏", "益智游戏", "解谜游戏", "休闲游戏", "消除游戏"],
    gameNames: 20,
    publishTime: 7,
    scrolls: 3,
    delayMs: 4000,
  },
};

// Link tra cứu thêm trong trang chi tiết game. {q} = tên game tiếng Trung (đã mã hoá URL)
export const LOOKUP_LINKS = [
  { name: "Bilibili", desc: "Video gameplay, review", url: "https://search.bilibili.com/all?keyword={q}" },
  { name: "Douyin", desc: "Video ngắn, quảng cáo", url: "https://www.douyin.com/search/{q}" },
  { name: "Xiaohongshu", desc: "Bài chia sẻ của người chơi", url: "https://www.xiaohongshu.com/search_result?keyword={q}" },
  { name: "TapTap", desc: "Trang game, đánh giá", url: "https://www.taptap.cn/search/{q}" },
  { name: "YouTube", desc: "Gameplay được đăng lại", url: "https://www.youtube.com/results?search_query={q}" },
  { name: "Baidu", desc: "Tìm chung", url: "https://www.baidu.com/s?wd={q}+%E6%B8%B8%E6%88%8F" },
];

// Bản công khai: China Tracker là tab "Trung Quốc" trong web Chart Tracker (GitHub Pages của repo ResearchGame).
// `npm run export` (và bước cuối của quy trình hằng ngày) xuất bản tĩnh, chỉ đọc, vào thư mục `dir`, tức china/ trong
// site của Chart Tracker; lệnh đăng của Chart Tracker đẩy thư mục đó lên cùng. China Tracker không tự đẩy git.
export const PUBLISH = {
  enabled: true,
  // Tương đối với thư mục chart-tracker
  dir: "data/site/china",
  // Xuất trang chi tiết cho game có mặt trên bảng trong số ngày này
  gameDays: 30,
  // Mỗi lần xuất, dịch sẵn mô tả cho tối đa N game chưa có bản dịch (game hạng cao trước); bản công khai không tự dịch được
  translateDescr: 150,
};
