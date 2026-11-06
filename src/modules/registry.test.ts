import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "./registry";
import { testDefinition } from "./test_definitions";

describe("ModuleRegistry", () => {
  it("登録した順ではなく、種類の並び順に返す", () => {
    const registry = new ModuleRegistry();
    registry.register(testDefinition("vu", {}));
    registry.register(testDefinition("level", {}));
    registry.register(testDefinition("gram", { speed: 1 }));
    expect(registry.list().map((d) => d.kind)).toEqual(["level", "gram", "vu"]);
  });

  it("種類で引ける。登録していなければ undefined", () => {
    const registry = new ModuleRegistry();
    registry.register(testDefinition("gram", { speed: 2 }));
    expect(registry.get("gram")?.defaultOptions.speed).toBe(2);
    expect(registry.has("gram")).toBe(true);
    expect(registry.get("level")).toBeUndefined();
    expect(registry.has("level")).toBe(false);
  });

  it("同じ種類の二重登録はエラー", () => {
    const registry = new ModuleRegistry();
    registry.register(testDefinition("level", {}));
    expect(() => registry.register(testDefinition("level", {}))).toThrow(/already registered/);
  });
});
