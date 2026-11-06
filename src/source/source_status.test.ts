import { describe, expect, it } from "vitest";
import { chipView, type DeviceInfo, type SourceStatus, type SourceStatusEvent } from "./source_status";

const DEVICE: DeviceInfo = { id: "id-1", name: "スピーカー (Realtek)", isDefault: true };
const event = (status: SourceStatus, device: DeviceInfo | null = DEVICE): SourceStatusEvent => ({ status, device });

describe("chipView", () => {
  it("取得中は、デバイス名つきの文言と、点灯の色", () => {
    expect(chipView(event({ state: "live" }))).toEqual({
      status: "live",
      messageKey: "source.chip_live",
      device: "スピーカー (Realtek)",
    });
  });

  it("無音のときは、無音の文言と、消灯の色（S01b）", () => {
    expect(chipView(event({ state: "silent" }))).toEqual({ status: "silent", messageKey: "source.chip_silent", device: null });
  });

  it("使えないときは、使えない文言と、危険の色。理由によらず同じ（S01c）", () => {
    for (const reason of ["notFound", "disconnected", "inUse", "other"] as const) {
      expect(chipView(event({ state: "unavailable", reason }, null))).toEqual({
        status: "unavailable",
        messageKey: "source.chip_unavailable",
        device: null,
      });
    }
  });

  it("起動中・切り替え中（S01d）：デバイスが分かればデバイス名つきで消灯、分からなければ「開いています」", () => {
    expect(chipView(event({ state: "opening" }))).toEqual({
      status: "silent",
      messageKey: "source.chip_live",
      device: "スピーカー (Realtek)",
    });
    expect(chipView(event({ state: "opening" }, null))).toEqual({ status: "silent", messageKey: "status.opening", device: null });
  });

  it("まだ状態が届いていない（起動直後）は、起動中として表示する", () => {
    expect(chipView(null)).toEqual({ status: "silent", messageKey: "status.opening", device: null });
  });

  it("取得中なのにデバイスが分からないときは、デバイス名の欠けた文言を出さず「開いています」にする", () => {
    expect(chipView(event({ state: "live" }, null))).toEqual({ status: "live", messageKey: "status.opening", device: null });
  });
});

describe("Rust が送るJSONの形", () => {
  it("StatusEvent のJSON（src-tauri の単体テストと同じ形）を、そのまま型として読める", () => {
    // src-tauri/src/audio_source/mod.rs の status_event_serializes_for_the_ui と同じ中身
    const json =
      '{"status":{"state":"unavailable","reason":"disconnected"},"device":{"id":"id-1","name":"Speakers","isDefault":true}}';
    const parsed = JSON.parse(json) as SourceStatusEvent;
    expect(chipView(parsed).status).toBe("unavailable");
    expect(parsed.device?.isDefault).toBe(true);
    expect((parsed.status as { reason: string }).reason).toBe("disconnected");
    expect(JSON.parse('{"state":"live"}')).toEqual({ state: "live" });
  });
});
