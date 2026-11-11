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
  status: "loading" | "passed" | "failed" | null
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
  const label = status === "loading" ? "검사 중" : status === "passed" ? "검사 통과" : "검사 실패";
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
  _highlightColor?: string,
  onDismiss?: () => void
) {
  // 이미 경고창이 삽입되어 있는지 확인
  if (targetElement.querySelector(".detectium-overlay-host")) {
    return;
  }

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
    z-index: 100;
    border-radius: ${targetStyle.borderRadius};
    pointer-events: auto;
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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
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
        gap: 12px;
        padding: 20px;
        box-sizing: border-box;
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
      }
      .show-anyway-btn {
        margin-top: 4px;
        background: rgba(255,255,255,0.15);
        color: #fff;
        border: 1.5px solid rgba(255,255,255,0.5);
        font-size: 13px;
        font-weight: 600;
        padding: 8px 20px;
        border-radius: 20px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        font-family: inherit;
      }
      .show-anyway-btn:hover {
        background: rgba(255,255,255,0.28);
        border-color: rgba(255,255,255,0.8);
      }
      .details-preview {
        font-size: 1rem;
        color: rgba(255,255,255,0.85);
        text-align: center;
        max-width: 280px;
        margin: 1rem;
        overflow-y: auto;
        line-height: 1.4;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    </style>
    <div class="overlay">
      <div class="details-preview">${escapeHtml(result.details)}</div>
      <button class="show-anyway-btn">해당 사실을 인지하고 있으며, 계속 보겠습니다.</button>
    </div>
  `;

  const btn = shadow.querySelector(".show-anyway-btn");
  btn?.addEventListener("click", () => {
    host.remove();
    onDismiss?.();
  });

  targetElement.appendChild(host);
}
