// イベント `source-status` を受け取り、最新の状態を保持する。
// `start_stream` を呼ぶ前に listen を始めておくこと（起動直後の Opening を取りこぼさないため。
// 先に `ready` を待ってから呼ぶ）。start_stream を呼び直すと、Rust が最後の状態を送り直す。

import { listen } from "@tauri-apps/api/event";
import { onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { SOURCE_STATUS_EVENT, type SourceStatusEvent } from "./source_status";

export interface SourceStatusHandle {
  /** 最後に届いた状態。まだ届いていなければ null */
  event: ShallowRef<SourceStatusEvent | null>;
  /** listen の準備ができたら解決する。`start_stream` はこれを待ってから呼ぶ */
  ready: Promise<void>;
  /** listen の失敗（Tauri の外で開いたときなど）。なければ null */
  error: Ref<string | null>;
}

export function useSourceStatus(): SourceStatusHandle {
  const event = shallowRef<SourceStatusEvent | null>(null);
  const error = ref<string | null>(null);
  let unlisten: (() => void) | null = null;
  let disposed = false;

  const ready = listen<SourceStatusEvent>(SOURCE_STATUS_EVENT, (e) => {
    event.value = e.payload;
  }).then(
    (stop) => {
      if (disposed) stop();
      else unlisten = stop;
    },
    (reason: unknown) => {
      error.value = reason instanceof Error ? reason.message : String(reason);
    },
  );

  onBeforeUnmount(() => {
    disposed = true;
    unlisten?.();
  });

  return { event, ready, error };
}
