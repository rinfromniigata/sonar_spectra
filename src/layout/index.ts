// 配置（layout）の入口。モジュールの中身は知らない。

export { FULL_GRID, GRID_COLUMNS, GRID_ROWS, adjacent, cellCount, insideGrid, overlaps, splitRect, unionIfRect } from "./grid";
export { BAND_STANDARD_MIN, BAND_STRIP_MIN, BAND_WIDE_MIN, TEMPLATES, bandFor, type AreaKey, type Band } from "./templates";
export { autoArrange, type AutoLayout } from "./auto_arrange";
