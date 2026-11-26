// Phân loại thể loại chuẩn hoá và kiểu puzzle cho game Trung Quốc.
// Dữ liệu đầu vào khác nhau theo nguồn: TapTap / 应用宝 có tag, WeChat / Douyin có thể loại của nền tảng, Xiaomi có
// danh mục, App Store chỉ biết qua bảng đang có mặt (vd ios/free-puzzle). Key kiểu puzzle đặt giống
// chart-tracker/public/puzzle.js để hai tab thống nhất; thêm "chess" (cờ) vì bảng Puzzle của App Store TQ có nhiều game cờ.

// ---------- Kiểu puzzle ----------
// Thứ tự quan trọng: kiểu đứng trước thắng ("打个螺丝" là Screw; "箭了个箭" là Draw/Arrow chứ không phải Tile;
// "合数-扫雷、2048、数独…" là Number; "Cube Escape" là Escape room chứ không phải Block).
// strong: tên khớp là đủ để coi là puzzle. weak: chỉ dùng khi game đã biết là puzzle (theo tag / bảng).
export const PUZZLE_KINDS = [
  { key: "screw", name: "Screw / Nuts & Bolts", strong: /螺丝|螺母|螺栓|拔钉|钉子|拔针|screw|nuts? ?(&|and|n) ?bolts?|pull the pin/ },
  { key: "yarn", name: "Yarn / Rope / Tangle", strong: /毛线|绕线|解绳|绳结|打结|编织|线团|yarn|knit|\bwool|tangle/ },
  { key: "word", name: "Word / chữ Hán", strong: /汉字|成语|填字|拼字|找字|猜字|字谜|词语|文字(找茬|游戏|闯关|解谜|谜)|\bwords?\b|crossword/ },
  { key: "number", name: "Sudoku / số / logic", strong: /数独|扫雷|数织|华容道|sudoku|minesweeper|nonogram/, weak: /数字|算/ },
  { key: "hidden", name: "Tìm đồ / Tìm điểm khác", strong: /找茬|找不同|找东西|找一找|找找|寻物|寻宝|一找|找出|隐藏的|考眼力|hidden object|find (the )?differen/, weak: /找|寻/ },
  { key: "sort", name: "Sort / Tidy", strong: /排序|分类|整理|收纳|收杂物|归类|倒水|货架|货柜|摆货|叠杯|\bsort|hexa|\btidy|organi[sz]e/ },
  { key: "draw", name: "Draw / Connect / Arrow", strong: /箭头|画线|一笔画|连线|管道|arrows?\b|draw (it|line|puzzle|to)|connect (the )?dots?|\bpipes?\b/, weak: /画|线/ },
  { key: "merge", name: "Merge / 2048", strong: /合成|合并|合合|合一合|2048|merge/ },
  // 停车 / 公交 / parking đứng một mình thường là game lái xe mô phỏng, nên chỉ là từ khoá yếu
  { key: "jam", name: "Jam / Parking / Bus", strong: /挪车|堵车|拥堵|挪挪|挪一挪|上车|车位|\bjam\b|unblock|car out|seat away/, weak: /停车|交通|巴士|公交|出租车|parking|traffic|\bbus\b|车/ },
  { key: "tile", name: "Tile / Triple match", strong: /了个|抓大鹅|三合一|连连看|对对碰|对子|配对|匹配|麻将消除|mahjong|\btiles?\b|triple|onet/ },
  { key: "physics", name: "Physics / Escape room", strong: /密室|逃脱|解密|物理|割绳子|弹珠|escape room|room escape|cube escape|physics|cut the rope/, weak: /逃离|escape/ },
  { key: "jigsaw", name: "Jigsaw / Tô màu", strong: /拼图|涂色|填色|数字油画|像素画|jigsaw|colou?ring|paint by number/ },
  { key: "block", name: "Block puzzle", strong: /方块|积木|俄罗斯|拼块|木块|block (puzzle|blast)|tetris|woodoku/, weak: /块/ },
  { key: "match3", name: "Match-3 / Bubble", strong: /消消|三消|爱消除|消除星星|消灭星星|消星星|宝石|泡泡|开心消|candy|match[ -]?(3|three)|bubble|jewel|scapes\b|fishdom/, weak: /消除|消/ },
  { key: "card", name: "Solitaire / bài", strong: /纸牌|接龙|蜘蛛牌|斗地主|掼蛋|惯蛋|扑克|桥牌|solitaire|klondike|freecell|tripeaks/, weak: /牌/ },
  { key: "chess", name: "Cờ (象棋, 围棋…)", strong: /象棋|围棋|五子棋|跳棋|军棋|chess/ },
  { key: "brain", name: "Brain / IQ / đố mẹo", strong: /脑洞|烧脑|脑筋|谜题|智商|智力|急转弯|动脑|\bbrain(?!rot)|\biq\b|riddle/, weak: /谜|关/ },
];
export const PUZZLE_OTHER = { key: "other", name: "Puzzle khác" };

