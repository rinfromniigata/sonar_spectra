import { describe, expect, it } from "vitest";
import type { GridRect, Instance } from "../config/types";
import type { ModuleKind, Shape } from "../modules/options";
import { autoArrange } from "./auto_arrange";
import { GRID_COLUMNS, GRID_ROWS, insideGrid, overlaps } from "./grid";
import {
  addInstance,
  arrowDelta,
  beginManual,
  duplicateInstance,
  findSplitters,
  moveBy,
  moveSplitter,
  moveTo,
  pinAutoLayout,
  placeNewRect,
  resizeBy,
  resizeTo,
  returnToAuto,
  setInstanceEnabled,
  splitterStep,
  swapRects,
  type Layout,
} from "./manual";

const SHAPES: Record<ModuleKind, Shape> = {
  level: "long",
  wave: "long",
  spec: "long",
  stereo: "compact",
  gram: "free",
  loud: "compact",
  vu: "compact",
  chroma: "compact",
  centroid: "long",
};
const shapeOf = (kind: ModuleKind) => SHAPES[kind];

function inst(id: string, rect: GridRect | null, extra: Partial<Instance> = {}): Instance {
  return {
    id,
    kind: "spec",
    enabled: true,
    rect,
    direction: "up",
    paletteId: "preset.a",
    sourceId: "default",
    options: { mode: "fill", ghost: true },
    ...extra,
  } as Instance;
}

const R = (c: number, r: number, cs: number, rs: number): GridRect => ({ c, r, cs, rs });
const rectOf = (instances: readonly Instance[] | null, id: string) => instances?.find((i) => i.id === id)?.rect ?? null;

/** 既定の構成（imple 5.2 の1）。自動配置 */
function defaults(): Instance[] {
  const kinds: [string, ModuleKind, Partial<Instance>][] = [
    ["level", "level", {}],
    ["wave", "wave", { direction: "left" }],
    ["spec", "spec", {}],
    ["stereo", "stereo", { direction: null }],
    ["gram", "gram", { direction: "left" }],
    ["loud", "loud", { direction: null }],
    ["vu", "vu", { enabled: false, direction: null }],
    ["chroma", "chroma", { enabled: false, direction: null }],
    ["centroid", "centroid", { enabled: false, direction: "left" }],
    ["pan", "stereo", { slot: "pan", direction: null }],
  ];
  return kinds.map(([id, kind, extra]) => inst(id, null, { kind, ...extra } as Partial<Instance>));
}

/** 有効なものが格子の中で1マス以上あり、互いに重ならない */
function expectValid(instances: readonly Instance[]) {
  const placed = instances.filter((i) => i.enabled && i.rect);
  for (const a of placed) {
    expect(insideGrid(a.rect!), `${a.id} が格子の外`).toBe(true);
    for (const b of placed) {
      if (a !== b) expect(overlaps(a.rect!, b.rect!), `${a.id} と ${b.id} が重なる`).toBe(false);
    }
  }
}

describe("自動から手動への固定", () => {
  it("その時点の自動整列の位置を固定し、無効なものは位置を持たない", () => {
    const layout: Layout = { mode: "auto", instances: defaults() };
    const auto = autoArrange(layout.instances, 16 / 9, shapeOf);
    const manual = beginManual(layout, 16 / 9, shapeOf);
    expect(manual.mode).toBe("manual");
    for (const instance of manual.instances) {
      if (instance.enabled) expect(instance.rect).toEqual(auto.rects.get(instance.id));
      else expect(instance.rect).toBeNull();
    }
    // 元の配置は書き換えない
    expect(layout.mode).toBe("auto");
    expect(layout.instances.every((i) => i.rect === null)).toBe(true);
  });

  it("縦長の帯では、自動整列が横に倒したレベルの向きも固定する", () => {
    const manual = beginManual({ mode: "auto", instances: defaults() }, 0.8, shapeOf);
    expect(manual.instances.find((i) => i.id === "level")!.direction).toBe("right");
    expect(manual.instances.find((i) => i.id === "spec")!.direction).toBe("up");
  });

  it("置き場所のなかった有効なものは無効にする", () => {
    const instances = [inst("a", null), inst("b", null)];
    const pinned = pinAutoLayout(instances, { band: "wide", rects: new Map([["a", R(1, 1, 12, 8)]]), directions: new Map() });
    expect(pinned[1]).toMatchObject({ enabled: false, rect: null });
  });

  it("すでに手動配置ならそのまま。「自動整列」で自動に戻り、位置を捨てる", () => {
    const manual = beginManual({ mode: "auto", instances: defaults() }, 16 / 9, shapeOf);
    expect(beginManual(manual, 0.5, shapeOf)).toBe(manual);
    const auto = returnToAuto(manual);
    expect(auto.mode).toBe("auto");
    expect(auto.instances.every((i) => i.rect === null)).toBe(true);
  });
});

