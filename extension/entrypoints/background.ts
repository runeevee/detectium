export default defineBackground(() => {
  console.log('[Detectium] Background Service Worker Started');

  // 확장 프로그램 설치/업데이트 시 초기 설정 및 컨텍스트 메뉴 등록
  chrome.runtime.onInstalled.addListener(() => {
    console.log('[Detectium] Extension installed/updated');

    // 기본 설정 초기화
    chrome.storage.sync.get(['isEnabled'], (result) => {
      if (result.isEnabled === undefined) {
        chrome.storage.sync.set({ isEnabled: true });
      }
    });

    // 텍스트 선택 시 우클릭 메뉴 추가
    chrome.contextMenus.create({
      id: 'detectium-analyze-selection',
      title: 'Detectium으로 선택한 텍스트 분석',
      contexts: ['selection'],
    });
  });

  // 컨텍스트 메뉴 클릭 이벤트 핸들러
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'detectium-analyze-selection' && tab?.id) {
      const selectedText = info.selectionText || '';
      console.log('[Detectium] Context menu clicked with text:', selectedText);

      // 활성 탭의 Content Script로 분석 요청 전달
      chrome.tabs.sendMessage(tab.id, {
        type: 'ANALYZE_TEXT_REQUEST',
        text: selectedText,
      });
    }
  });

  // 메시지 라우팅 처리
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_EXTENSION_STATUS') {
      chrome.storage.sync.get(['isEnabled'], (result) => {
        sendResponse({ isEnabled: result.isEnabled ?? true });
      });
      return true; // 비동기 응답 대기
    }
  });
});
