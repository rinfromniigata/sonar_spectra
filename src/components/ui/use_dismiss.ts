import { nextTick, onBeforeUnmount, onMounted, type Ref } from "vue";

/**
 * 開いた要素（ドロワー・ポップオーバー）の共通の振る舞い。
 * 開いたら中へフォーカスを移し、Esc で閉じ、閉じたら開く前にフォーカスがあった要素へ戻す。
 * 使う側は v-if で出し入れする（マウント＝開く、アンマウント＝閉じる）。
 */
export function useDismiss(root: Ref<HTMLElement | null>, close: () => void): void {
  let returnTo: HTMLElement | null = null;

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }

  onMounted(async () => {
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    root.value?.focus();
    root.value?.addEventListener("keydown", onKeydown);
  });

  onBeforeUnmount(() => {
    root.value?.removeEventListener("keydown", onKeydown);
    if (returnTo?.isConnected) returnTo.focus();
  });
}
