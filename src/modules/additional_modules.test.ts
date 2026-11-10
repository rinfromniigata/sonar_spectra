// 追加のモジュール（VU・クロマ・重心と変化量）を、本物のレジストリで、構成の流れに通して確かめる（W8-8）。
// 個々の部品（自動整列・有効化・方向・速さ）の単体テストは各所にある。ここでは、追加の3種類の定義の値と組み合わさったときの振る舞いを見る。

import { describe, expect, it } from "vitest";
import { createDefaultInstances } from "../config/default_instances";
import { normalizeSpeed, setSpeed } from "../config/instance_settings";
import type { Instance } from "../config/types";
import { autoArrange } from "../layout/auto_arrange";
import { NEW_INSTANCE_SIZES, setDirection, setInstanceEnabled, type Layout } from "../layout/manual";
import "./index"; // 本物のモジュールを登録する
import { moduleRegistry } from "./registry";

const ADDED = ["vu", "chroma", "centroid"] as const;
const ASPECTS = [16 / 9, 4 / 3, 1, 3 / 4, 21 / 9, 9 / 16];

function defaults(): Instance[] {
  let n = 0;
  return createDefaultInstances(moduleRegistry, () => `id${n++}`);
}
const ofKind = (instances: readonly Instance[], kind: string) => instances.filter((i) => i.kind === kind);

describe("追加のモジュール：初期状態", () => {
  it("VU・クロマ・重心と変化量は無効で、自動整列に入らない", () => {
    const instances = defaults();
    for (const kind of ADDED) {
      const [instance] = ofKind(instances, kind);
      expect(instance, kind).toBeDefined();
      expect(instance.enabled, kind).toBe(false);
    }
    for (const aspect of ASPECTS) {
      const { rects } = autoArrange(instances, aspect);
      for (const kind of ADDED) expect(rects.has(ofKind(instances, kind)[0].id), `${kind} @${aspect}`).toBe(false);
      // 初期の有効なインスタンスは、これまでどおりすべて置かれる
      for (const i of instances.filter((x) => x.enabled)) expect(rects.has(i.id), `${i.kind} @${aspect}`).toBe(true);
    }
  });
});

describe("追加のモジュール：レイアウト編集で有効にする", () => {
  for (const mode of ["auto", "manual"] as const) {
    it(`${mode}配置：有効にすると置かれ、ほかのモジュールと重ならない`, () => {
      let instances = defaults();
      if (mode === "manual") {
        const { rects } = autoArrange(instances, 16 / 9);
        instances = instances.map((i) => ({ ...i, rect: rects.get(i.id) ?? null }) as Instance);
      }
      let layout: Layout = { mode, instances };
      if (mode === "manual") {
        // 自動整列の結果は格子を埋めているので、そのままでは置けない（置き場所がなく、変えない）。空きを作ると置ける
        const vu = ofKind(layout.instances, "vu")[0].id;
        expect(setInstanceEnabled(layout, vu, true, NEW_INSTANCE_SIZES.compact)).toBeNull();
        const gram = ofKind(layout.instances, "gram")[0].id;
        layout = setInstanceEnabled(layout, gram, false, NEW_INSTANCE_SIZES.free)!;
        expect(layout).not.toBeNull();
      }
      for (const kind of ADDED) {
        const id = ofKind(layout.instances, kind)[0].id;
        const size = NEW_INSTANCE_SIZES[moduleRegistry.get(kind)!.shape];
        const next = setInstanceEnabled(layout, id, true, size);
        expect(next, kind).not.toBeNull();
        layout = next!;
        expect(ofKind(layout.instances, kind)[0].enabled, kind).toBe(true);
      }
      if (mode === "auto") {
        for (const aspect of ASPECTS) {
          const { rects } = autoArrange(layout.instances, aspect);
          for (const kind of ADDED) expect(rects.has(ofKind(layout.instances, kind)[0].id), `${kind} @${aspect}`).toBe(true);
          expectNoOverlap([...rects.values()], aspect);
        }
      } else {
        const placed = layout.instances.filter((i) => i.enabled && i.rect);
        for (const kind of ADDED) expect(ofKind(placed, kind), kind).toHaveLength(1);
        expectNoOverlap(placed.map((i) => i.rect!), 0);
      }
    });
  }
});

function expectNoOverlap(rects: { c: number; r: number; cs: number; rs: number }[], label: number): void {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.c < b.c + b.cs && b.c < a.c + a.cs && a.r < b.r + b.rs && b.r < a.r + a.rs;
      expect(overlap, `overlap ${JSON.stringify(a)} / ${JSON.stringify(b)} @${label}`).toBe(false);
    }
  }
}

describe("追加のモジュール：方向と速さ", () => {
  it("重心と変化量は、方向を変えられ、流れる速さを範囲に収めて変えられる", () => {
    const instances = defaults();
    const centroid = ofKind(instances, "centroid")[0];
    expect(centroid.direction).toBe("left");
    const turned = setDirection(instances, centroid.id, "right");
    expect(turned).not.toBeNull();
    expect(ofKind(turned!, "centroid")[0].direction).toBe("right");
    expect(setDirection(instances, centroid.id, "left")).toBeNull(); // 同じ値は書かない

    const faster = setSpeed(instances, centroid.id, 2);
    expect((ofKind(faster!, "centroid")[0].options as { speed: number }).speed).toBe(2);
    const clamped = setSpeed(instances, centroid.id, 99);
    expect((ofKind(clamped!, "centroid")[0].options as { speed: number }).speed).toBe(normalizeSpeed(99));
    expect(moduleRegistry.get("centroid")!.flows).toBe(true);
  });

  it("VUとクロマは流れず、方向を持たない（設定に方向・速さを出さない）", () => {
    const instances = defaults();
    for (const kind of ["vu", "chroma"] as const) {
      const definition = moduleRegistry.get(kind)!;
      const instance = ofKind(instances, kind)[0];
      expect(definition.flows, kind).toBe(false);
      expect(definition.baseDirection, kind).toBeNull();
      expect(instance.direction, kind).toBeNull();
      expect(setDirection(instances, instance.id, "left"), kind).toBeNull();
      expect(setSpeed(instances, instance.id, 2), kind).toBeNull();
    }
  });
});
