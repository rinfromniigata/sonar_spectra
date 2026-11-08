// ウィンドウの扱い（window_controller.ts）をアプリに provide し、画面から引く。

import { inject, type InjectionKey } from "vue";
import type { WindowController } from "./window_controller";

export const WINDOW_CONTROLLER_KEY: InjectionKey<WindowController> = Symbol("window-controller");

/** アプリに provide されたウィンドウの扱い */
export function useWindowController(): WindowController {
  const controller = inject(WINDOW_CONTROLLER_KEY, null);
  if (!controller) throw new Error("window controller is not provided");
  return controller;
}
