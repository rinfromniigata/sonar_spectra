import { describe, expect, it } from "vitest";
import type { GridRect, Instance } from "../config/types";
import type { ModuleKind, Shape } from "../modules/options";
import { autoArrange } from "./auto_arrange";
import { GRID_COLUMNS, GRID_ROWS, adjacent, cellCount, insideGrid, overlaps } from "./grid";
import { AREA_KEYS, TEMPLATES, bandFor, type Band } from "./templates";

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

let nextId = 0;
function inst(kind: ModuleKind, extra: Partial<Instance> = {}): Instance {
  return {
    id: `${kind}-${++nextId}`,
    kind,
    enabled: true,
    rect: null,
    direction: kind === "level" || kind === "spec" ? "up" : kind === "wave" || kind === "gram" || kind === "centroid" ? "left" : null,
    paletteId: "preset.a",
    sourceId: "default",
    options: {},
    ...extra,
  } as Instance;
}

/** 既定の構成（imple 5.2 の1）：7つが有効、VU・クロマ・重心と変化量は無効 */
function defaults(): Instance[] {
  return [
    inst("level"),
    inst("wave"),
    inst("spec"),
    inst("stereo"),
    inst("gram"),
    inst("loud"),
    inst("vu", { enabled: false }),
    inst("chroma", { enabled: false }),
    inst("centroid", { enabled: false }),
    inst("stereo", { slot: "pan" }),
  ];
}

const ASPECTS: Record<Band, number> = { strip: 3, wide: 16 / 9, standard: 4 / 3, tall: 9 / 16 };

function expectValid(rects: Map<string, GridRect>, expectedCount: number): void {
  const list = [...rects.values()];
  expect(list).toHaveLength(expectedCount);
  for (const rect of list) {
    expect(insideGrid(rect), JSON.stringify(rect)).toBe(true);
    expect(cellCount(rect)).toBeGreaterThanOrEqual(1);
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      expect(overlaps(list[i], list[j]), `${JSON.stringify(list[i])} / ${JSON.stringify(list[j])}`).toBe(false);
    }
  }
}

describe("テンプレート", () => {
  it.each(Object.keys(TEMPLATES) as Band[])("%s：7つの領域が12×8を重ならずにちょうど埋める", (band) => {
    const areas = AREA_KEYS.map((key) => TEMPLATES[band][key]);
    expect(areas.reduce((sum, a) => sum + cellCount(a), 0)).toBe(GRID_COLUMNS * GRID_ROWS);
    expectValid(new Map(areas.map((a, i) => [String(i), a])), 7);
  });

  it("画面比の帯の境目（2.4／1.5／1.1）", () => {
    expect(bandFor(2.4)).toBe("strip");
    expect(bandFor(2.39)).toBe("wide");
    expect(bandFor(1.5)).toBe("wide");
    expect(bandFor(1.49)).toBe("standard");
    expect(bandFor(1.1)).toBe("standard");
    expect(bandFor(1.09)).toBe("tall");
  });
});

