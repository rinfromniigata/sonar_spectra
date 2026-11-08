import { describe, expect, it } from "vitest";
import type { Instance } from "../config/types";
import type { Direction, ModuleKind } from "../modules/options";
import { moduleRegistry } from "../modules";
import { COMPACT_MAX_RATIO, LONG_MIN_RATIO, TALL_MIN_RATIO, fitProfileOf, shapeFit, type FitProfile, type ShapeFit } from "./shape_fit";

const DIRECTIONS: (Direction | null)[] = ["up", "right", "down", "left", null];

describe("形を選ばない（free）", () => {
  it("どんな枠でも・どの向きでも適", () => {
    for (const [w, h] of [
      [100, 100],
      [400, 20],
      [20, 400],
    ]) {
      for (const direction of DIRECTIONS) expect(shapeFit({ shape: "free" }, direction, w, h)).toBe("good");
    }
  });
});

describe("正方形に近い（compact）", () => {
  const profile: FitProfile = { shape: "compact" };

  it("縦横比が上限以下なら適（向きと縦横どちらが長いかは問わない）", () => {
    expect(shapeFit(profile, null, 100, 100)).toBe("good");
    expect(shapeFit(profile, null, 180, 100)).toBe("good");
    expect(shapeFit(profile, null, 100, 180)).toBe("good");
  });

  it("上限を超えると、横長でも縦長でも「もっと正方形に」", () => {
    expect(shapeFit(profile, null, 181, 100)).toBe("warn_long");
    expect(shapeFit(profile, null, 100, 181)).toBe("warn_long");
    expect(shapeFit(profile, null, 600, 50)).toBe("warn_long");
  });

  it("境目の値を定数と合わせる", () => {
    expect(shapeFit(profile, null, 100 * COMPACT_MAX_RATIO, 100)).toBe("good");
    expect(shapeFit(profile, null, 100 * COMPACT_MAX_RATIO + 1, 100)).toBe("warn_long");
  });
});

describe("縦長（周波数別の定位）", () => {
  const profile: FitProfile = { shape: "tall" };

  it("高さが幅の1.3倍以上なら適、足りなければ「もっと縦長に」", () => {
    expect(shapeFit(profile, null, 100, 130)).toBe("good");
    expect(shapeFit(profile, null, 100, 300)).toBe("good");
    expect(shapeFit(profile, null, 100, 129)).toBe("warn_tall");
    expect(shapeFit(profile, null, 100, 100)).toBe("warn_tall");
    expect(shapeFit(profile, null, 300, 100)).toBe("warn_tall");
    expect(100 * TALL_MIN_RATIO).toBe(130);
  });
});

describe("細長い・長辺が流れに沿う（long / along：波形・重心と変化量）", () => {
  const profile: FitProfile = { shape: "long", longSide: "along" };

  it("横に流れる（左右）なら、横長の枠が適", () => {
    for (const direction of ["left", "right"] as const) {
      expect(shapeFit(profile, direction, 400, 100)).toBe("good");
      expect(shapeFit(profile, direction, 100, 400)).toBe("warn_axis");
    }
  });

  it("縦に流れる（上下）なら、縦長の枠が適", () => {
    for (const direction of ["up", "down"] as const) {
      expect(shapeFit(profile, direction, 100, 400)).toBe("good");
      expect(shapeFit(profile, direction, 400, 100)).toBe("warn_axis");
    }
  });
});

describe("細長い・長辺が流れと直角（long / across：レベル・スペクトラム）", () => {
  const profile: FitProfile = { shape: "long", longSide: "across" };

  it("上下に伸びる（上・下）なら、横長の枠が適", () => {
    for (const direction of ["up", "down"] as const) {
      expect(shapeFit(profile, direction, 400, 100)).toBe("good");
      expect(shapeFit(profile, direction, 100, 400)).toBe("warn_axis");
    }
  });

  it("左右に伸びる（左・右）なら、縦長の枠が適", () => {
    for (const direction of ["left", "right"] as const) {
      expect(shapeFit(profile, direction, 100, 400)).toBe("good");
      expect(shapeFit(profile, direction, 400, 100)).toBe("warn_axis");
    }
  });
});

