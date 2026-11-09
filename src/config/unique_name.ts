// 一覧の中で重ならない名前を決める（imple 5.4。構成の名前と、自分で作った配色の名前で使う）。
// - すでにある名前なら、末尾に `_{n}` を付ける。n は 1 から数えて、まだ使われていない最小の数
//   （例：「クラブ用」があれば「クラブ用_1」、それもあれば「クラブ用_2」。「クラブ用_1」を消せばまた「クラブ用_1」）
// - 名前の比べ方は完全一致（呼び出し側が、前後の空白を除いてから渡す）
// - `_{n}` を付けたあとも上限の文字数に収める（本体の末尾を削る。削ったあとの末尾の空白も除く）

/** 重ならない名前。name は空でない（前後の空白を除いた）もの。taken はすでにある名前 */
export function uniqueName(name: string, taken: Iterable<string>, maxLength: number): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  const chars = [...name];
  for (let n = 1; ; n++) {
    const suffix = `_${n}`;
    const room = Math.max(1, maxLength - suffix.length);
    const base = chars.length > room ? chars.slice(0, room).join("").trimEnd() : name;
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
