import { describe, expect, it } from "vitest";
import { PauseTracker } from "./pause_tracker";

describe("PauseTracker", () => {
  it("最小化か非表示のどちらかで止め、両方が解けたら再開する。変わったときだけ知らせる", () => {
    const seen: boolean[] = [];
    const t = new PauseTracker((paused) => seen.push(paused));
    t.setHidden(false); // 最初の1回は今の状態を知らせる
    t.setMinimized(false);
    t.setMinimized(true);
    t.setHidden(true);
    t.setMinimized(false);
    t.setHidden(false);
    expect(seen).toEqual([false, true, false]);
    expect(t.paused).toBe(false);
  });
});
