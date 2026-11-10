// 流れる画像（imple 4.2）：輪の形の画像。モジュールは新しい列の中身だけを作って足し、描画の層（render/gl）は
// 足された列だけを GPU の画像に書き、表示するときに読み始めの位置をずらす（すでに描いた分をずらし直さない）。
// 列の中身は上から下への RGBA（0〜255、不透明度で掛けていない値）。

export interface StreamColumn {
  /** 輪の中の列の位置（0〜width-1） */
  x: number;
  /** 上から下への RGBA（height × 4） */
  data: Uint8Array;
}

export class StreamImage {
  /** 列の数（デバイスピクセル） */
  readonly width: number;
  /** 列の高さ（デバイスピクセル） */
  readonly height: number;
  /** 足した列の累計。次に書く位置は written % width */
  private writtenTotal = 0;
  /** まだ描画の層が受け取っていない列 */
  private queue: StreamColumn[] = [];
  /** 描画の層が画像を作り直す（全体を透明にする）必要があるか */
  private resetPending = true;

  constructor(width: number, height: number) {
    if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
      throw new RangeError("width and height must be positive integers");
    }
    this.width = width;
    this.height = height;
  }

  /** 足した列の累計 */
  get written(): number {
    return this.writtenTotal;
  }

  /** いちばん古い列の位置（表示の左端に来る列）。読み始めの位置 */
  get start(): number {
    return this.writtenTotal % this.width;
  }

  /** 列を1つ足す（右端に来る）。data は height × 4 の RGBA で、写して持つ */
  pushColumn(data: ArrayLike<number>): void {
    if (data.length !== this.height * 4) throw new RangeError(`column must have ${this.height * 4} values`);
    const column: StreamColumn = { x: this.writtenTotal % this.width, data: Uint8Array.from(data) };
    this.writtenTotal++;
    this.queue.push(column);
    // 1周より古い列は上書きされるので、送らずに捨てる
    if (this.queue.length > this.width) this.queue.splice(0, this.queue.length - this.width);
  }

  /** 全体を消す（透明にする）。読み始めの位置は今のまま */
  clear(): void {
    this.queue = [];
    this.resetPending = true;
  }

  /**
   * 描画の層が呼ぶ：作り直しが要るか（要るなら false に戻す）と、まだ受け取っていない列を、古い順に取り出す
   */
  takeUpdates(): { reset: boolean; columns: StreamColumn[] } {
    const result = { reset: this.resetPending, columns: this.queue };
    this.resetPending = false;
    this.queue = [];
    return result;
  }

  /** 描画の層が中身を失った（コンテキストの喪失）。次に描くときに作り直す。失った列は描き直さない */
  markLost(): void {
    this.resetPending = true;
  }
}
