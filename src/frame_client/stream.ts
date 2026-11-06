// Rust の start_stream に Channel を渡し、届いたバイト列を FrameClient に流す。
// 呼ぶ前に source-status を listen しておくこと（起動直後の状態を取りこぼさないため）。

import { Channel, invoke } from "@tauri-apps/api/core";
import type { FrameClient } from "./client";

/** 取得と送出を始め、届いたフレームを `client` に渡す。返す Channel は、受信を続ける間持っておく */
export async function startFrameStream(client: FrameClient): Promise<Channel<ArrayBuffer>> {
  // 届く前に受け口を設定しておく（設定前に届いたものは渡し直されない）
  const channel = new Channel<ArrayBuffer>((data) => {
    client.receive(data);
  });
  await invoke("start_stream", { onFrame: channel });
  return channel;
}
