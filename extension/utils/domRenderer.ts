import type { AnalysisResult } from "./types";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function injectWarningBanner(
  targetElement: HTMLElement,
  result: AnalysisResult,
  _highlightColor?: string
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
  host.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    z-index: 100;
    pointer-events: auto;
  `;

  const shadow = host.attachShadow({ mode: "open" });

  const isAgitation = result.category.includes("선동");
  const isStatDistortion = result.category.includes("통계");

  let categoryIcon = "🚨";
  if (isAgitation) {
    categoryIcon = "📢";
  } else if (isStatDistortion) {
    categoryIcon = "📊";
  }

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      .overlay {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        width: 100%; height: 100%;
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
      .warning-icon {
        font-size: 40px;
        line-height: 1;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
      }
      .warning-title {
        font-size: 16px;
        font-weight: 700;
        color: #fff;
        text-align: center;
        text-shadow: 0 1px 3px rgba(0,0,0,0.5);
        line-height: 1.4;
        max-width: 300px;
      }
      .warning-category {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: rgba(0,0,0,0.3);
        color: #fecaca;
        border: 1px solid rgba(255,255,255,0.3);
        font-size: 12px;
        font-weight: 700;
        padding: 3px 10px;
        border-radius: 20px;
        letter-spacing: -0.01em;
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
      .summary-preview {
        font-size: 12px;
        color: rgba(255,255,255,0.85);
        text-align: center;
        max-width: 280px;
        line-height: 1.4;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
      }
    </style>
    <div class="overlay">
      <div class="warning-icon">${categoryIcon}</div>
      <div class="warning-title">⚠️ 경고: ${escapeHtml(result.category)}</div>
      <div class="warning-category">${categoryIcon} Detectium AI 판별 · 위험도 ${result.riskScore}%</div>
      <div class="summary-preview">${escapeHtml(result.summary)}</div>
      <button class="show-anyway-btn">그래도 보기</button>
    </div>
  `;

  const btn = shadow.querySelector(".show-anyway-btn");
  btn?.addEventListener("click", () => {
    host.remove();
  });

  targetElement.appendChild(host);
}
