// Phân loại game puzzle theo tên (dùng chung cho mọi tab).
// Một game là "puzzle" khi: từng vào bảng Puzzle của store trong 30 ngày (meta.puzzleIds),
// hoặc tên khớp từ khoá "mạnh" của một kiểu, hoặc thể loại store ghi Puzzle.
// Từ khoá "yếu" (line, card, find…) dễ trùng game khác nên chỉ dùng khi game đã được biết là puzzle.
// Thứ tự quan trọng: kiểu đứng trước thắng ("Screw Jam" là Screw, "Block Blast" là Block, "Hexa Sort" là Sort).

const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export const PUZZLE_KINDS = [
  { key: "screw", name: "Screw / Nuts & Bolts", strong: /screw|nuts? ?(&|and|n) ?bolts?|\bbolts?\b|pull the pin|\bpin (out|puzzle|master)/ },
  { key: "yarn", name: "Yarn / Rope / Tangle", strong: /yarn|knit|\bwool|tangle|\bknots?\b|\bthreads?\b|\brope\b/ },
  { key: "word", name: "Word / Crossword", strong: /\bwords?\b|crossword|wordle|wordscape|anagram|spelling|scrabble/, weak: /\bletters?\b/ },
  { key: "sort", name: "Sort / Tidy", strong: /\bsort|hexa|water puzzle|ball puzzle|goods (match|sort)|triple goods|\btidy|organi[sz]e/ },
  { key: "merge", name: "Merge / 2048", strong: /merge|2048|drop (number|merge)/ },
  { key: "jam", name: "Jam / Parking / Bus", strong: /\bjam\b|parking|car ?out|cars? escape|traffic (escape|puzzle|jam)|\bbus\b|unblock|seat away/, weak: /traffic|\bcars?\b/ },
  { key: "tile", name: "Tile / Triple match", strong: /\btiles?\b|triple|match 3d|match factory|zen match|mahjong|3 tiles|onet/ },
  { key: "block", name: "Block puzzle", strong: /block (puzzle|blast|out|jam|crush|sudoku|away)|blocks? puzzle|tetris|1010|wood puzzle|woodoku/, weak: /\bblocks?\b|\bcubes?\b|\bbricks?\b/ },
  { key: "match3", name: "Match-3 / Bubble", strong: /match[ -]?(3|three)|candy crush|royal (match|kingdom)|scapes\b|toon blast|toy blast|jewel|bejeweled|bubble (shooter|pop)|candy|cookie jam|fishdom/, weak: /crush|\bblast|\bgems?\b|\bbubble|\bmatch\b/ },
  { key: "card", name: "Solitaire / bài", strong: /solitaire|klondike|freecell|tripeaks|spider card/, weak: /\bcards?\b/ },
  { key: "hidden", name: "Tìm đồ / Tìm điểm khác", strong: /hidden object|find (the )?differen|spot (the|it)|find (it|out)|differences|\bseek\b/, weak: /\bfind\b|hidden|\bsearch/ },
  { key: "jigsaw", name: "Jigsaw / Tô màu", strong: /jigsaw|colou?ring|color by number|paint by number|pixel art|art puzzle/, weak: /\bpaint|\bcolou?r\b/ },
  { key: "brain", name: "Brain / Trick / IQ", strong: /brain(?!rot)|\biq\b|riddle|who is\b|think(ing)? puzzle|mind games?/, weak: /trick|\bmind\b|\bquiz/ },
  { key: "number", name: "Sudoku / số / logic", strong: /sudoku|nonogram|kakuro|picross|minesweeper|killer sum|number (match|puzzle)/, weak: /\bnumbers?\b|\bmath\b|\blogic\b/ },
  { key: "draw", name: "Draw / Connect / Arrow", strong: /draw (it|line|puzzle|to)|connect (the )?dots?|\bpipes?\b|flow free|one line|\barrows?\b/, weak: /\blines?\b|\bpaths?\b|\bconnect|\bflow\b/ },
  { key: "physics", name: "Physics / Escape room", strong: /escape room|room escape|physics|marble|ball run|cut the rope/, weak: /\bescape/ },
];
// Tên khớp từ khoá nhưng không phải puzzle (game nhạc "Magic Tiles", meme "brainrot", sandbox "Block Craft"…)
const NOT_PUZZLE = /piano|rhythm|\bmusic\b|\bbeat\b|brainrot|surviv|craft|\bbuild(ing)?\b|sandbox|shooter(?!.*bubble)/;
export const PUZZLE_OTHER = { key: "other", name: "Puzzle khác" };

const KIND_BY_KEY = new Map([...PUZZLE_KINDS, PUZZLE_OTHER].map((k) => [k.key, k]));
export const puzzleKindName = (key) => KIND_BY_KEY.get(key)?.name ?? key;

let known = new Set();
// meta.puzzleIds = { gplay: [...], ios: [...] }
export function setPuzzleIds(ids) {
  known = new Set();
  for (const [store, list] of Object.entries(ids ?? {})) for (const id of list) known.add(`${store}:${id}`);
}

const cache = new Map();
// item: { title, store, appId, hint } — hint = thể loại / từ khoá tìm thấy (vd "Puzzle", "sort puzzle")
// Trả về key kiểu puzzle, "other" (puzzle chưa rõ kiểu) hoặc null (không phải puzzle)
export function puzzleKind({ title, store, appId, hint }) {
  const ck = `${store}:${appId}:${title}:${hint ?? ""}`;
  if (cache.has(ck)) return cache.get(ck);
  const t = norm(title).replace(/[^\p{L}\p{N}&]+/gu, " ");
  const isKnown = (store && appId && known.has(`${store}:${appId}`)) || /puzzle|cau (do|đo)/.test(norm(hint));
  let kind = null;
  if (!NOT_PUZZLE.test(t) || isKnown) {
    // Từ khoá mạnh của mọi kiểu xét trước, rồi mới tới từ khoá yếu ("Seaside Escape: Merge" là Merge, không phải Escape)
    kind = PUZZLE_KINDS.find((k) => k.strong.test(t))?.key
      ?? (isKnown ? PUZZLE_KINDS.find((k) => k.weak?.test(t))?.key : null) ?? null;
  }
  if (!kind && isKnown) kind = "other";
  cache.set(ck, kind);
  return kind;
}

// Lọc theo lựa chọn: "" = mọi game, "puzzle" = mọi puzzle, còn lại = đúng kiểu đó
export function matchPuzzle(sel, kind) {
  if (!sel) return true;
  if (sel === "puzzle") return kind != null;
  return kind === sel;
}

// Đếm số game theo kiểu, trả về [{ key, name, n }] theo thứ tự PUZZLE_KINDS (bỏ kiểu 0 game)
export function countKinds(kinds) {
  const n = new Map();
  for (const k of kinds) if (k) n.set(k, (n.get(k) ?? 0) + 1);
  return [...PUZZLE_KINDS, PUZZLE_OTHER].filter((k) => n.get(k.key)).map((k) => ({ key: k.key, name: k.name, n: n.get(k.key) }));
}
