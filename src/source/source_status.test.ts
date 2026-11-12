import { describe, expect, it } from "vitest";
import { centerNotice, chipView, overlayMode, type DeviceInfo, type SourceStatus, type SourceStatusEvent } from "./source_status";

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

  it("macOS では、デバイス名つきの文言だけが source.chip_loopback_mac になる（S09）", () => {
    expect(chipView(event({ state: "live" }), "macos")).toEqual({
      status: "live",
      messageKey: "source.chip_loopback_mac",
      device: "スピーカー (Realtek)",
    });
    expect(chipView(event({ state: "opening" }), "macos").messageKey).toBe("source.chip_loopback_mac");
    expect(chipView(event({ state: "silent" }), "macos").messageKey).toBe("source.chip_silent");
    expect(chipView(event({ state: "unavailable", reason: "notFound" }, null), "macos").messageKey).toBe(
      "source.chip_unavailable",
    );
    expect(chipView(event({ state: "live" }, null), "macos").messageKey).toBe("status.opening");
    // Windows とそれ以外は今のまま
    expect(chipView(event({ state: "live" }), "windows").messageKey).toBe("source.chip_live");
    expect(chipView(event({ state: "live" }), "other").messageKey).toBe("source.chip_live");
  });
});

describe("overlayMode", () => {
  it("取得中は何も重ねず、無音・起動中・使えないを、それぞれの表示にする", () => {
    expect(overlayMode(event({ state: "live" }))).toBe("none");
    expect(overlayMode(event({ state: "silent" }))).toBe("silent");
    expect(overlayMode(event({ state: "opening" }))).toBe("opening");
    expect(overlayMode(event({ state: "unavailable", reason: "inUse" }, null))).toBe("unavailable");
  });

  it("まだ状態が届いていない起動直後は、起動中として扱う", () => {
    expect(overlayMode(null)).toBe("opening");
  });
});

describe("centerNotice（入力源の状態 × 描画の層の状態 → 中央の表示）", () => {
  const states: [string, SourceStatusEvent | null][] = [
    ["取得中", event({ state: "live" })],
    ["無音", event({ state: "silent" })],
    ["起動中", event({ state: "opening" })],
    ["使えない", event({ state: "unavailable", reason: "inUse" }, null)],
    ["状態が未着", null],
  ];

  it("描画の層が使えるときは、今までどおり入力源の状態の表示だけ", () => {
    expect(centerNotice(event({ state: "live" }), false)).toEqual({ renderUnavailable: false, overlay: false });
    expect(centerNotice(event({ state: "silent" }), false)).toEqual({ renderUnavailable: false, overlay: true });
    expect(centerNotice(event({ state: "opening" }), false)).toEqual({ renderUnavailable: false, overlay: true });
    expect(centerNotice(event({ state: "unavailable", reason: "inUse" }, null), false)).toEqual({ renderUnavailable: false, overlay: true });
  });

  it("描画を開始できないとき：取得中・無音は描画を開始できない表示だけ（無音の表示は出さない）", () => {
    expect(centerNotice(event({ state: "live" }), true)).toEqual({ renderUnavailable: true, overlay: false });
    expect(centerNotice(event({ state: "silent" }), true)).toEqual({ renderUnavailable: true, overlay: false });
  });

  it("描画を開始できないとき：使えない・開いている途中（未着を含む）は入力源の表示だけ", () => {
    expect(centerNotice(event({ state: "unavailable", reason: "inUse" }, null), true)).toEqual({ renderUnavailable: false, overlay: true });
    expect(centerNotice(event({ state: "opening" }), true)).toEqual({ renderUnavailable: false, overlay: true });
    expect(centerNotice(null, true)).toEqual({ renderUnavailable: false, overlay: true });
  });

  it("どの組み合わせでも、中央に出すのは多くて1つ", () => {
    for (const [, state] of states) {
      for (const unavailable of [false, true]) {
        for (const editing of [false, true]) {
          const notice = centerNotice(state, unavailable, editing);
          expect(notice.renderUnavailable && notice.overlay).toBe(false);
        }
      }
    }
  });

  it("編集中は入力源の表示を出さないので、描画を開始できないときはその表示を出す", () => {
    expect(centerNotice(event({ state: "opening" }), true, true)).toEqual({ renderUnavailable: true, overlay: false });
    expect(centerNotice(event({ state: "silent" }), false, true)).toEqual({ renderUnavailable: false, overlay: false });
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
