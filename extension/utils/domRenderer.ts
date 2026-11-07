import type { AnalysisResult } from './types';

export function injectWarningBanner(
  targetElement: HTMLElement,
  result: AnalysisResult,
  themeColor: string = '#4f46e5'
) {
  // 이미 경고창이 삽입되어 있는지 확인
  const existingContainer = targetElement.querySelector('.detectium-warning-host');
  if (existingContainer) {
    return;
  }

  // 래퍼 컨테이너 생성
  const host = document.createElement('div');
  host.className = 'detectium-warning-host';
  host.style.cssText = `
    display: block;
    width: 100%;
    margin-top: 10px;
    margin-bottom: 8px;
    clear: both;
    position: relative;
    z-index: 20;
  `;

  // Shadow DOM 부착으로 외부 사이트(X, 인스타그램)의 CSS 충돌 완벽 방지
  const shadow = host.attachShadow({ mode: 'open' });

  // 카테고리별 테마 색상 설정
  const isStatDistortion = result.category.includes('통계');
  const alertColor = isStatDistortion ? '#f59e0b' : '#ef4444'; // 통계 왜곡은 Amber, 가짜뉴스는 Red
  const alertBg = isStatDistortion ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.08)';
  const alertBorder = isStatDistortion ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.35)';

  const checkedTagsHtml = (result.checkedPoints || [])
    .map(
      (tag) => `
      <span style="
        display: inline-block;
        background: rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 500;
        margin-right: 4px;
        margin-bottom: 4px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      "># ${tag}</span>
    `
    )
    .join('');

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      .warning-card {
        background: #0f172a;
        background: linear-gradient(145deg, #131b2e, #0b1120);
        border: 1.5px solid ${alertBorder};
        border-left: 5px solid ${alertColor};
        border-radius: 12px;
        padding: 14px 16px;
        color: #f1f5f9;
        box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.4), 0 2px 6px -1px rgba(0, 0, 0, 0.3);
        animation: slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        box-sizing: border-box;
      }
      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateY(-8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .badge-group {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .category-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: ${alertBg};
        color: ${alertColor};
        border: 1px solid ${alertBorder};
        font-size: 12px;
        font-weight: 700;
        padding: 3px 9px;
        border-radius: 6px;
        letter-spacing: -0.01em;
      }
      .risk-score {
        background: rgba(239, 68, 68, 0.15);
        color: #fca5a5;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 6px;
      }
      .close-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 2px 6px;
        font-size: 18px;
        line-height: 1;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
      }
      .close-btn:hover {
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.1);
      }
      .summary-text {
        font-size: 13.5px;
        font-weight: 600;
        line-height: 1.45;
        color: #f8fafc;
        margin: 0 0 6px 0;
        word-break: break-word;
      }
      .details-text {
        font-size: 12.5px;
        line-height: 1.5;
        color: #cbd5e1;
        margin: 0 0 10px 0;
        word-break: break-word;
      }
      .tags-container {
        display: flex;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      .footer-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 8px;
        margin-top: 4px;
        font-size: 11px;
        color: #64748b;
      }
      .brand-sign {
        display: flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
        color: #94a3b8;
      }
    </style>
    <div class="warning-card">
      <div class="card-header">
        <div class="badge-group">
          <span class="category-pill">
            <span>${isStatDistortion ? '📊' : '🚨'}</span>
            <span>Detectium 경고: ${result.category}</span>
          </span>
          <span class="risk-score">위험 지수 ${result.riskScore}%</span>
        </div>
        <button class="close-btn" title="경고 닫기" aria-label="경고 닫기">&times;</button>
      </div>

      <p class="summary-text">${result.summary}</p>
      <p class="details-text">${result.details}</p>

      ${checkedTagsHtml ? `<div class="tags-container">${checkedTagsHtml}</div>` : ''}

      <div class="footer-bar">
        <span class="brand-sign">🔍 Detectium AI Fact-Check</span>
        <span>OpenAI 기반 통계 왜곡 및 허위정보 자동 분석</span>
      </div>
    </div>
  `;

  // 닫기 버튼 이벤트
  const closeBtn = shadow.querySelector('.close-btn');
  closeBtn?.addEventListener('click', () => {
    host.style.transition = 'all 0.2s ease-out';
    host.style.opacity = '0';
    host.style.transform = 'scaleY(0)';
    setTimeout(() => host.remove(), 200);
  });

  // 게시글 요소의 최하단에 자연스럽게 삽입
  targetElement.appendChild(host);
}
