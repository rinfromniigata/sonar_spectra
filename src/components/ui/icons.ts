// 部品で使うアイコンの形（モックのアイコンと同じ。座標は viewBox 0 0 16 16 の中）
export type IconShape =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: number; cy: number; r: number }
  | { tag: "rect"; x: number; y: number; width: number; height: number };

const path = (d: string): IconShape => ({ tag: "path", d });
const rect = (x: number, y: number, width: number, height: number): IconShape => ({ tag: "rect", x, y, width, height });

export const ICONS = {
  close: [path("M4 4l8 8M12 4l-8 8")],
  settings: [
    { tag: "circle", cx: 8, cy: 8, r: 2.4 },
    path("M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"),
  ],
  layout: [rect(2, 2, 5, 12), rect(9, 2, 5, 5), rect(9, 9, 5, 5)],
  fullscreen: [path("M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4")],
  fullscreen_exit: [path("M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4")],
  duplicate: [rect(5, 5, 8, 8), path("M3 11V3h8")],
  delete: [path("M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5")],
  reset: [path("M3 8a5 5 0 1 0 1.6-3.7"), path("M3 2.5v3h3")],
  export: [path("M8 10V2M5 5l3-3 3 3M3 10v4h10v-4")],
} satisfies Record<string, IconShape[]>;

export type IconName = keyof typeof ICONS;
