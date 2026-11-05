// CSS のカスタムプロパティ（px の長さ）を数値で読む。トークンの値をスクリプトの計算に使うときに使う
export function readCssLength(element: Element, name: string): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}
