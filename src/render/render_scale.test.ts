import { describe, expect, it } from "vitest";
import { createSSRApp, defineComponent, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { canvasPixels } from "./gl/transform";
import { provideRenderScale, renderScaleFor, scalePixels, useRenderScale, type RenderScale } from "./render_scale";

describe("描画の倍率（描画の解像度）", () => {
  it("画面どおりは devicePixelRatio、等倍は min(devicePixelRatio, 1)", () => {
    expect(renderScaleFor("display", 2)).toBe(2);
    expect(renderScaleFor("display", 1.25)).toBe(1.25);
    expect(renderScaleFor("one", 2)).toBe(1);
    expect(renderScaleFor("one", 1.5)).toBe(1);
    // 倍率が1以下の画面では、どちらも同じ
    expect(renderScaleFor("one", 1)).toBe(1);
    expect(renderScaleFor("display", 0.75)).toBe(0.75);
    expect(renderScaleFor("one", 0.75)).toBe(0.75);
    // 読めない値は 1
    expect(renderScaleFor("display", 0)).toBe(1);
    expect(renderScaleFor("one", Number.NaN)).toBe(1);
  });

  it("画面どおりの画素数は変えない。等倍は倍率の比を掛けて丸める", () => {
    // Acer ET430K（WQHD にスケーリング）の全画面：UI 2560×1396・dpr 2
    expect(scalePixels(5120, 2, 2)).toBe(5120);
    expect(scalePixels(5120, 2, 1)).toBe(2560);
    expect(scalePixels(2792, 2, 1)).toBe(1396);
    // 端数のある拡大率（Windows の125%）でも、画面どおりは測った値のまま
    expect(scalePixels(1601, 1.25, 1.25)).toBe(1601);
    expect(scalePixels(1601, 1.25, 1)).toBe(1281);
    expect(scalePixels(1, 2, 1)).toBe(1);
  });

  it("共有キャンバスの画素数と、枠ごとの層の画素数が、同じ倍率でそろう", () => {
    const css = 2560;
    const dpr = 2;
    const device = canvasPixels(css, dpr);
    for (const resolution of ["display", "one"] as const) {
      const scale = renderScaleFor(resolution, dpr);
      expect(scalePixels(device, dpr, scale)).toBe(canvasPixels(css, scale));
    }
  });

  it("provide した設定を子が読み、設定が変わればすぐ倍率が変わる。provide がなければ画面どおり", async () => {
    const resolution = ref<"display" | "one">("display");
    let child: RenderScale | null = null;
    let orphan: RenderScale | null = null;
    const Child = defineComponent({
      setup() {
        child = useRenderScale();
        return () => null;
      },
    });
    const Parent = defineComponent({
      setup() {
        provideRenderScale(() => resolution.value);
        return () => h(Child);
      },
    });
    const Orphan = defineComponent({
      setup() {
        orphan = useRenderScale();
        return () => null;
      },
    });
    await renderToString(createSSRApp(Parent));
    await renderToString(createSSRApp(Orphan));
    // テストの環境（node）には window がないので、devicePixelRatio は 1 として読む
    expect(child!.resolution.value).toBe("display");
    expect(child!.current()).toBe(1);
    expect(orphan!.resolution.value).toBe("display");
    resolution.value = "one";
    expect(child!.resolution.value).toBe("one");
    expect(orphan!.resolution.value).toBe("display");
  });
});
