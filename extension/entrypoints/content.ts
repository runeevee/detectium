export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main(ctx) {
    console.log('[Detectium] Content Script Initialized on:', window.location.href);

    let isExtensionActive = true;
    let highlightColor = '#4f46e5';

    // 스토리지 설정값 동기화
    const syncSettings = () => {
      chrome.storage.sync.get(['isEnabled', 'highlightColor'], (result) => {
        if (typeof result.isEnabled === 'boolean') {
          isExtensionActive = result.isEnabled;
        }
        if (typeof result.highlightColor === 'string') {
          highlightColor = result.highlightColor;
        }
      });
    };

    syncSettings();

    // 스토리지 변경 실시간 감지
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        if (changes.isEnabled && typeof changes.isEnabled.newValue === 'boolean') {
          isExtensionActive = changes.isEnabled.newValue;
        }
        if (changes.highlightColor && typeof changes.highlightColor.newValue === 'string') {
          highlightColor = changes.highlightColor.newValue;
        }
      }
    });

    // Shadow DOM 기반으로 웹페이지 스타일과 완전히 격리된 토스트 알림 표시 함수
    const showNotification = (title: string, message: string) => {
      const containerId = 'detectium-toast-container';
      let hostElement = document.getElementById(containerId);

      if (!hostElement) {
        hostElement = document.createElement('div');
        hostElement.id = containerId;
        hostElement.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
        document.body.appendChild(hostElement);
      }

      const shadow = hostElement.shadowRoot || hostElement.attachShadow({ mode: 'open' });

      const toast = document.createElement('div');
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #0f172a;
        color: #f8fafc;
        border-radius: 10px;
        padding: 14px 18px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        max-width: 340px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        border-left: 4px solid ${highlightColor};
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
      `;

      toast.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <strong style="font-size: 14px; font-weight: 600; color: #fff;">🔍 ${title}</strong>
          <span style="cursor: pointer; opacity: 0.7; font-size: 16px;" id="close-btn">&times;</span>
        </div>
        <p style="margin: 0; line-height: 1.4; color: #cbd5e1; word-break: break-word;">${message}</p>
      `;

      shadow.appendChild(toast);

      // 나타나는 애니메이션
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });

      const closeToast = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 250);
      };

      toast.querySelector('#close-btn')?.addEventListener('click', closeToast);

      // 4.5초 후 자동 종료
      setTimeout(closeToast, 4500);
    };

    // Background Service Worker 및 Popup으로부터 메시지 수신
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'PING') {
        sendResponse({ status: 'PONG', url: window.location.href });
        return;
      }

      // 우클릭 컨텍스트 메뉴 "Detectium으로 선택한 텍스트 분석" 수신
      if (message.type === 'ANALYZE_TEXT_REQUEST') {
        if (!isExtensionActive) {
          showNotification('Detectium 알림', '현재 확장이 비활성화되어 있습니다. 팝업에서 활성화해 주세요.');
          return;
        }

        const selectedText = message.text || '';
        showNotification(
          '분석 요청 접수',
          `선택한 텍스트 (${selectedText.length}자):\n"${selectedText.slice(0, 70)}${selectedText.length > 70 ? '...' : ''}"`
        );
        sendResponse({ success: true });
      }
    });
  },
});
