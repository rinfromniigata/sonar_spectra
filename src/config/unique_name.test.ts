import { describe, expect, it } from "vitest";
import { uniqueName } from "./unique_name";

describe("uniqueName", () => {
  it("かぶらなければそのまま。かぶれば _1、それもあれば _2", () => {
    expect(uniqueName("クラブ用", ["既定"], 40)).toBe("クラブ用");
    expect(uniqueName("クラブ用", ["クラブ用"], 40)).toBe("クラブ用_1");
    expect(uniqueName("クラブ用", ["クラブ用", "クラブ用_1"], 40)).toBe("クラブ用_2");
  });

  it("使われていない最小の番号を選ぶ（_1 を消したあとは _1 に戻る）", () => {
    expect(uniqueName("クラブ用", ["クラブ用", "クラブ用_2", "クラブ用_3"], 40)).toBe("クラブ用_1");
  });

  it("完全一致で比べる（大文字小文字・前後の空白の違いは別の名前）", () => {
    expect(uniqueName("Club", ["club", "Club "], 40)).toBe("Club");
  });

  it("_n を付けた名前がそれ自体の連番に見えても、末尾に足すだけ（クラブ用_1 がかぶれば クラブ用_1_1）", () => {
    expect(uniqueName("クラブ用_1", ["クラブ用_1"], 40)).toBe("クラブ用_1_1");
  });

  it("上限の文字数に収めるため、本体の末尾を削ってから付ける（削った末尾の空白も除く）", () => {
    const name = "あ".repeat(40);
    const result = uniqueName(name, [name], 40);
    expect(result).toBe(`${"あ".repeat(38)}_1`);
    expect([...result]).toHaveLength(40);

    const spaced = `${"あ".repeat(37)} いう`;
    expect(uniqueName(spaced, [spaced], 40)).toBe(`${"あ".repeat(37)}_1`);

    // 2桁の番号でも収まる
    const taken = [name, ...Array.from({ length: 9 }, (_, i) => `${"あ".repeat(38)}_${i + 1}`)];
    expect(uniqueName(name, taken, 40)).toBe(`${"あ".repeat(37)}_10`);
  });

  it("サロゲートペアの文字を途中で切らない", () => {
    const name = "🎵".repeat(40);
    const result = uniqueName(name, [name], 40);
    expect(result).toBe(`${"🎵".repeat(38)}_1`);
  });
});
