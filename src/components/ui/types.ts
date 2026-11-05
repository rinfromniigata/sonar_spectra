// 部品の選択肢の型。label は辞書から引いた文言
export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
}

/** 入力源の状態（タイトル帯のチップの見た目） */
export type ChipStatus = "live" | "silent" | "unavailable";