describe("移動", () => {
  const two = [inst("a", R(1, 1, 3, 2)), inst("b", R(7, 1, 3, 2))];

  it("空いているところへ動かす", () => {
    expect(rectOf(moveTo(two, "a", { c: 2, r: 4 }), "a")).toEqual(R(2, 4, 3, 2));
  });

  it("ほかのモジュールと重なるときは動かさない", () => {
    expect(moveTo(two, "a", { c: 5, r: 1 })).toBeNull();
  });

  it("格子からはみ出す分は端に寄せ、変わらなければ null", () => {
    expect(rectOf(moveTo(two, "a", { c: -3, r: 20 }), "a")).toEqual(R(1, 7, 3, 2));
    expect(moveTo(two, "a", { c: 0, r: 0 })).toBeNull();
  });

  it("矢印キーで1マスずつ動き、端とほかのモジュールで止まる", () => {
    expect(rectOf(moveBy(two, "a", 1, 0), "a")).toEqual(R(2, 1, 3, 2));
    expect(rectOf(moveBy(two, "a", 0, 1), "a")).toEqual(R(1, 2, 3, 2));
    expect(moveBy(two, "a", -1, 0)).toBeNull();
    expect(moveBy(two, "a", 0, -1)).toBeNull();
    const near = [inst("a", R(1, 1, 3, 2)), inst("b", R(4, 1, 3, 2))];
    expect(moveBy(near, "a", 1, 0)).toBeNull();
  });

  it("無効なもの・位置のないものは動かさず、無効なものの位置は重なりに数えない", () => {
    const withOff = [...two, inst("off", R(1, 4, 3, 2), { enabled: false })];
    expect(moveTo(withOff, "off", { c: 1, r: 6 })).toBeNull();
    expect(rectOf(moveTo(withOff, "a", { c: 1, r: 4 }), "a")).toEqual(R(1, 4, 3, 2));
  });

  it("入れ替えは大きさごと位置を交換する", () => {
    const swapped = swapRects(two, "a", "b");
    expect(rectOf(swapped, "a")).toEqual(R(7, 1, 3, 2));
    expect(rectOf(swapped, "b")).toEqual(R(1, 1, 3, 2));
    expect(swapRects(two, "a", "a")).toBeNull();
    expect(swapRects(two, "a", "none")).toBeNull();
  });
});

describe("大きさの変更（右下の角）", () => {
  const two = [inst("a", R(1, 1, 3, 2)), inst("b", R(7, 1, 3, 2))];

  it("空いていればその大きさに、ほかのモジュールに当たれば手前まで", () => {
    expect(rectOf(resizeTo(two, "a", { cs: 5, rs: 4 }), "a")).toEqual(R(1, 1, 5, 4));
    // 横は b の手前（6列目）まで、縦は求めたとおり
    expect(rectOf(resizeTo(two, "a", { cs: 9, rs: 3 }), "a")).toEqual(R(1, 1, 6, 3));
  });

  it("1マス未満にせず、格子からはみ出す分は端までにする", () => {
    expect(rectOf(resizeTo(two, "a", { cs: 0, rs: -2 }), "a")).toEqual(R(1, 1, 1, 1));
    expect(rectOf(resizeTo(two, "b", { cs: 20, rs: 20 }), "b")).toEqual(R(7, 1, 6, 8));
    expect(resizeTo(two, "a", { cs: 3, rs: 2 })).toBeNull();
  });

  it("矢印キーで1マスずつ変わり、1マス未満・端・ほかのモジュールで止まる", () => {
    expect(rectOf(resizeBy(two, "a", 1, 0), "a")).toEqual(R(1, 1, 4, 2));
    expect(rectOf(resizeBy(two, "a", 0, -1), "a")).toEqual(R(1, 1, 3, 1));
    const thin = [inst("a", R(1, 1, 1, 1)), inst("b", R(2, 1, 1, 1))];
    expect(resizeBy(thin, "a", -1, 0)).toBeNull();
    expect(resizeBy(thin, "a", 1, 0)).toBeNull();
    expect(resizeBy([inst("a", R(12, 8, 1, 1))], "a", 1, 0)).toBeNull();
  });
});

