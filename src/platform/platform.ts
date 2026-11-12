// アプリが動いているOSの種類（Rust の get_platform。imple 3.5・3.6）。タイトル帯の形と全画面の方式を選ぶ。

import { invoke } from "@tauri-apps/api/core";

export type Platform = "windows" | "macos" | "other";

const PLATFORMS: readonly Platform[] = ["windows", "macos", "other"];

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

/**
 * OSの種類を問い合わせる。Tauri の外（ブラウザでの開発・テスト）や、知らない値が返ったときは "other"
 * （Windows と同じ形のタイトル帯と全画面になる）
 */
export async function getPlatform(call: (cmd: string) => Promise<unknown> = invoke): Promise<Platform> {
  try {
    const value = await call("get_platform");
    return isPlatform(value) ? value : "other";
  } catch {
    return "other";
  }
}