describe("細長いことの下限", () => {
  it("縦横比が足りなければ、向きを問わず「もっと細長く」（向きの判定より先）", () => {
    for (const longSide of ["along", "across"] as const) {
      for (const direction of DIRECTIONS) {
        expect(shapeFit({ shape: "long", longSide }, direction, 100, 100)).toBe("warn_short");
        expect(shapeFit({ shape: "long", longSide }, direction, 159, 100)).toBe("warn_short");
        expect(shapeFit({ shape: "long", longSide }, direction, 100, 159)).toBe("warn_short");
      }
    }
  });

  it("下限ちょうどから細長いとみなして、向きを確かめる", () => {
    const profile: FitProfile = { shape: "long", longSide: "along" };
    expect(shapeFit(profile, "left", 100 * LONG_MIN_RATIO, 100)).toBe("good");
    expect(shapeFit(profile, "left", 100, 100 * LONG_MIN_RATIO)).toBe("warn_axis");
  });

  it("縦横が同じ向き（正方形に近い）でも、細長いものには適にならない", () => {
    expect(shapeFit({ shape: "long", longSide: "along" }, "left", 100, 100)).not.toBe("good");
  });
});

describe("向きが決まっていない細長いもの", () => {
  it("方向なしは縦の流れとして扱う（モックと同じ）", () => {
    expect(shapeFit({ shape: "long", longSide: "along" }, null, 100, 400)).toBe("good");
    expect(shapeFit({ shape: "long", longSide: "across" }, null, 400, 100)).toBe("good");
  });
});

describe("大きさの端", () => {
  it("0以下の大きさでも、例外にならず判定を返す", () => {
    const results: ShapeFit[] = [
      shapeFit({ shape: "long", longSide: "along" }, "left", 0, 0),
      shapeFit({ shape: "compact" }, null, 0, 50),
      shapeFit({ shape: "tall" }, null, 0, 0),
      shapeFit({ shape: "free" }, null, -5, -5),
    ];
    expect(results).toEqual(["warn_short", "warn_long", "good", "good"]);
  });
});

function instance(kind: ModuleKind, options: object = {}): Pick<Instance, "kind" | "options"> {
  return { kind, options } as Pick<Instance, "kind" | "options">;
}

describe("インスタンスの判定の指定（fitProfileOf）", () => {
  it("レベルとスペクトラムは長辺が流れと直角、波形と重心と変化量は流れに沿う", () => {
    expect(fitProfileOf(instance("level"), "long")).toEqual({ shape: "long", longSide: "across" });
    expect(fitProfileOf(instance("spec"), "long")).toEqual({ shape: "long", longSide: "across" });
    expect(fitProfileOf(instance("wave"), "long")).toEqual({ shape: "long", longSide: "along" });
    expect(fitProfileOf(instance("centroid"), "long")).toEqual({ shape: "long", longSide: "along" });
  });

  it("推奨の形が正方形に近い・形を選ばないものは、そのまま", () => {
    expect(fitProfileOf(instance("loud"), "compact")).toEqual({ shape: "compact" });
    expect(fitProfileOf(instance("stereo", { mode: "lissajous" }), "compact")).toEqual({ shape: "compact" });
    expect(fitProfileOf(instance("gram"), "free")).toEqual({ shape: "free" });
  });

  it("位相の表示方式が周波数別の定位なら、縦長を求める", () => {
    expect(fitProfileOf(instance("stereo", { mode: "pan" }), "compact")).toEqual({ shape: "tall" });
  });

  it("モジュールの定義の推奨の形から、登録済みの全種類で判定できる", () => {
    for (const definition of moduleRegistry.list()) {
      const profile = fitProfileOf(instance(definition.kind, definition.defaultOptions), definition.shape);
      expect(shapeFit(profile, definition.baseDirection, 200, 200)).toBeTypeOf("string");
    }
  });

  it("既定の向きで、既定に近い枠（モックの見本）の判定が適になる", () => {
    const fitOf = (kind: ModuleKind, w: number, h: number) => {
      const definition = moduleRegistry.get(kind)!;
      return shapeFit(fitProfileOf(instance(kind, definition.defaultOptions), definition.shape), definition.baseDirection, w, h);
    };
    expect(fitOf("level", 300, 120)).toBe("good");
    expect(fitOf("level", 120, 300)).toBe("warn_axis");
    expect(fitOf("wave", 600, 120)).toBe("good");
    expect(fitOf("spec", 400, 150)).toBe("good");
    expect(fitOf("loud", 150, 150)).toBe("good");
    expect(fitOf("gram", 500, 80)).toBe("good");
  });
});
