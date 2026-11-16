// AppIcon.icon から作った Assets.car が、今の AppIcon.icon と食い違っていないかを確かめるための、
// AppIcon.icon の中身の指紋（SHA-256）を計算する。
// AppIcon.icon の中身はテキスト（icon.json と SVG）だけなので、チェックアウトの改行の設定（autocrlf）に
// 左右されないよう、CRLF を LF にそろえてから計算する
import { createHash } from "node:crypto";

/** AppIcon.icon の中のファイル（相対パスと中身） */
export interface IconFile {
  path: string;
  bytes: Uint8Array;
}

/** 相対パスの順に、パスと中身を続けて読んだ SHA-256（16進数） */
export function iconFingerprint(files: IconFile[]): string {
  const hash = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    const text = new TextDecoder().decode(file.bytes).replaceAll("\r\n", "\n");
    hash.update(`${file.path.replaceAll("\\", "/")}\n${text.length}\n`);
    hash.update(text);
  }
  return hash.digest("hex");
}
