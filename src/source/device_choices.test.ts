import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_VALUE, deviceChoices, deviceIdFromValue } from "./device_choices";

const SPEAKERS = { id: "{dev-1}", name: "スピーカー (Realtek(R) Audio)", isDefault: true };
const HEADPHONES = { id: "{dev-2}", name: "ヘッドホン", isDefault: false };

describe("deviceChoices", () => {
  it("先頭に「既定のデバイス」（今の既定のデバイスの名前つき）を置き、一覧の順にデバイスを並べる", () => {
    expect(deviceChoices([HEADPHONES, SPEAKERS], null)).toEqual([
      { kind: "default", value: DEFAULT_DEVICE_VALUE, defaultName: SPEAKERS.name },
      { kind: "device", value: HEADPHONES.id, name: HEADPHONES.name },
      { kind: "device", value: SPEAKERS.id, name: SPEAKERS.name },
    ]);
  });

  it("一覧が空（まだ読めていない・読めなかった）なら「既定のデバイス」だけで、名前は分からない", () => {
    expect(deviceChoices([], null)).toEqual([{ kind: "default", value: DEFAULT_DEVICE_VALUE, defaultName: null }]);
  });

  it("選んでいるデバイスが一覧にないときは、末尾に「見つからないデバイス」として残す。一覧にあれば足さない", () => {
    expect(deviceChoices([SPEAKERS], "{gone}")[2]).toEqual({ kind: "missing", value: "{gone}" });
    expect(deviceChoices([SPEAKERS, HEADPHONES], HEADPHONES.id).map((c) => c.kind)).toEqual(["default", "device", "device"]);
  });
});

describe("deviceIdFromValue", () => {
  it("「既定のデバイス」の値は null、それ以外はデバイスのID", () => {
    expect(deviceIdFromValue(DEFAULT_DEVICE_VALUE)).toBeNull();
    expect(deviceIdFromValue("{dev-1}")).toBe("{dev-1}");
  });
});
