import { describe, expect, it } from "vitest";
import { iconFingerprint } from "./app_icon_car_core";

const enc = (s: string) => new TextEncoder().encode(s);

describe("iconFingerprint", () => {
  const base = [
    { path: "icon.json", bytes: enc('{\n  "a" : 1\n}\n') },
    { path: "Assets/01_ring.svg", bytes: enc("<svg/>\n") },
  ];

  it("ファイルの並び順によらない", () => {
    expect(iconFingerprint([...base].reverse())).toBe(iconFingerprint(base));
  });

  it("改行が CRLF でも LF と同じになる", () => {
    const crlf = base.map((f) => ({
      path: f.path,
      bytes: enc(new TextDecoder().decode(f.bytes).replaceAll("\n", "\r\n")),
    }));
    expect(iconFingerprint(crlf)).toBe(iconFingerprint(base));
  });

  it("パスの区切りが \\ でも / と同じになる", () => {
    const win = base.map((f) => ({ path: f.path.replaceAll("/", "\\"), bytes: f.bytes }));
    expect(iconFingerprint(win)).toBe(iconFingerprint(base));
  });

  it("中身やファイルが変わると変わる", () => {
    const changed = [base[0], { path: "Assets/01_ring.svg", bytes: enc("<svg />\n") }];
    expect(iconFingerprint(changed)).not.toBe(iconFingerprint(base));
    expect(iconFingerprint(base.slice(0, 1))).not.toBe(iconFingerprint(base));
  });
});
