import { analyzePostsWithOpenAI } from "../utils/openai-service";
import type { AnalyzePostsRequest, AnalyzePostsResponse } from "../utils/types";

export default defineBackground(() => {
  // 확장 프로그램 설치/업데이트 시 초기 설정 및 컨텍스트 메뉴 등록
  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(["isEnabled", "detectionThreshold"], (result) => {
      const updates: Record<string, unknown> = {};
      if (result.isEnabled === undefined) {
        updates.isEnabled = true;
      }
      if (result.detectionThreshold === undefined) {
        updates.detectionThreshold = 50;
      }
      if (Object.keys(updates).length > 0) {
        chrome.storage.sync.set(updates);
      }
    });

    chrome.contextMenus.create({
      id: "detectium-analyze-selection",
      title: "Detectium으로 선택한 텍스트 분석",
      contexts: ["selection"],
    });
  });

  // 컨텍스트 메뉴 클릭 이벤트 핸들러
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "detectium-analyze-selection" && tab?.id) {
      const selectedText = info.selectionText || "";
      chrome.tabs.sendMessage(tab.id, {
        type: "ANALYZE_TEXT_REQUEST",
        text: selectedText,
      });
    }
  });

  // 메시지 라우팅 처리
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_EXTENSION_STATUS") {
      chrome.storage.sync.get(["isEnabled"], (result) => {
        sendResponse({ isEnabled: result.isEnabled ?? true });
      });
      return true;
    }

    if (message.type === "ANALYZE_POSTS_REQUEST") {
      const req = message as AnalyzePostsRequest;

      chrome.storage.sync.get(["isEnabled", "apiKey"], async (storage) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message || "확장 설정을 읽지 못했습니다.";
          console.error("[Detectium] 설정 조회 실패:", error);
          sendResponse({ success: false, error } as AnalyzePostsResponse);
          return;
        }

        const isEnabled = storage.isEnabled !== false;
        if (!isEnabled) {
          sendResponse({
            success: false,
            error: "Detectium 확장이 비활성화되어 있습니다.",
          } as AnalyzePostsResponse);
          return;
        }

        const apiKey = typeof storage.apiKey === "string" ? storage.apiKey : undefined;
        try {
          const results = await analyzePostsWithOpenAI(req.posts, apiKey);
          sendResponse({ success: true, results } as AnalyzePostsResponse);
        } catch (err: any) {
          console.error("[Detectium] LLM 분석 실패:", err);
          sendResponse({
            success: false,
            error: err?.message || "분석 중 알 수 없는 오류가 발생했습니다.",
          } as AnalyzePostsResponse);
        }
      });

      return true;
    }
  });
});
