import { describe, expect, it } from "vitest";
import { createInstance } from "../config/default_instances";
import type { Instance } from "../config/types";
import { SectionId } from "../frame_client";
import { ModuleRegistry } from "../modules/registry";
import { testDefinition } from "../modules/test_definitions";
import { activeSections } from "./active_sections";

function registry(): ModuleRegistry {
  const r = new ModuleRegistry();
  r.register({ ...testDefinition("level", {}), sections: [SectionId.Level] });
  r.register({
    ...testDefinition("wave", { channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 }),
    sections: [SectionId.Waveform],
  });
  return r;
}

function instance(r: ModuleRegistry, kind: "level" | "wave", enabled: boolean, id: string): Instance {
  return createInstance(r.get(kind)!, { enabled }, id) as Instance;
}

describe("activeSections", () => {
  it("有効なインスタンスが必要とするセクションの和を、重なりなく昇順で返す", () => {
    const r = registry();
    const list = [instance(r, "wave", true, "1"), instance(r, "level", true, "2"), instance(r, "wave", true, "3")];
    expect(activeSections(list, r)).toEqual([SectionId.Level, SectionId.Waveform]);
  });

  it("無効なインスタンスと、登録のない種類は数えない", () => {
    const r = registry();
    const vu = { ...instance(r, "level", true, "x"), kind: "vu", options: {} } as Instance;
    const list = [instance(r, "level", false, "1"), instance(r, "wave", true, "2"), vu];
    expect(activeSections(list, r)).toEqual([SectionId.Waveform]);
  });

  it("有効なものがなければ空", () => {
    const r = registry();
    expect(activeSections([instance(r, "level", false, "1")], r)).toEqual([]);
    expect(activeSections([], r)).toEqual([]);
  });
});