describe("境界線", () => {
  // 左に a（上下2つ）、右に b（全高）。下の段には線をまたぐ c
  const layout = [
    inst("a1", R(1, 1, 6, 2)),
    inst("a2", R(1, 3, 6, 2)),
    inst("b", R(7, 1, 6, 4)),
    inst("c", R(1, 5, 12, 4)),
  ];

  it("辺を接する組を、線に沿ってつながる単位で見つける", () => {
    const splitters = findSplitters(layout);
    expect(splitters).toContainEqual({ axis: "v", line: 7, before: ["a1", "a2"], after: ["b"], start: 1, end: 5 });
    expect(splitters).toContainEqual({ axis: "h", line: 3, before: ["a1"], after: ["a2"], start: 1, end: 7 });
    expect(splitters).toContainEqual({ axis: "h", line: 5, before: ["a2", "b"], after: ["c"], start: 1, end: 13 });
    expect(splitters).toHaveLength(3);
  });

  it("線をまたぐモジュールで途切れた線は、別の境界線になる", () => {
    const split = [
      inst("l1", R(1, 1, 6, 3)),
      inst("r1", R(7, 1, 6, 3)),
      inst("mid", R(1, 4, 12, 2)),
      inst("l2", R(1, 6, 6, 3)),
      inst("r2", R(7, 6, 6, 3)),
    ];
    const v7 = findSplitters(split).filter((s) => s.axis === "v" && s.line === 7);
    expect(v7.map((s) => [s.before, s.after])).toEqual([
      [["l1"], ["r1"]],
      [["l2"], ["r2"]],
    ]);
  });

  it("無効なものは境界線を作らない", () => {
    const withOff = [inst("a", R(1, 1, 6, 8)), inst("b", R(7, 1, 6, 8), { enabled: false })];
    expect(findSplitters(withOff)).toEqual([]);
  });

  it("両側の大きさを同時に変える", () => {
    const v7 = findSplitters(layout).find((s) => s.axis === "v" && s.line === 7)!;
    const moved = moveSplitter(layout, v7, 9)!;
    expect(rectOf(moved, "a1")).toEqual(R(1, 1, 8, 2));
    expect(rectOf(moved, "a2")).toEqual(R(1, 3, 8, 2));
    expect(rectOf(moved, "b")).toEqual(R(9, 1, 4, 4));
    expect(rectOf(moved, "c")).toEqual(R(1, 5, 12, 4));
    expectValid(moved);
  });

  it("どちらかが1マス未満になる手前で止まり、少しも動かせなければ null", () => {
    const v7 = findSplitters(layout).find((s) => s.axis === "v" && s.line === 7)!;
    expect(rectOf(moveSplitter(layout, v7, 20), "b")).toEqual(R(12, 1, 1, 4));
    expect(rectOf(moveSplitter(layout, v7, -5), "a1")).toEqual(R(1, 1, 1, 2));
    const atEdge = moveSplitter(layout, v7, 12)!;
    expect(moveSplitter(atEdge, v7, 13)).toBeNull();
    expect(moveSplitter(layout, v7, 7)).toBeNull();
  });

  it("ドラッグ中は、つかんだときの境界線を渡し続けても今の位置から動く", () => {
    const v7 = findSplitters(layout).find((s) => s.axis === "v" && s.line === 7)!;
    const first = moveSplitter(layout, v7, 9)!;
    const second = moveSplitter(first, v7, 8)!;
    expect(rectOf(second, "b")).toEqual(R(8, 1, 5, 4));
  });

  it("広がる側がほかのモジュールに当たるときは手前で止まる", () => {
    // a は4行、b は上の2行だけ。a の右下（7〜8列・3〜4行）には d がある
    const blocked = [inst("a", R(1, 1, 6, 4)), inst("b", R(7, 1, 6, 2)), inst("d", R(9, 3, 4, 2))];
    const v7 = findSplitters(blocked).find((s) => s.axis === "v" && s.line === 7)!;
    expect(v7.before).toEqual(["a"]);
    const moved = moveSplitter(blocked, v7, 11)!;
    expect(rectOf(moved, "a")).toEqual(R(1, 1, 8, 4));
    expect(rectOf(moved, "b")).toEqual(R(9, 1, 4, 2));
    expectValid(moved);
  });

  it("矢印キー：縦の線は左右、横の線は上下で1マスずつ", () => {
    expect(splitterStep("v", "ArrowLeft")).toBe(-1);
    expect(splitterStep("v", "ArrowRight")).toBe(1);
    expect(splitterStep("v", "ArrowUp")).toBeNull();
    expect(splitterStep("h", "ArrowDown")).toBe(1);
    expect(splitterStep("h", "Enter")).toBeNull();
    expect(arrowDelta("ArrowUp")).toEqual({ dc: 0, dr: -1 });
    expect(arrowDelta("a")).toBeNull();
    const h3 = findSplitters(layout).find((s) => s.axis === "h" && s.line === 3)!;
    const moved = moveSplitter(layout, h3, h3.line + splitterStep("h", "ArrowDown")!)!;
    expect(rectOf(moved, "a1")).toEqual(R(1, 1, 6, 3));
    expect(rectOf(moved, "a2")).toEqual(R(1, 4, 6, 1));
  });
});

