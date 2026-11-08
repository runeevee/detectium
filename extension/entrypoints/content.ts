import { extractVisiblePosts } from "../utils/postExtractor";
import { injectWarningBanner } from "../utils/domRenderer";
import type { AnalyzePostsRequest, AnalyzePostsResponse } from '../utils/types';

export default defineContentScript({
  matches: ["*://*/*"],
  runAt: 'document_idle',
  main(ctx) {
    console.log('[Detectium] Content Script Initialized on:', window.location.href);

    let isExtensionActive = true;
    let highlightColor = '#4f46e5';

    // 진행 중인 분석 요청 관리 (메모리 누수 방지용 Map)
    const pendingElementsMap = new Map<string, HTMLElement>();

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
      setTimeout(closeToast, 4500);
    };

    // 현재 뷰포트에 보이는 게시글들을 추출하여 OpenAI 모델로 팩트체크 요청
    let isAnalyzing = false;
    const scanAndAnalyzeVisiblePosts = async () => {
      if (!isExtensionActive || isAnalyzing) {
        return;
      }

      const visibleCandidates = extractVisiblePosts();
      if (!visibleCandidates || visibleCandidates.length === 0) {
        return;
      }

      // 게시글 내 이미지 OCR 및 비전 분석 속도를 고려하여 3개씩 배치 처리
      const batchToProcess = visibleCandidates.slice(0, 3);

      // 대상 엘리먼트들에 pending 상태 마킹
      batchToProcess.forEach(({ data, element }) => {
        element.dataset.detectiumStatus = 'pending';
        pendingElementsMap.set(data.id, element);
      });

      const totalImagesInBatch = batchToProcess.reduce((sum, item) => sum + (item.data.imageUrls?.length || 0), 0);
      isAnalyzing = true;
      console.log(
        `[Detectium] 스크롤 정지 감지: 뷰포트 내 게시글 ${batchToProcess.length}개 분석 시작 (첨부 이미지 총 ${totalImagesInBatch}장)`,
        batchToProcess
      );

      try {
        const payload: AnalyzePostsRequest = {
          type: 'ANALYZE_POSTS_REQUEST',
          posts: batchToProcess.map((item) => item.data),
        };

        const response: AnalyzePostsResponse = await new Promise((resolve) => {
          chrome.runtime.sendMessage(payload, (res) => {
            if (chrome.runtime.lastError) {
              resolve({
                success: false,
                error: chrome.runtime.lastError.message,
              });
            } else {
              resolve(res || { success: false, error: '응답이 비어있습니다.' });
            }
          });
        });

        if (response.success && response.results) {
          console.log('[Detectium] 팩트체크 분석 완료:', response.results);

          response.results.forEach((result) => {
            const el = pendingElementsMap.get(result.id);
            if (el) {
              el.dataset.detectiumStatus = 'done';

              // 선동성 글, 가짜뉴스, 통계 왜곡 게시글인 경우 경고 DOM 띄우기
              if (result.isFakeOrMisleading) {
                console.warn(`[Detectium] 선동/왜곡 게시글 감지됨 [${result.category}]:`, result.summary);
                injectWarningBanner(el, result, highlightColor);
              }
            }
          });
        } else {
          console.warn('[Detectium] 분석 요청 실패 또는 결과 없음:', response.error);
          batchToProcess.forEach(({ element }) => {
            // 실패 시 다시 검사할 수 있도록 초기화
            delete element.dataset.detectiumStatus;
          });
        }
      } catch (err) {
        console.error('[Detectium] 분석 실행 중 오류:', err);
        batchToProcess.forEach(({ element }) => {
          delete element.dataset.detectiumStatus;
        });
      } finally {
        isAnalyzing = false;
        // 남은 가시 후보가 더 있으면 다음 틱에 이어서 스캔
        if (visibleCandidates.length > 3) {
          setTimeout(scanAndAnalyzeVisiblePosts, 800);
        }
      }
    };

    // ==========================================
    // 스크롤 정지 감지 (Scroll Debounce)
    // ==========================================
    let scrollStopTimer: any = null;
    const handleScroll = () => {
      if (scrollStopTimer) {
        clearTimeout(scrollStopTimer);
      }
      // 사용자가 스크롤을 하다가 멈췄을 때 (650ms 동안 추가 스크롤이 없을 때)
      scrollStopTimer = setTimeout(() => {
        scanAndAnalyzeVisiblePosts();
      }, 650);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    // 초기 로딩 후 가시 화면의 첫 게시글들 검사
    setTimeout(() => {
      scanAndAnalyzeVisiblePosts();
    }, 1200);

    // 동적으로 피드 콘텐츠가 렌더링될 때 대비 (MutationObserver)
    let mutationDebounceTimer: any = null;
    const observer = new MutationObserver(() => {
      if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        scanAndAnalyzeVisiblePosts();
      }, 900);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

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
