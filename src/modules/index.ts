// モジュールの入口。モジュールを作ったら、ここで moduleRegistry に登録する。

import { gramModule } from "./gram";
import { levelModule } from "./level";
import { loudModule } from "./loud";
import { moduleRegistry } from "./registry";
import { specModule } from "./spec";
import { stereoModule } from "./stereo";
import { waveModule } from "./wave";

moduleRegistry.register(levelModule);
moduleRegistry.register(waveModule);
moduleRegistry.register(specModule);
moduleRegistry.register(stereoModule);
moduleRegistry.register(gramModule);
moduleRegistry.register(loudModule);

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
