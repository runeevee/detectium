import type { AnalysisResult } from "./types";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function updateAnalysisStatus(
  targetElement: HTMLElement,
  status: "loading" | "passed" | "failed" | "flagged" | null
) {
  const existingHost = Array.from(targetElement.children).find((child) =>
    child.classList.contains("detectium-status-host")
  );
  if (status === null) {
    existingHost?.remove();
    return;
  }

  if (existingHost?.getAttribute("data-status") === status) {
    return;
  }
  existingHost?.remove();

  if (window.getComputedStyle(targetElement).position === "static") {
    targetElement.style.position = "relative";
  }

  const host = document.createElement("div");
  host.className = "detectium-status-host";
  host.setAttribute("data-status", status);
  const label =
    status === "loading"
      ? "검사 중"
      : status === "passed"
        ? "검사 통과"
        : status === "flagged"
          ? "필터링 대상"
          : "검사 실패";
  host.setAttribute("aria-label", label);
  host.setAttribute("role", "img");
  const targetStyle = window.getComputedStyle(targetElement);
  const borderRadius = targetStyle.borderRadius;
  const borderWidths = [
    targetStyle.borderTopWidth,
    targetStyle.borderRightWidth,
    targetStyle.borderBottomWidth,
    targetStyle.borderLeftWidth,
  ]
    .map((width) => (Number.parseFloat(width) > 0 ? width : "2px"))
    .join(" ");
  host.style.cssText = `
    position: absolute;
    inset: -${targetStyle.borderTopWidth} -${targetStyle.borderRightWidth} -${targetStyle.borderBottomWidth} -${targetStyle.borderLeftWidth};
    z-index: 1;
    border-radius: ${borderRadius};
    border-width: ${borderWidths};
    pointer-events: none;
  `;
  if (window.location.hostname.includes("instagram.com")) {
    host.style.transform = "translateY(-15px)";
  }

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
        box-sizing: border-box;
        border-radius: inherit;
        border: 1px solid transparent;
        transition: border-color 600ms ease-in-out;
      }
      :host([data-status="loading"]) {
        animation: detectium-loading-pulse 1.2s ease-in-out infinite alternate;
      }
      :host([data-status="passed"]) {
        border-color: #18ff6d;
      }
      :host([data-status="failed"]) {
        border-color: #18ff6d;
      }
      :host([data-status="flagged"]) {
        border-color: #ff1859;
      }
      @keyframes detectium-loading-pulse {
        from { border-color: #fff; }
        to { border-color: #5f9aff; }
      }
    </style>
  `;

  targetElement.appendChild(host);
}

export function injectWarningBanner(
  targetElement: HTMLElement,
  result: AnalysisResult,
  onDismiss?: () => void,
  onReview?: () => void
) {
  // 이미 경고창이 삽입되어 있는지 확인
  if (targetElement.querySelector(".detectium-overlay-host")) {
    return;
  }
  targetElement.querySelector(".detectium-warning-review-host")?.remove();

  // 게시글 컨테이너가 position: static이면 relative로 변경
  const currentPosition = window.getComputedStyle(targetElement).position;
  if (currentPosition === "static") {
    targetElement.style.position = "relative";
  }

  const host = document.createElement("div");
  host.className = "detectium-overlay-host";
  const targetStyle = window.getComputedStyle(targetElement);
  host.style.cssText = `
    position: absolute;
    inset: -${targetStyle.borderTopWidth} -${targetStyle.borderRightWidth} -${targetStyle.borderBottomWidth} -${targetStyle.borderLeftWidth};
    z-index: 1;
    border-radius: ${targetStyle.borderRadius};
    pointer-events: auto;
  `;
  if (window.location.hostname.includes("instagram.com")) {
    host.style.transform = "translateY(-15px)";
  }

  const shadow = host.attachShadow({ mode: "open" });
  const description = result.description.replace(/\s+/g, " ").trim();

  // result.links를 최우선으로 하고, description이나 analysisContent에 포함된 URL도 폴백 추출
  const rawLinks = [
    ...(Array.isArray(result.links) ? result.links : []),
    ...(result.description ? result.description.match(/https?:\/\/[^\s)\],]+/g) || [] : []),
    ...(result.analysisContent?.violatedPoints
      ? result.analysisContent.violatedPoints.flatMap((p) => p.match(/https?:\/\/[^\s)\],]+/g) || [])
      : []),
  ];
  const links = Array.from(
    new Set(
      rawLinks
        .map((l) => (typeof l === "string" ? l.replace(/[.,;)]+$/, "").trim() : ""))
        .filter((l) => l.startsWith("http://") || l.startsWith("https://"))
    )
  );

  const linksHtml =
    links.length > 0
      ? `
      <div class="source-section">
        <button
          type="button"
          class="source-toggle-btn"
          aria-expanded="false"
          aria-label="출처 확인하기, 펼치기"
        >
          <span class="source-toggle-icon" aria-hidden="true">▶</span>
          <span>출처 확인하기</span>
        </button>
        <div class="analysis-links-box" hidden>
          <div class="analysis-links-list">
            ${links
              .map((link) => {
                let title = "";
                try {
                  title = new URL(link).hostname;
                } catch {
                  // Do not expose malformed source URLs as display text.
                }
                return `<div class="source-link-row"><a class="source-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer"><span class="source-link-domain">${escapeHtml(title)}</span></a></div>`;
              })
              .join("")}
          </div>
        </div>
      </div>
    `
      : "";

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
        container-type: size;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      * {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      *::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
      }
      .overlay {
        position: absolute;
        inset: 1px;
        border-radius: ${targetStyle.borderRadius};
        background: rgba(185, 28, 28, 0.85);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: clamp(4px, 2cqh, 12px);
        padding: clamp(4px, 3cqh, 20px);
        box-sizing: border-box;
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
      }
      .analysis-preview {
        font-size: clamp(0.65rem, 3cqh, 0.95rem);
        color: rgba(255,255,255,0.9);
        text-align: left;
        max-width: min(380px, 100%);
        max-height: clamp(120px, 55cqh, 260px);
        overflow-y: auto;
        margin: clamp(2px, 2cqh, 0.75rem);
        line-height: 1.45;
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        white-space: normal;
        overflow-wrap: anywhere;
        box-sizing: border-box;
      }
      .description-text {
        margin-bottom: 4px;
      }
      .analysis-links-box {
        margin-top: 8px;
        padding: 0;
        background: transparent;
        border: 0;
        box-shadow: none;
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
      }
      .analysis-links-box[hidden] {
        display: none;
      }
      .analysis-links-title {
        font-size: clamp(0.62rem, 1.8cqh, 0.78rem);
        font-weight: 700;
        color: #fef08a;
        margin-bottom: 4px;
        display: block;
        letter-spacing: -0.01em;
      }
      .source-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex-shrink: 0;
        width: min(100%, 380px);
      }
      .analysis-links-list {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        justify-content: center;
        justify-items: center;
        gap: 8px;
        width: 100%;
        max-width: 380px;
        margin-inline: auto;
        max-height: clamp(40px, 15cqh, 85px);
        overflow-y: auto;
      }
      .source-link-row {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        min-width: 0;
        text-align: center;
      }
      .source-link {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        font-size: 20px;
        color: #fef08a;
        text-decoration: underline;
        text-underline-offset: 2px;
        overflow-wrap: anywhere;
        cursor: pointer;
        transition: color 0.15s ease;
      }
      .source-link:hover {
        color: #fef08a;
      }
      .source-link-icon {
        flex-shrink: 0;
        font-weight: bold;
      }
      .source-link-domain {
        text-align: center;
        overflow-wrap: anywhere;
      }
      .source-toggle-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 32px;
        padding: 0 6px;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        color: #fff;
        font: inherit;
        font-size: clamp(0.7rem, 2cqh, 0.85rem);
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
      }
      .source-toggle-icon {
        line-height: 1;
      }
      .source-toggle-btn:hover,
      .source-toggle-btn:active,
      .source-toggle-btn:focus {
        background: transparent;
        border: 0;
        box-shadow: none;
      }
      .source-toggle-btn:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }
      .show-anyway-btn {
        margin-top: 0;
        background: rgba(255,255,255,0.15);
        color: #fff;
        border: 1.5px solid rgba(255,255,255,0.5);
        font-size: clamp(0.6rem, 2.5cqh, 13px);
        font-weight: 600;
        padding: clamp(4px, 1.5cqh, 8px) clamp(8px, 3cqi, 20px);
        border-radius: 20px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        font-family: inherit;
        flex-shrink: 0;
      }
      .show-anyway-btn:hover {
        background: rgba(255,255,255,0.28);
        border-color: rgba(255,255,255,0.8);
      }
    </style>
    <div class="overlay">
      <div class="analysis-preview">
        <div class="description-text">${escapeHtml(description)}</div>
      </div>
      <button type="button" class="show-anyway-btn">해당 사실을 인지하고 있으며, 계속 보겠습니다.</button>
      ${linksHtml}
    </div>
  `;

  const sourceToggleButton = shadow.querySelector<HTMLButtonElement>(".source-toggle-btn");
  const sourceToggleIcon = shadow.querySelector<HTMLElement>(".source-toggle-icon");
  const sourceLinks = shadow.querySelector<HTMLElement>(".analysis-links-box");
  if (sourceToggleButton && sourceToggleIcon && sourceLinks) {
    sourceToggleButton.addEventListener("click", () => {
      const isVisible = sourceLinks.hidden;
      sourceLinks.hidden = !isVisible;
      sourceToggleIcon.textContent = isVisible ? "▼" : "▶";
      sourceToggleButton.setAttribute("aria-expanded", String(isVisible));
      sourceToggleButton.setAttribute(
        "aria-label",
        isVisible ? "출처 확인하기, 접기" : "출처 확인하기, 펼치기"
      );
    });
  }

  // 오버레이 내 링크 클릭 시 새 탭으로 브라우저 이동 처리
  shadow.querySelectorAll<HTMLAnchorElement>("a.source-link").forEach((anchor) => {
    anchor.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const href = anchor.getAttribute("href") || anchor.href;
      if (href) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    });
  });

  host.addEventListener("click", (event) => {
    const isAnchor = event.composedPath().some((el) => (el as HTMLElement)?.tagName === "A");
    if (isAnchor) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  shadow.querySelector(".show-anyway-btn")?.addEventListener("click", () => {
    host.remove();
    injectWarningReviewButton(targetElement, result, onDismiss, onReview);
    onDismiss?.();
  });

  targetElement.appendChild(host);
}

export function injectWarningReviewButton(
  targetElement: HTMLElement,
  result: AnalysisResult,
  onDismiss?: () => void,
  onReview?: () => void
) {
  if (targetElement.querySelector(".detectium-warning-review-host")) {
    return;
  }
  targetElement.querySelector(".detectium-overlay-host")?.remove();

  // 게시글 컨테이너가 position: static이면 relative로 변경
  const currentPosition = window.getComputedStyle(targetElement).position;
  if (currentPosition === "static") {
    targetElement.style.position = "relative";
  }

  const host = document.createElement("div");
  host.className = "detectium-warning-review-host";
  host.style.cssText = `
    position: absolute;
    bottom: 8px;
    right: 8px;
    z-index: 2;
    pointer-events: auto;
    transform: translateY(-1.5rem);
  `;

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      }
      .warning-review-button {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border: 1.5px solid #b91c1c;
        border-radius: 50%;
        padding: 0;
        background: #ffffff;
        color: #b91c1c;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
        transition: transform 0.15s ease, background-color 0.15s ease, color 0.15s ease;
      }
      .warning-review-button:hover {
        background-color: #b91c1c;
        color: #ffffff;
        transform: scale(1.08);
      }
      .warning-review-button:active {
        transform: scale(0.96);
      }
      .info-icon {
        display: block;
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }
    </style>
    <button class="warning-review-button" type="button" aria-label="경고 다시 보기" title="경고 다시 보기">
      <svg class="info-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
      </svg>
    </button>
  `;

  shadow.querySelector(".warning-review-button")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    host.remove();
    injectWarningBanner(targetElement, result, onDismiss, onReview);
    onReview?.();
  });

  targetElement.appendChild(host);
}

export function removeWarningBanner(targetElement: HTMLElement) {
  targetElement.querySelector(".detectium-overlay-host")?.remove();
  targetElement.querySelector(".detectium-warning-review-host")?.remove();
}