describe("空きを探して置く（複製・追加・有効に戻す）", () => {
  it("空きは左上から（上の行から、行の中は左から）探す", () => {
    const instances = [inst("a", R(1, 1, 4, 2)), inst("b", R(7, 1, 6, 2))];
    expect(placeNewRect(instances, { cs: 2, rs: 2 })).toEqual(R(5, 1, 2, 2));
    expect(placeNewRect(instances, { cs: 3, rs: 2 })).toEqual(R(1, 3, 3, 2));
  });

  it("自動配置の複製は、位置を持たず複製元のすぐ後ろに入り、設定を受け継ぐ（別の写し）", () => {
    const layout: Layout = { mode: "auto", instances: defaults() };
    const next = duplicateInstance(layout, "spec", "spec-2")!;
    const ids = next.instances.map((i) => i.id);
    expect(ids.indexOf("spec-2")).toBe(ids.indexOf("spec") + 1);
    const source = next.instances.find((i) => i.id === "spec")!;
    const copy = next.instances.find((i) => i.id === "spec-2")!;
    expect(copy).toMatchObject({ kind: "spec", enabled: true, rect: null, direction: source.direction, paletteId: source.paletteId });
    expect(copy.options).toEqual(source.options);
    expect(copy.options).not.toBe(source.options);
  });

  it("専用の位置（周波数別の定位）も受け継ぐ", () => {
    const next = duplicateInstance({ mode: "auto", instances: defaults() }, "pan", "pan-2")!;
    expect(next.instances.find((i) => i.id === "pan-2")!.slot).toBe("pan");
  });

  it("手動配置の複製は、同じ大きさの空きに置く", () => {
    const layout: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 4, 3)), inst("b", R(5, 1, 8, 3))] };
    const next = duplicateInstance(layout, "a", "a-2")!;
    expect(rectOf(next.instances, "a-2")).toEqual(R(1, 4, 4, 3));
    expectValid(next.instances);
  });

  it("同じ大きさの空きがなければ1マスの空きに、1マスの空きもなければ無効で加える", () => {
    const almostFull: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 12, 7)), inst("b", R(1, 8, 11, 1))] };
    expect(rectOf(duplicateInstance(almostFull, "a", "a-2")!.instances, "a-2")).toEqual(R(12, 8, 1, 1));
    const full: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 12, 8))] };
    const next = duplicateInstance(full, "a", "a-2")!;
    expect(next.instances.find((i) => i.id === "a-2")).toMatchObject({ enabled: false, rect: null });
    expect(next.instances).toHaveLength(2);
  });

  it("自動整列で埋まった格子（既定）での複製は、無効で加わる", () => {
    const manual = beginManual({ mode: "auto", instances: defaults() }, 16 / 9, shapeOf);
    const next = duplicateInstance(manual, "spec", "spec-2")!;
    expect(next.instances.find((i) => i.id === "spec-2")).toMatchObject({ enabled: false, rect: null });
  });

  it("無効なものの複製は無効のまま。ないものは null", () => {
    const layout: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 2, 2), { enabled: false })] };
    expect(duplicateInstance(layout, "a", "a-2")!.instances[1]).toMatchObject({ enabled: false, rect: null });
    expect(duplicateInstance(layout, "none", "x")).toBeNull();
  });

  it("追加：自動配置では位置を持たず、手動配置では空きに置く", () => {
    const fresh = inst("n", R(9, 9, 9, 9));
    expect(addInstance({ mode: "auto", instances: [] }, fresh, { cs: 2, rs: 2 }).instances[0].rect).toBeNull();
    const manual: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 6, 8))] };
    expect(rectOf(addInstance(manual, fresh, { cs: 3, rs: 2 }).instances, "n")).toEqual(R(7, 1, 3, 2));
    const full: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 12, 8))] };
    expect(addInstance(full, fresh, { cs: 3, rs: 2 }).instances[1]).toMatchObject({ enabled: false, rect: null });
  });

  it("無効にしても位置を残し、有効に戻すと空いていれば同じ位置へ、ふさがっていれば別の空きへ", () => {
    const layout: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 4, 2)), inst("b", R(5, 1, 4, 2))] };
    const off = setInstanceEnabled(layout, "a", false, { cs: 1, rs: 1 })!;
    expect(off.instances[0]).toMatchObject({ enabled: false, rect: R(1, 1, 4, 2) });
    expect(setInstanceEnabled(off, "a", true, { cs: 1, rs: 1 })!.instances[0]).toMatchObject({ enabled: true, rect: R(1, 1, 4, 2) });
    const taken = { ...off, instances: [off.instances[0], inst("b", R(1, 1, 8, 2))] };
    expect(rectOf(setInstanceEnabled(taken, "a", true, { cs: 1, rs: 1 })!.instances, "a")).toEqual(R(9, 1, 4, 2));
  });

  it("位置を持たない無効なものを手動配置で有効にするときは、渡した大きさで探し、置けなければ null", () => {
    const layout: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 6, 8)), inst("vu", null, { enabled: false })] };
    expect(rectOf(setInstanceEnabled(layout, "vu", true, { cs: 2, rs: 2 })!.instances, "vu")).toEqual(R(7, 1, 2, 2));
    const full: Layout = { mode: "manual", instances: [inst("a", R(1, 1, 12, 8)), inst("vu", null, { enabled: false })] };
    expect(setInstanceEnabled(full, "vu", true, { cs: 2, rs: 2 })).toBeNull();
    expect(setInstanceEnabled(full, "a", true, { cs: 2, rs: 2 })).toBeNull();
  });

  it("自動配置では切り替えるだけ", () => {
    const next = setInstanceEnabled({ mode: "auto", instances: defaults() }, "vu", true, { cs: 2, rs: 2 })!;
    expect(next.instances.find((i) => i.id === "vu")).toMatchObject({ enabled: true, rect: null });
  });
});

