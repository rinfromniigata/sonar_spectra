import { describe, expect, it } from "vitest";
import { getPlatform } from "./platform";

describe("getPlatform", () => {
  it("Rust の get_platform が返した OS の種類をそのまま返す", async () => {
    for (const name of ["windows", "macos", "other"] as const) {
      const calls: string[] = [];
      const platform = await getPlatform((cmd) => {
        calls.push(cmd);
        return Promise.resolve(name);
      });
      expect(platform).toBe(name);
      expect(calls).toEqual(["get_platform"]);
    }
  });

  it("呼べないとき（Tauri の外）や知らない値のときは other", async () => {
    expect(await getPlatform(() => Promise.reject(new Error("no tauri")))).toBe("other");
    expect(await getPlatform(() => Promise.resolve("linux"))).toBe("other");
    expect(await getPlatform(() => Promise.resolve(null))).toBe("other");
  });
});
