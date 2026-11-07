export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main(ctx) {
    console.log('[Detectium] Content Script Initialized on:', window.location.href);

    // Chrome storage에서 설정값 불러오기 예제
    chrome.storage.sync.get(['isEnabled', 'highlightColor'], (result) => {
      const isEnabled = result.isEnabled ?? true;
      if (!isEnabled) {
        return;
      }
      console.log('[Detectium] Extension is active. Config:', result);
    });

    // 백그라운드 또는 옵션 페이지로부터의 메시지 수신 대기
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'PING') {
        sendResponse({ status: 'PONG', url: window.location.href });
      }
      return true;
    });
  },
});
