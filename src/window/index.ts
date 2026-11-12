// ウィンドウの扱いの入口。

export { macFullscreen, tauriWindowApi, type MacWindowOps, type WindowApi } from "./window_api";
export {
  LEAVE_FULLSCREEN_SETTLE_MS,
  createWindowController,
  type WindowController,
  type WindowControllerOptions,
} from "./window_controller";
export { WINDOW_CONTROLLER_KEY, useWindowController } from "./use_window_controller";
