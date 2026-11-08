import { describe, expect, it } from "vitest";
import type { Instance } from "../config/types";
import { instanceNumbers } from "./instance_numbers";

const inst = (id: string, kind: string, enabled = true) => ({ id, kind, enabled }) as unknown as Instance;

describe("instanceNumbers", () => {
  it("同じ種類の中で、並びの順に1から番号を振る", () => {
    const numbers = instanceNumbers([inst("a", "spec"), inst("b", "stereo"), inst("c", "spec"), inst("d", "stereo"), inst("e", "wave")]);
    expect([...numbers]).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 2],
      ["d", 2],
      ["e", 1],
    ]);
  });

  it("無効なものも数え、有効・無効を切り替えても番号が変わらない", () => {
    const numbers = instanceNumbers([inst("a", "spec", false), inst("b", "spec")]);
    expect(numbers.get("a")).toBe(1);
    expect(numbers.get("b")).toBe(2);
  });

  it("インスタンスがなければ空", () => {
    expect(instanceNumbers([]).size).toBe(0);
  });
});
