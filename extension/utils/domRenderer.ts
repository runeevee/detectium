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

  // 조건에 걸린 게시글에는 붉은 테두리 항상 표시
  targetElement.style.setProperty("outline", "3px solid #b91c1c", "important");

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
        max-height: 60%;
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
  btn?.addEventListener("click", () => { host.remove(); });

  targetElement.appendChild(host);
}
