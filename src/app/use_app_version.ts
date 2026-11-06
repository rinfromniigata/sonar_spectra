// アプリのバージョン（tauri.conf.json の version）。Tauri の外（ブラウザで開いたとき）では空のまま。

import { getVersion } from "@tauri-apps/api/app";
import { ref, type Ref } from "vue";

export function useAppVersion(): Ref<string> {
  const version = ref("");
  getVersion().then(
    (value) => {
      version.value = value;
    },
    () => {
      // 取れなくても、バージョンの表示が空になるだけ
    },
  );
  return version;
}
