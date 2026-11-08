import { describe, expect, it } from "vitest";
import ja from "../i18n/locales/ja";
import { moduleRegistry } from ".";
import { visibleFields } from "./inspector_fields";
import type { InspectorField, ModuleDefinition } from "./types";
import { waveModule } from "./wave";
import { stereoModule } from "./stereo";
import { specModule } from "./spec";

type AnyOptions = Record<string, unknown>;

function fieldsOf(definition: { inspectorFields: unknown }): InspectorField<AnyOptions>[] {
  return definition.inspectorFields as InspectorField<AnyOptions>[];
}

function keys(fields: readonly InspectorField<AnyOptions>[]): string[] {
  return fields.map((field) => field.key);
}

describe("モジュール定義の設定項目", () => {
  const definitions = moduleRegistry.list() as ModuleDefinition<never>[];

  it("波形・スペクトラム・位相が項目を持ち、設定のないモジュールと、流れる速さだけのスペクトログラムは持たない（速さは共通の項目）", () => {
    const withFields = definitions.filter((d) => d.inspectorFields.length > 0).map((d) => d.kind);
    expect(withFields).toEqual(["wave", "spec", "stereo"]);
  });

  it("項目の key と visibleWhen は、その種類の設定（options）にある。選択肢の既定値は選択肢の中にあり、スライダーの既定値は範囲の中にある", () => {
    for (const definition of definitions) {
      const defaults = definition.defaultOptions as AnyOptions;
      for (const field of fieldsOf(definition)) {
        expect(Object.keys(defaults), `${definition.kind}.${field.key}`).toContain(field.key);
        if (field.visibleWhen) expect(Object.keys(defaults)).toContain(field.visibleWhen.key);
        const value = defaults[field.key];
        if (field.type === "choice") expect(field.choices.map((c) => c.value)).toContain(value);
        if (field.type === "switch") expect(typeof value).toBe("boolean");
        if (field.type === "slider") {
          expect(value as number).toBeGreaterThanOrEqual(field.min);
          expect(value as number).toBeLessThanOrEqual(field.max);
        }
      }
    }
  });

  it("設定（options）の項目は、流れる速さ（共通の項目）を除いてすべて、いずれかの項目から変えられる", () => {
    for (const definition of definitions) {
      const defaults = definition.defaultOptions as AnyOptions;
      const covered = new Set(keys(fieldsOf(definition)));
      for (const key of Object.keys(defaults)) {
        if (key === "speed") continue;
        expect(covered.has(key), `${definition.kind}.${key}`).toBe(true);
      }
    }
  });

  it("文言は辞書にある（項目名・選択肢・注記）", () => {
    const lookup = (key: string): unknown => key.split(".").reduce<unknown>((node, part) => (node as AnyOptions | undefined)?.[part], ja);
    for (const definition of definitions) {
      for (const field of fieldsOf(definition)) {
        expect(typeof lookup(field.labelKey), field.labelKey).toBe("string");
        if (field.type === "choice") {
          for (const choice of field.choices) {
            expect(typeof lookup(choice.labelKey), choice.labelKey).toBe("string");
            if (choice.noteKey) expect(typeof lookup(choice.noteKey), choice.noteKey).toBe("string");
          }
        }
        if (field.type === "slider" && field.noteKey) expect(typeof lookup(field.noteKey), field.noteKey).toBe("string");
      }
    }
  });

  it("波形の項目は、履歴の色・チャンネル・今の波形・境目の順。境目は10〜90%", () => {
    const fields = fieldsOf(waveModule);
    expect(keys(fields)).toEqual(["histColor", "channel", "showNow", "split"]);
    const split = fields[3];
    expect(split).toMatchObject({ type: "slider", min: 10, max: 90, step: 1, format: "percent" });
  });
});

/** 今の設定（一部を差し替えた既定値）で出る項目の key */
function visibleKeys(definition: { inspectorFields: unknown; defaultOptions: unknown }, patch: AnyOptions): string[] {
  const options: AnyOptions = { ...(definition.defaultOptions as AnyOptions), ...patch };
  return keys(visibleFields(fieldsOf(definition), options));
}

describe("visibleFields", () => {
  it("波形：境目は、今の波形を表示するときだけ出す", () => {
    expect(visibleKeys(waveModule, { showNow: true })).toEqual(["histColor", "channel", "showNow", "split"]);
    expect(visibleKeys(waveModule, { showNow: false })).toEqual(["histColor", "channel", "showNow"]);
  });

  it("位相：リサージュのときは点描、周波数別の定位のときはモーションブラーを出す（表示方式は常に）", () => {
    expect(visibleKeys(stereoModule, { mode: "lissajous" })).toEqual(["mode", "dots"]);
    expect(visibleKeys(stereoModule, { mode: "pan" })).toEqual(["mode", "blur"]);
  });

  it("条件のない項目は常に出す（スペクトラム）", () => {
    for (const mode of ["fill", "bars", "mirror", "radial"]) {
      expect(visibleKeys(specModule, { mode })).toEqual(["mode", "ghost"]);
    }
  });
});