// Tag / thể loại của nền tảng cho biết là puzzle (WeChat "益智" khá rộng nên vẫn cần NOT_PUZZLE bên dưới)
const PUZZLE_TAGS = new Set(["益智", "消除", "解谜", "解密", "三消", "合成", "找茬", "寻物", "拼图", "休闲益智", "数独"]);
const PUZZLE_BOARDS = new Set(["ios/free-puzzle", "ios/grossing-puzzle"]);
// Có tag/bảng puzzle nhưng tên cho thấy không phải puzzle (bảng Puzzle của App Store TQ có cả game thủ thành, chạy,
// game nhập vai, hẹn hò; WeChat gắn "益智" cho nhiều game mô phỏng). Game khớp từ khoá mạnh của một kiểu thì vẫn giữ.
const NOT_PUZZLE = /模拟器|驾驶|植物大战僵尸|神庙逃亡|赛尔号|盗墓|射击|枪|吞噬|恋|王子|角色扮演|rpg|争霸|大作战|\bio\b/i;
// Khớp từ khoá nhưng chắc chắn không phải puzzle (game nhạc "Magic Tiles", meme "brainrot", casino / bắn cá)
const NEVER_PUZZLE = /钢琴|音游|节奏|piano|rhythm|brainrot|电玩城|捕鱼|轮盘|虎机|jackpot|casino|slots?\b|赌/i;

// ---------- Thể loại chuẩn hoá ----------
// tags: so khớp đúng tag (TapTap, 应用宝, Xiaomi, WeChat/Douyin); boards: "nguồn/bảng" đang có mặt
export const GENRES = [
  { key: "puzzle", name: "Puzzle / giải đố" },
  { key: "casual", name: "Casual / giải trí", tags: ["休闲", "休闲创意", "超休闲", "解压", "派对游戏", "治愈", "休闲益智", "儿童益智"],
    boards: ["ios/free-casual", "ios/grossing-casual", "taptap/casual", "xiaomi/casual"] },
  { key: "idle", name: "Idle / treo máy", tags: ["放置", "放置挂机", "挂机", "放置类", "阵容放置"], boards: ["taptap/idle"] },
  { key: "sim", name: "Mô phỏng / kinh doanh", tags: ["模拟", "模拟经营", "经营", "经营模拟", "养成", "种田", "建造", "烹饪", "美食"],
    boards: ["ios/free-sim", "ios/grossing-sim", "taptap/management"] },
  { key: "strategy", name: "Chiến thuật / SLG", tags: ["策略", "战争策略", "SLG", "战棋", "自走棋", "即时制战略", "回合制战略", "战争", "军事", "三国"],
    boards: ["ios/free-strategy", "ios/grossing-strategy", "xiaomi/strategy"] },
  { key: "towerdef", name: "Thủ thành (塔防)", tags: ["塔防", "塔防迷宫"] },
  { key: "rpg", name: "Nhập vai (RPG)", tags: ["角色扮演", "网游RPG", "ARPG", "MMORPG", "MMO", "回合制", "回合战斗", "修仙", "仙侠", "武侠", "动作角色扮演", "角色"],
    boards: ["xiaomi/rpg"] },
  { key: "action", name: "Hành động / bắn súng", tags: ["动作", "动作枪战", "射击", "FPS", "TPS", "格斗", "格斗快打", "吃鸡", "弹幕射击", "搜打撤", "动作冒险",
    "平台跳跃", "枪战", "第一人称射击", "第三人称射击", "战术竞技", "即时战斗", "大乱斗"], boards: ["xiaomi/action"] },
  { key: "roguelike", name: "Roguelike", tags: ["Roguelike", "轻度Roguelike", "地牢", "牌组构筑"], boards: ["taptap/roguelike"] },
  { key: "card", name: "Thẻ bài / cờ bài", tags: ["卡牌", "卡牌CAG", "棋牌", "棋牌桌游", "扑克牌", "牌类", "麻将", "象棋", "经典桌游"] },
  { key: "runner", name: "Chạy / vượt màn", tags: ["跑酷", "跑酷闯关", "通关"], boards: ["xiaomi/runner"] },
  { key: "racing", name: "Đua xe / thể thao", tags: ["竞速", "赛车", "赛车体育", "体育", "体育竞技", "足球", "漂移"] },
  { key: "sandbox", name: "Sandbox / sinh tồn", tags: ["沙盒", "生存", "开放世界", "末日", "丧尸"] },
  { key: "moba", name: "MOBA / đối kháng", tags: ["MOBA", "5v5", "竞技", "对战", "PvP", "PVP", "非对称竞技"] },
  { key: "story", name: "Cốt truyện / hẹn hò", tags: ["剧情", "AVG", "文字", "恋爱", "乙女", "女性向", "换装", "美少女"] },
  { key: "music", name: "Âm nhạc", tags: ["音游", "音乐"] },
  { key: "horror", name: "Kinh dị", tags: ["恐怖"] },
  { key: "indie", name: "Indie", tags: ["独立游戏", "TapTap制造", "聚光灯GameJam"], boards: ["taptap/independent"] },
];
const BY_TAG = new Map(), BY_BOARD = new Map();
for (const g of GENRES) {
  for (const t of g.tags ?? []) (BY_TAG.get(t) ?? BY_TAG.set(t, []).get(t)).push(g.key);
  for (const b of g.boards ?? []) (BY_BOARD.get(b) ?? BY_BOARD.set(b, []).get(b)).push(g.key);
}

