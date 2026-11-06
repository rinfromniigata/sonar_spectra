// 一時停止の判定：ウィンドウが最小化されているか、WebView が隠れているとき止める。
// 2つの知らせは別々に届くので、組み合わせた結果が変わったときだけ知らせる。

export class PauseTracker {
  private minimized = false;
  private hidden = false;
  private last: boolean | null = null;

  constructor(private readonly onChange: (paused: boolean) => void) {}

  setMinimized(minimized: boolean): void {
    this.minimized = minimized;
    this.emit();
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.emit();
  }

  get paused(): boolean {
    return this.minimized || this.hidden;
  }

  private emit(): void {
    const paused = this.paused;
    if (paused === this.last) return;
    this.last = paused;
    this.onChange(paused);
  }
}
