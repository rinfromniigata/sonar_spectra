import { describe, expect, it } from "vitest";
import { checkSyntax, checkUsage, compareLocale, findUsedKeys, flatten, placeholdersOf } from "./i18n_check_core";

const source = flatten({ a: { b: "こんにちは {name}", c: "閉じる" }, d: "ピーク {value} dB" });

describe("flatten", () => {
  it("入れ子をピリオドでつなぐ", () => {
    expect([...source.keys()]).toEqual(["a.b", "a.c", "d"]);
  });
});

describe("placeholdersOf", () => {
  it("プレースホルダの名前を集める", () => {
    expect([...placeholdersOf("{layout_mode}・モジュール{count}・{date}")]).toEqual(["layout_mode", "count", "date"]);
  });
});

describe("compareLocale", () => {
  it("一致していれば問題なし", () => {
    const en = flatten({ a: { b: "Hello {name}", c: "Close" }, d: "Peak {value} dB" });
    expect(compareLocale(source, en, "en")).toEqual([]);
  });
  it("キーの不足・余分と、プレースホルダの食い違いを見つける", () => {
    const en = flatten({ a: { b: "Hello {user}" }, d: "Peak {value} dB", e: "extra" });
    const kinds = compareLocale(source, en, "en").map((i) => `${i.kind}:${i.key}`);
    expect(kinds).toEqual(["placeholder_mismatch:a.b", "missing_key:a.c", "extra_key:e"]);
  });
});

describe("checkSyntax", () => {
  it("vue-i18n の記法として読めない文字列を見つける", () => {
    const messages = flatten({ ok: "×{value}", at: "a@b.c", brace: "{ broken" });
    expect(checkSyntax(messages, "ja").map((i) => i.key)).toEqual(["at", "brace"]);
  });
});

describe("findUsedKeys と checkUsage", () => {
  const keys = new Set(source.keys());
  const used = findUsedKeys([`t("a.b", { name })`, "const key = 'a.c';", "// d は使わない"], keys);
  it("引用符で囲んだキーを使用中とみなす", () => {
    expect([...used].sort()).toEqual(["a.b", "a.c"]);
  });
  it("未使用・使用予定のまま使われたキー・辞書にない使用予定を見つける", () => {
    expect(checkUsage(keys, used, [])).toEqual([{ kind: "unused_key", key: "d" }]);
    expect(checkUsage(keys, used, ["d"])).toEqual([]);
    const kinds = checkUsage(keys, used, ["d", "a.b", "zzz"]).map((i) => `${i.kind}:${i.key}`);
    expect(kinds).toEqual(["pending_key_used:a.b", "pending_key_unknown:zzz"]);
  });
});
