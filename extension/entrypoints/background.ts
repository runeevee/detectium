import { analyzePostsWithOpenAI } from "../utils/openaiService";
import type { AnalyzePostsRequest, AnalyzePostsResponse } from "../utils/types";

export default defineBackground(() => {
  console.log("[Detectium] Background Service Worker Started");

  // 확장 프로그램 설치/업데이트 시 초기 설정 및 컨텍스트 메뉴 등록
  chrome.runtime.onInstalled.addListener(() => {
    console.log("[Detectium] Extension installed/updated");

    // 기본 설정 초기화
    chrome.storage.sync.get(['isEnabled', 'detectionThreshold'], (result) => {
      const updates: Record<string, unknown> = {};
      if (result.isEnabled === undefined) {
        updates.isEnabled = true;
      }
      if (result.detectionThreshold === undefined) {
        updates.detectionThreshold = 70;
      }
      if (Object.keys(updates).length > 0) {
        chrome.storage.sync.set(updates);
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

    // 게시글 일괄 AI 분석 요청
    if (message.type === 'ANALYZE_POSTS_REQUEST') {
      const req = message as AnalyzePostsRequest;

      chrome.storage.sync.get(['isEnabled', 'apiKey', 'detectionThreshold'], async (storage) => {
        const isEnabled = storage.isEnabled !== false;
        if (!isEnabled) {
          sendResponse({
            success: false,
            error: 'Detectium 확장이 비활성화되어 있습니다.',
          } as AnalyzePostsResponse);
          return;
        }

        const apiKey = typeof storage.apiKey === 'string' ? storage.apiKey : undefined;
        const threshold = typeof storage.detectionThreshold === 'number' ? storage.detectionThreshold : 70;

        try {
          const totalImages = req.posts?.reduce((acc, p) => acc + (p.imageUrls?.length || 0), 0) || 0;
          console.log(`[Detectium] Background received ${req.posts?.length || 0} posts to analyze (총 이미지 ${totalImages}장)`);
          const results = await analyzePostsWithOpenAI(req.posts, apiKey, threshold);
          console.log(`[Detectium] OpenAI analysis complete:`, results);
          sendResponse({
            success: true,
            results,
          } as AnalyzePostsResponse);
        } catch (error: any) {
          console.error('[Detectium] Analysis error in background:', error);
          sendResponse({
            success: false,
            error: error?.message || '분석 중 알 수 없는 오류가 발생했습니다.',
          } as AnalyzePostsResponse);
        }
      });

      return true; // 비동기 sendResponse 대기
    }
  });
});
