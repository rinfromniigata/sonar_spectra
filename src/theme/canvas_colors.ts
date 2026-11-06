// Canvas で使う色を、トークン（tokens.css のカスタムプロパティ）から読み出す。
// 値を直書きせず、描画時にトークンから取る。テーマが変わったら読み直す。

/** トークンから読んだ、Canvas に渡せる値 */
export interface CanvasColors {
  bg: string;
  grid: string;
  line: string;
  text: string;
  textMuted: string;
  neonA: string;
  neonB: string;
  neonC: string;
  danger: string;
  fontNumeric: string;
  theme: "dark" | "light";
}

/** 読み出すカスタムプロパティ */
const TOKENS = {
  bg: "--color-bg",
  grid: "--color-grid",
  line: "--color-line",
  text: "--color-text",
  textMuted: "--color-text-muted",
  neonA: "--color-neon-a",
  neonB: "--color-neon-b",
  neonC: "--color-neon-c",
  danger: "--color-danger",
  fontNumeric: "--font-numeric",
} as const satisfies Record<Exclude<keyof CanvasColors, "theme">, string>;

/**
 * `read` でカスタムプロパティの値を読み、Canvas 用の色にする。
 * テーマは color-scheme（tokens.css がテーマごとに設定する）から判定する
 */
export function readCanvasColors(read: (property: string) => string): CanvasColors {
  const value = (property: string) => read(property).trim();
  const colors = Object.fromEntries(
    Object.entries(TOKENS).map(([name, property]) => [name, value(property)]),
  ) as Omit<CanvasColors, "theme">;
  const theme = value("color-scheme").includes("light") ? "light" : "dark";
  return { ...colors, theme };
}

/** 文書の今の値を読む */
export function readDocumentCanvasColors(root: HTMLElement = document.documentElement): CanvasColors {
  const style = getComputedStyle(root);
  return readCanvasColors((property) => style.getPropertyValue(property));
}

/**
 * テーマが変わったら（`data-theme` の切り替え、OS のライト／ダークの切り替え）読み直して知らせる。
 * 返す関数で監視をやめる
 */
export function watchCanvasColors(onChange: (colors: CanvasColors) => void): () => void {
  const root = document.documentElement;
  const notify = () => onChange(readDocumentCanvasColors(root));
  const observer = new MutationObserver(notify);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  const media = matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", notify);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", notify);
  };
}
