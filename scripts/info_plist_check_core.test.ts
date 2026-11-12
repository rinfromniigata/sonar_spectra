import { describe, expect, it } from "vitest";
import { checkInfoPlist, readPlistString } from "./info_plist_check_core";

const plist = (value: string) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <!-- <key>NSAudioCaptureUsageDescription</key><string>コメントの中は読まない</string> -->
  <key>NSAudioCaptureUsageDescription</key>
  <string>${value}</string>
  <key>Other</key>
  <string>ほか</string>
</dict>
</plist>`;

const pairs = { NSAudioCaptureUsageDescription: "bundle.audio_capture_usage" };

describe("readPlistString", () => {
  it("キーの次の文字列を、実体参照を戻して取り出す", () => {
    expect(readPlistString(plist("音 &amp; 光 &lt;&#x41;&#66;&gt;"), "NSAudioCaptureUsageDescription")).toBe(
      "音 & 光 <AB>",
    );
    expect(readPlistString(plist("x"), "Other")).toBe("ほか");
  });
  it("ないキーは undefined", () => {
    expect(readPlistString(plist("x"), "Missing")).toBeUndefined();
  });
});

describe("checkInfoPlist", () => {
  const messages = new Map([["bundle.audio_capture_usage", "用途の説明"]]);

  it("一致していれば問題なし", () => {
    expect(checkInfoPlist(plist("用途の説明"), messages, pairs)).toEqual([]);
  });
  it("食い違い・plist にない・辞書にないを見つける", () => {
    expect(checkInfoPlist(plist("古い説明"), messages, pairs).map((i) => i.kind)).toEqual(["mismatch"]);
    expect(checkInfoPlist("<plist><dict></dict></plist>", messages, pairs).map((i) => i.kind)).toEqual([
      "missing_in_plist",
    ]);
    expect(checkInfoPlist(plist("用途の説明"), new Map(), pairs).map((i) => i.kind)).toEqual([
      "missing_in_messages",
    ]);
  });
});
