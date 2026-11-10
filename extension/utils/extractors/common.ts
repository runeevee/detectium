export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 요소가 화면(뷰포트)에 일정 부분 노출되어 있는지 확인
 */
export function isElementInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  // 세로축으로 최소 40px 이상 보이고 가로축도 화면 안에 걸쳐있는지 확인
  const isVisibleY = rect.bottom > 40 && rect.top < windowHeight - 40;
  const isVisibleX = rect.right > 0 && rect.left < windowWidth;

  return isVisibleY && isVisibleX && rect.height > 20 && rect.width > 50;
}

/**
 * 단순 고유 ID 해시 생성
 */
export function generateSimpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * "더 보기" 류의 펼치기 버튼인지 판별
 */
export function isClickableMoreButton(element: HTMLElement): boolean {
  if (
    !element.isConnected ||
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }
  if (element instanceof HTMLButtonElement && element.disabled) {
    return false;
  }

  const isMoreLabel = (label: string): boolean =>
    /^(?:\.{2,}\s*)?(?:더\s*보기|자세히\s*보기|more|show\s*more|read\s*more)$/i.test(
      label.replace(/…/g, "...").trim()
    );
  const labels = [
    element.innerText || "",
    element.textContent || "",
    element.getAttribute("aria-label") || "",
  ];
  if (!labels.some(isMoreLabel)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    (element.matches("button, [role=\"button\"], a, tp-yt-paper-button, #expand, #more") ||
      style.cursor === "pointer") &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.pointerEvents !== "none" &&
    Number.parseFloat(style.opacity || "1") > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}
