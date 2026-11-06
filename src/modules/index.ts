// モジュールの入口。モジュールを作ったら、ここで moduleRegistry に登録する。

import { levelModule } from "./level";
import { moduleRegistry } from "./registry";

moduleRegistry.register(levelModule);

export { MODULE_KINDS, type Direction, type ModuleKind, type ModuleOptions, type Shape } from "./options";
export type {
  AnyModuleDefinition,
  DefaultInstanceSpec,
  FrameDrawInput,
  Geometry,
  InspectorField,
  ModuleDefinition,
  ModuleRenderer,
  PaletteColors,
  RenderContext,
} from "./types";
export { ModuleRegistry, moduleRegistry } from "./registry";
export { applyTransform, directionTransform, logicalSize, quarterTurns, type Transform } from "./direction";
