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