describe("操作を続けても崩れない", () => {
  it("固定した既定の配置に、移動・大きさ変更・境界線・入れ替え・複製をでたらめに重ねても、重ならず1マス未満にならない", () => {
    // 再現できる乱数（線形合同法）
    let seed = 12345;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (const aspect of [3, 2, 16 / 9, 4 / 3, 0.6]) {
      let layout = beginManual({ mode: "auto", instances: defaults() }, aspect, shapeOf);
      for (let step = 0; step < 400; step++) {
        const placed = layout.instances.filter((i) => i.enabled && i.rect);
        const target = placed[random(placed.length)];
        let next: Instance[] | null = null;
        switch (random(6)) {
          case 0:
            next = moveTo(layout.instances, target.id, { c: random(14) - 1, r: random(10) - 1 });
            break;
          case 1:
            next = moveBy(layout.instances, target.id, random(3) - 1, random(3) - 1);
            break;
          case 2:
            next = resizeTo(layout.instances, target.id, { cs: random(14), rs: random(10) });
            break;
          case 3: {
            const splitters = findSplitters(layout.instances);
            if (splitters.length > 0) {
              const s = splitters[random(splitters.length)];
              next = moveSplitter(layout.instances, s, random(s.axis === "v" ? GRID_COLUMNS + 2 : GRID_ROWS + 2));
            }
            break;
          }
          case 4:
            next = swapRects(layout.instances, target.id, placed[random(placed.length)].id);
            break;
          default:
            if (layout.instances.length < 30) next = duplicateInstance(layout, target.id, `dup-${aspect}-${step}`)!.instances;
        }
        if (next) layout = { ...layout, instances: next };
        expectValid(layout.instances);
      }
    }
  });
});
