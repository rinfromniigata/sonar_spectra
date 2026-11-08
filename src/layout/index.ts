// 配置（layout）の入口。モジュールの中身は知らない。

export { FULL_GRID, GRID_COLUMNS, GRID_ROWS, adjacent, cellCount, insideGrid, overlaps, splitRect, unionIfRect } from "./grid";
export { BAND_STANDARD_MIN, BAND_STRIP_MIN, BAND_WIDE_MIN, TEMPLATES, bandFor, type AreaKey, type Band } from "./templates";
export { autoArrange, type AutoLayout } from "./auto_arrange";
export {
  addInstance,
  arrowDelta,
  beginManual,
  canPlace,
  duplicateInstance,
  findSpace,
  findSplitters,
  moveBy,
  moveSplitter,
  moveTo,
  pinAutoLayout,
  placeNewRect,
  resizeBy,
  resizeTo,
  returnToAuto,
  setDirection,
  setInstanceEnabled,
  splitterStep,
  swapRects,
  type GridPosition,
  type GridSize,
  type Layout,
  type Splitter,
  type SplitterAxis,
} from "./manual";
export { frameSize, type GridBox } from "./edit_gesture";
export { instanceNumbers } from "./instance_numbers";
export {
  COMPACT_MAX_RATIO,
  LONG_MIN_RATIO,
  TALL_MIN_RATIO,
  fitProfileOf,
  shapeFit,
  type FitProfile,
  type ShapeFit,
} from "./shape_fit";
