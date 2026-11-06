// モジュールのレジストリ。ここに登録するだけで、配置・レイアウト編集・インスタンスの設定に現れる。
// 各モジュールは自分のフォルダで定義し、src/modules/index.ts で moduleRegistry に登録する。

import { MODULE_KINDS, type ModuleKind } from "./options";
import type { AnyModuleDefinition, ModuleDefinition } from "./types";

export class ModuleRegistry {
  private readonly definitions = new Map<ModuleKind, AnyModuleDefinition>();

  /** 登録する。同じ種類を2度登録したらエラー */
  register<K extends ModuleKind>(definition: ModuleDefinition<K>): void {
    if (this.definitions.has(definition.kind)) {
      throw new Error(`module "${definition.kind}" is already registered`);
    }
    this.definitions.set(definition.kind, definition as unknown as AnyModuleDefinition);
  }

  get<K extends ModuleKind>(kind: K): ModuleDefinition<K> | undefined {
    return this.definitions.get(kind) as ModuleDefinition<K> | undefined;
  }

  has(kind: ModuleKind): boolean {
    return this.definitions.has(kind);
  }

  /** 登録済みの定義（種類の並び順。登録した順ではない） */
  list(): AnyModuleDefinition[] {
    return MODULE_KINDS.flatMap((kind) => {
      const definition = this.definitions.get(kind);
      return definition ? [definition] : [];
    });
  }
}

/** アプリのレジストリ */
export const moduleRegistry = new ModuleRegistry();