describe("autoArrange", () => {
  it.each(Object.entries(ASPECTS) as [Band, number][])(
    "%s：既定の構成の有効な7つを、重ならず1マス以上で置き、無効なものは置かない",
    (band, aspect) => {
      const list = defaults();
      const layout = autoArrange(list, aspect, shapeOf);
      expect(layout.band).toBe(band);
      expectValid(layout.rects, 7);
      for (const off of list.filter((i) => !i.enabled)) expect(layout.rects.has(off.id)).toBe(false);
      // 2つ目の位相は専用の位置に
      const pan = list.find((i) => i.slot === "pan")!;
      expect(layout.rects.get(pan.id)).toEqual(TEMPLATES[band].pan);
    },
  );

  it.each(Object.entries(ASPECTS) as [Band, number][])("%s：同じ種類の2つ目以降は、1つ目の隣に置く", (_band, aspect) => {
    const list = [...defaults(), inst("spec"), inst("wave"), inst("spec")];
    const layout = autoArrange(list, aspect, shapeOf);
    expectValid(layout.rects, 10);
    for (const kind of ["spec", "wave"] as const) {
      const rects = list.filter((i) => i.kind === kind).map((i) => layout.rects.get(i.id)!);
      // どれも、同じ種類のほかのどれかと辺を接する
      for (const rect of rects) expect(rects.some((other) => other !== rect && adjacent(rect, other))).toBe(true);
    }
  });

  it("縦長ではレベルを右向きにする。ほかの帯では方向を変えない", () => {
    const list = defaults();
    const level = list[0];
    expect(autoArrange(list, ASPECTS.tall, shapeOf).directions.get(level.id)).toBe("right");
    for (const band of ["strip", "wide", "standard"] as const) {
      expect(autoArrange(list, ASPECTS[band], shapeOf).directions.size).toBe(0);
    }
  });

  it("置くもののない領域は隣に吸収され、格子に穴が残らない", () => {
    // 位相（通常）とラウドネスを無効にする
    const list = defaults().map((i) => (i.kind === "loud" || (i.kind === "stereo" && !i.slot) ? { ...i, enabled: false } : i));
    for (const aspect of Object.values(ASPECTS)) {
      const layout = autoArrange(list, aspect, shapeOf);
      expectValid(layout.rects, 5);
      const cells = [...layout.rects.values()].reduce((sum, r) => sum + cellCount(r), 0);
      expect(cells).toBe(GRID_COLUMNS * GRID_ROWS);
    }
  });

  it("テンプレートにない種類（VU など）は、推奨の形が近い領域に相乗りする", () => {
    const list = defaults().map((i) => (i.kind === "vu" || i.kind === "centroid" ? { ...i, enabled: true } : i));
    const layout = autoArrange(list, ASPECTS.wide, shapeOf);
    expectValid(layout.rects, 9);
    const rectOf = (kind: ModuleKind) => layout.rects.get(list.find((i) => i.kind === kind && !i.slot)!.id)!;
    // VU（正方形に近い）はラウドネスの隣、重心と変化量（細長い）はスペクトログラムの隣
    expect(adjacent(rectOf("vu"), rectOf("loud"))).toBe(true);
    expect(adjacent(rectOf("centroid"), rectOf("gram"))).toBe(true);
  });

  it("テンプレートの種類がひとつもなくても、格子に置く", () => {
    const list = [inst("vu"), inst("chroma"), inst("vu")];
    const layout = autoArrange(list, ASPECTS.wide, shapeOf);
    expectValid(layout.rects, 3);
  });

  it("領域より多く置くときは、ほかの位置を分けて全部置く", () => {
    // 縦長のラウドネスの領域は3マス。ラウドネスを6つ置く
    const list = [...defaults(), ...Array.from({ length: 5 }, () => inst("loud"))];
    const layout = autoArrange(list, ASPECTS.tall, shapeOf);
    expectValid(layout.rects, 12);
  });

  it("有効なものがなければ何も置かない", () => {
    const list = defaults().map((i) => ({ ...i, enabled: false }));
    expect(autoArrange(list, ASPECTS.wide, shapeOf).rects.size).toBe(0);
  });
});

