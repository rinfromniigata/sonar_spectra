// 履歴：決まった幅の行（1フレーム分の値の並び）を、決まった数だけ積むリングバッファ。
// 波形の履歴（1行＝履歴用の要約）と、スペクトログラムの履歴（1行＝帯域ごとの強さ）に使う。
// モジュールのインスタンス間で共有し、描画側は読むだけにする。

export class RowHistory {
  readonly width: number;
  readonly capacity: number;
  private readonly data: Float32Array;
  /** いちばん古い行の位置 */
  private start = 0;
  private count = 0;
  /** 積んだ行の累計（描画側が「前回から何行増えたか」を知るのに使う） */
  private pushedTotal = 0;

  constructor(width: number, capacity: number) {
    if (!(width > 0 && capacity > 0)) throw new RangeError("width and capacity must be positive");
    this.width = width;
    this.capacity = capacity;
    this.data = new Float32Array(width * capacity);
  }

  /** たまっている行の数 */
  get length(): number {
    return this.count;
  }

  /** 積んだ行の累計（`clear` でも戻さない） */
  get total(): number {
    return this.pushedTotal;
  }

  /** 行を積む。`row` の先頭 `width` 個を写し、足りない分は0にする。満杯なら最も古い行を捨てる */
  push(row: ArrayLike<number>): void {
    const index = (this.start + this.count) % this.capacity;
    const target = this.data.subarray(index * this.width, (index + 1) * this.width);
    const n = Math.min(this.width, row.length);
    for (let i = 0; i < n; i++) target[i] = row[i];
    target.fill(0, n);
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
    this.pushedTotal++;
  }

  /**
   * `i` 番目の行（0 が最も古い）。次の `push` で上書きされうるビューなので、取っておかずにその場で読む
   */
  row(i: number): Float32Array {
    if (!(i >= 0 && i < this.count)) throw new RangeError(`row ${i} is out of range`);
    const index = (this.start + i) % this.capacity;
    return this.data.subarray(index * this.width, (index + 1) * this.width);
  }

  /** 最も新しい行。空なら null */
  latest(): Float32Array | null {
    return this.count === 0 ? null : this.row(this.count - 1);
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }
}