const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase();

// Kiểu puzzle của một game, "other" (puzzle chưa rõ kiểu) hoặc null (không phải puzzle)
export function puzzleKind({ title, tags = [], boards = [] }) {
  const t = norm(title);
  if (NEVER_PUZZLE.test(t)) return null;
  const strong = PUZZLE_KINDS.find((k) => k.strong.test(t))?.key;
  if (strong) return strong;
  const known = tags.some((x) => PUZZLE_TAGS.has(x)) || boards.some((b) => PUZZLE_BOARDS.has(b));
  if (!known || NOT_PUZZLE.test(t)) return null;
  return PUZZLE_KINDS.find((k) => k.weak?.test(t))?.key ?? PUZZLE_OTHER.key;
}

// Puzzle "chưa rõ kiểu" (chỉ dựa vào tag / bảng) mà đồng thời mang thể loại khác rõ ràng thì không tính là puzzle:
// WeChat gắn "益智" cho cả game bắn súng như 向僵尸开炮, 应用宝 gắn "休闲益智" cho game party như 蛋仔派对.
const CONFLICTS = ["action", "moba", "rpg", "towerdef", "sandbox", "racing", "roguelike", "strategy"];
export function settle(set, puzzle) {
  if (puzzle === PUZZLE_OTHER.key && CONFLICTS.some((k) => set.has(k))) puzzle = null;
  if (puzzle) set.add("puzzle");
  else set.delete("puzzle");
  return { genres: GENRES.map((g) => g.key).filter((k) => set.has(k)), puzzle };
}

// { genres: ["puzzle", "casual", …], puzzle: key | null }. tags: tag tiếng Trung (kể cả thể loại của nền tảng)
export function classify({ title, tags = [], boards = [] }) {
  const set = new Set();
  for (const t of tags) for (const k of BY_TAG.get(t) ?? []) set.add(k);
  for (const b of boards) for (const k of BY_BOARD.get(b) ?? []) set.add(k);
  return settle(set, puzzleKind({ title, tags, boards }));
}

export const genreList = () => GENRES.map(({ key, name }) => ({ key, name }));
export const puzzleKindList = () => [...PUZZLE_KINDS, PUZZLE_OTHER].map(({ key, name }) => ({ key, name }));