describe("autoArrange（広い条件）", () => {
  const MANY_ASPECTS = [0.3, 9 / 16, 1.0, 1.0999, 1.1, 4 / 3, 1.4999, 1.5, 16 / 9, 2.3999, 2.4, 4];
  const KINDS: ModuleKind[] = ["level", "wave", "spec", "stereo", "gram", "loud", "vu", "chroma", "centroid"];

  /**
   * W2-3 の観点（有効なものは全部・無効なものは置かない、12×8の中に重ならず1マス以上、同じ種類は隣、
   * 縦長でレベルは右向き）と、格子に穴が残らないこと（有効なものが1つ以上あれば96マスすべてが埋まる）に
   * 反するところを `failures` に集める。数が多いので、最後に1度だけ確かめる
   */
  function collectProblems(list: Instance[], aspect: number, failures: string[]): void {
    const layout = autoArrange(list, aspect, shapeOf);
    const label = () => `aspect=${aspect} [${list.map((i) => `${i.kind}${i.slot ? "(pan)" : ""}${i.enabled ? "" : "-off"}`).join(",")}]`;
    for (const i of list) if (layout.rects.has(i.id) !== i.enabled) failures.push(`${label()} ${i.kind} placement`);
    const placed = list.filter((i) => i.enabled && layout.rects.has(i.id)).map((i) => [i, layout.rects.get(i.id)!] as const);
    const paint = new Uint8Array(GRID_COLUMNS * GRID_ROWS);
    for (const [i, r] of placed) {
      if (!r || !insideGrid(r)) {
        failures.push(`${label()} ${i.kind} outside ${JSON.stringify(r)}`);
        continue;
      }
      for (let y = r.r; y < r.r + r.rs; y++) for (let x = r.c; x < r.c + r.cs; x++) paint[(y - 1) * GRID_COLUMNS + (x - 1)]++;
    }
    if (paint.some((v) => v > 1)) failures.push(`${label()} overlap`);
    if (placed.length > 0 && paint.some((v) => v === 0)) failures.push(`${label()} hole (${paint.filter((v) => v === 0).length} cells)`);
    for (const [i, r] of placed) {
      const siblings = placed.filter(([o]) => o !== i && o.kind === i.kind && o.slot === i.slot);
      if (siblings.length > 0 && !siblings.some(([, s]) => adjacent(r, s))) failures.push(`${label()} ${i.kind} not adjacent`);
    }
    for (const [i] of placed.filter(([x]) => x.kind === "level")) {
      if (layout.directions.get(i.id) !== (layout.band === "tall" ? "right" : undefined)) failures.push(`${label()} level direction`);
    }
  }

  function expectArranged(list: Instance[], aspect: number): void {
    const failures: string[] = [];
    collectProblems(list, aspect, failures);
    expect(failures).toEqual([]);
  }

  it("既定の7つから1つを無効にしても（よくある操作）、どの帯でも格子に穴が残らない", () => {
    const failures: string[] = [];
    for (let off = 0; off < 7; off++) {
      const list = defaults().filter((i) => i.enabled);
      list[off] = { ...list[off], enabled: false };
      for (const aspect of MANY_ASPECTS) collectProblems(list, aspect, failures);
    }
    expect(failures).toEqual([]);
  });

  it("種類（と2つ目の位相）の有効・無効の全組み合わせで、観点を満たす", () => {
    const failures: string[] = [];
    for (let mask = 0; mask < 1 << 10; mask++) {
      const list = KINDS.map((kind, i) => inst(kind, { enabled: (mask & (1 << i)) !== 0 }));
      list.push(inst("stereo", { slot: "pan", enabled: (mask & (1 << 9)) !== 0 }));
      for (const aspect of MANY_ASPECTS) collectProblems(list, aspect, failures);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("同じ種類を0〜3個ずつ置いた多数の組み合わせ（領域よりモジュールが多いときを含む）で、観点を満たす", () => {
    const failures: string[] = [];
    let seed = 20261106;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let t = 0; t < 300; t++) {
      const list: Instance[] = [];
      for (const kind of KINDS) {
        const count = Math.floor(random() * 4);
        for (let c = 0; c < count; c++) list.push(inst(kind, { enabled: random() < 0.85 }));
      }
      if (random() < 0.7) list.push(inst("stereo", { slot: "pan" }));
      for (const aspect of MANY_ASPECTS) collectProblems(list, aspect, failures);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("標準の帯で、ラウドネスの領域（2×3マス）に6つが相乗りしても、未定義の位置を出さずに全部置く（W2-3 で見つけた不具合）", () => {
    const list = [
      inst("wave"),
      inst("gram"), inst("gram"), inst("gram"),
      inst("loud"),
      inst("vu"), inst("vu"),
      inst("chroma"), inst("chroma"), inst("chroma"),
      inst("centroid"), inst("centroid"),
      inst("stereo", { slot: "pan" }),
    ];
    const layout = autoArrange(list, 1.1, shapeOf);
    expect([...layout.rects.values()].every((r) => r !== undefined)).toBe(true);
    expectArranged(list, 1.1);
  });
});
