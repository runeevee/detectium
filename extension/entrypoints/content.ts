import { extractVisiblePosts, getPlatform } from "../utils/postExtractor";
import { injectWarningBanner } from "../utils/domRenderer";
import type { AnalyzePostsRequest, AnalyzePostsResponse, ScannedPostItem } from '../utils/types';

export default defineContentScript({
  matches: ["*://*/*"],
  runAt: 'document_idle',
  main(ctx) {
    const initializedKey = '__detectiumContentScriptInitialized';
    const contentGlobal = globalThis as typeof globalThis & Record<string, unknown>;
    const isDuplicateInjection = contentGlobal[initializedKey] === true;
    console.info('[Detectium][INIT] Content Script 로드', {
      url: window.location.href,
      platform: getPlatform(),
      executedAt: new Date().toISOString(),
      duplicate: isDuplicateInjection,
    });

    if (isDuplicateInjection) {
      console.warn('[Detectium][INIT] 중복 Content Script 실행을 감지해 추가 초기화를 건너뜁니다.');
      return;
    }
    contentGlobal[initializedKey] = true;

    let isExtensionActive = true;
    let highlightColor = '#4f46e5';

    // 진행 중인 분석 요청 관리 (메모리 누수 방지용 Map)
    const pendingElementsMap = new Map<string, HTMLElement>();

    // 스토리지 설정값 동기화
    const syncSettings = () => {
      chrome.storage.sync.get(['isEnabled', 'highlightColor'], (result) => {
        if (typeof result.isEnabled === 'boolean') {
          isExtensionActive = result.isEnabled;
          console.log('[Detectium][content.ts:syncSettings] 활성화 상태:', isExtensionActive);
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
          console.log('[Detectium][content.ts:onChanged] 확장 활성화 변경:', isExtensionActive);
        }
        if (changes.highlightColor && typeof changes.highlightColor.newValue === 'string') {
          highlightColor = changes.highlightColor.newValue;
        }
      }
    });

    /**
     * 스캔된 게시글 정보를 chrome.storage.local에 동기화 저장
     * 팝업에서 사용자가 스캔한 원문과 팩트체크 상태를 실시간으로 확인할 수 있도록 지원
     */
    const saveOrUpdateScannedPosts = (newOrUpdatedItems: ScannedPostItem[]) => {
      if (!chrome.storage?.local) return;

      chrome.storage.local.get(['scannedPosts'], (res) => {
        const existing: ScannedPostItem[] = Array.isArray(res.scannedPosts) ? res.scannedPosts : [];
        const map = new Map<string, ScannedPostItem>();

        // 기존 항목 등록
        existing.forEach((item) => map.set(item.id, item));

        // 새 항목 덮어쓰기/추가
        newOrUpdatedItems.forEach((item) => {
          const prev = map.get(item.id);
          map.set(item.id, {
            ...prev,
            ...item,
            // 기존 분석 결과가 있다면 보존
            analysisResult: item.analysisResult || prev?.analysisResult,
          });
        });

        // 최신순으로 정렬 후 최대 25개 보관
        const merged = Array.from(map.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 25);

        chrome.storage.local.set({ scannedPosts: merged }, () => {
          console.log(`[Detectium][content.ts:saveOrUpdateScannedPosts] 스토리지 저장 완료 (총 ${merged.length}개 게시글)`);
        });
      });
    };

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
    let activeScan: Promise<void> | null = null;
    const scanAndAnalyzeVisiblePosts = (forceRescan = false): Promise<void> => {
      if (activeScan) {
        console.info('[Detectium][SCAN] 기존 스캔이 진행 중이므로 중복 실행을 건너뜁니다.', {
          forceRescan,
          url: window.location.href,
        });
        return activeScan;
      }

      activeScan = runScanAndAnalyzeVisiblePosts(forceRescan)
        .catch((error: unknown) => {
          console.error('[Detectium][SCAN] 스캔 흐름에서 처리되지 않은 오류:', error);
        })
        .finally(() => {
          activeScan = null;
        });
      return activeScan;
    };

    const runScanAndAnalyzeVisiblePosts = async (forceRescan = false) => {
      console.log(`[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 스캔 시작 요청 (활성 상태: ${isExtensionActive}, 분석 중: ${isAnalyzing}, 강제: ${forceRescan})`);

      if (!isExtensionActive) {
        console.log('[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 확장이 비활성화 상태이므로 스캔 건너뜀');
        return;
      }

      if (isAnalyzing && !forceRescan) {
        console.log('[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 이미 분석이 진행 중이므로 건너뜀');
        return;
      }

      console.info('[Detectium][EXTRACT] 게시글 추출 시작', {
        url: window.location.href,
        platform: getPlatform(),
        forceRescan,
        startedAt: new Date().toISOString(),
      });
      const visibleCandidates = await extractVisiblePosts(forceRescan);
      if (!visibleCandidates || visibleCandidates.length === 0) {
        console.log('[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 화면에서 추출된 가시 게시글이 없습니다.');
        return;
      }
      console.log(`[Detectium][content.ts:scanAndAnalyzeVisiblePosts] postExtractor.ts에서 게시글 ${visibleCandidates.length}개 전달받음`);

      // 게시글 내 이미지 OCR 및 비전 분석 속도를 고려하여 3개씩 배치 처리
      const batchToProcess = visibleCandidates.slice(0, 3);

      // 대상 엘리먼트들에 pending 상태 마킹
      batchToProcess.forEach(({ data, element }) => {
        element.dataset.detectiumStatus = 'pending';
        pendingElementsMap.set(data.id, element);
      });

      // 1. 추출 완료된 게시글 정보를 ScannedPostItem 형태로 생성하여 스토리지에 동기화
      const initialScannedItems: ScannedPostItem[] = batchToProcess.map(({ data, element }) => ({
        id: data.id,
        platform: data.platform,
        author: data.author,
        content: data.content,
        contentLength: data.content.length,
        url: data.url,
        shortcode: data.shortcode,
        mediaDescription: data.mediaDescription,
        isVisible: true,
        extractionSuccess: true,
        status: 'extracted',
        timestamp: Date.now(),
        domSelector: element.tagName.toLowerCase() + (element.className ? `.${element.className.split(' ').join('.')}` : ''),
      }));

      saveOrUpdateScannedPosts(initialScannedItems);

      // 2. 유효한 텍스트 검증: 캡션이 비어있거나 작성자명만 있는 게시글은 API 전송 대상에서 엄격히 제외
      const validPostsToSend = batchToProcess.filter(({ data }) => {
        const trimmedContent = data.content.trim();
        const trimmedAuthor = (data.author || '').trim();

        if (data.platform === 'instagram' && trimmedContent.length === 0) {
          console.warn(`[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 인스타그램 캡션이 비어 있어 API 전송 제외 (ID: ${data.id})`);
          return false;
        }

        // 내용이 아예 없는 경우
        if (trimmedContent.length === 0 && (!data.mediaDescription || data.mediaDescription.length < 10)) {
          console.warn(`[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 본문 내용이 없어 API 전송 제외 (ID: ${data.id}, 작성자: ${data.author})`);
          return false;
        }

        // 작성자 계정명만 단독으로 들어간 경우
        if (trimmedContent === trimmedAuthor || trimmedContent.replace(/[@\s]/g, '') === trimmedAuthor.replace(/[@\s]/g, '')) {
          console.warn(`[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 캡션에 작성자 계정명만 포함되어 있어 API 전송 제외 (ID: ${data.id})`);
          return false;
        }

        return true;
      });

      if (validPostsToSend.length === 0) {
        console.log('[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 유효한 팩트체크 대상 게시글이 없어 API 분석 요청 생략');
        return;
      }

      isAnalyzing = true;
      console.log(`[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 가시 게시글 ${validPostsToSend.length}개 팩트체크 API 전달 시작`);
      const postsPayload = validPostsToSend.map((item) => item.data);

      // 3. API 전달 데이터 검증 및 단계별 명시적 로그 기록 (요구사항 6)
      validPostsToSend.forEach(({ data }, idx) => {
        const apiPost = postsPayload[idx];
        console.info(`[Detectium][API] 전체 캡션 전달 확인 #${idx + 1}`, {
          id: data.id,
          platform: data.platform,
          author: data.author,
          captionLength: data.content.length,
          captionPreview: data.content.slice(0, 100) + (data.content.length > 100 ? '...' : ''),
          exactCaptionPreserved: apiPost?.content === data.content,
          url: data.url,
        });
      });

      // API 전송 상태로 스토리지 업데이트
      const apiSentItems: ScannedPostItem[] = validPostsToSend.map(({ data, element }) => ({
        id: data.id,
        platform: data.platform,
        author: data.author,
        content: data.content,
        contentLength: data.content.length,
        url: data.url,
        shortcode: data.shortcode,
        mediaDescription: data.mediaDescription,
        isVisible: true,
        extractionSuccess: true,
        status: 'api_sent',
        timestamp: Date.now(),
        domSelector: element.tagName.toLowerCase(),
      }));
      saveOrUpdateScannedPosts(apiSentItems);
      const totalImagesInBatch = batchToProcess.reduce((sum, item) => sum + (item.data.imageUrls?.length || 0), 0);
      isAnalyzing = true;
      console.log(
        `[Detectium] 스크롤 정지 감지: 뷰포트 내 게시글 ${batchToProcess.length}개 분석 시작 (첨부 이미지 총 ${totalImagesInBatch}장)`,
        batchToProcess
      );

      try {
        const payload: AnalyzePostsRequest = {
          type: 'ANALYZE_POSTS_REQUEST',
          posts: postsPayload,
        };

        const response: AnalyzePostsResponse = await new Promise((resolve) => {
          let settled = false;
          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve({
              success: false,
              error: 'Background 응답 제한 시간(90초)을 초과했습니다.',
            });
          }, 90_000);

          chrome.runtime.sendMessage(payload, (res) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              console.error('[Detectium][API] Background 메시지 전달 실패:', chrome.runtime.lastError.message);
              resolve({
                success: false,
                error: chrome.runtime.lastError.message,
              });
            } else {
              resolve(res || { success: false, error: '응답이 비어있습니다.' });
            }
          });
        });
        console.log(`[Detectium][content.ts:scanAndAnalyzeVisiblePosts] background.ts 응답 수신 (성공: ${response.success})`);

        if (response.success && response.results) {
          console.info('[Detectium][RESULT] 팩트체크 결과 수신', {
            resultCount: response.results.length,
            results: response.results,
          });

          const analyzedItems: ScannedPostItem[] = [];

          response.results.forEach((result) => {
            const el = pendingElementsMap.get(result.id);
            if (el) {
              el.dataset.detectiumStatus = 'done';

              // 선동성 글, 가짜뉴스, 통계 왜곡 게시글인 경우 경고 DOM 띄우기
              if (result.isFakeOrMisleading) {
                console.warn(`[Detectium][content.ts:injectWarningBanner] 왜곡/가짜뉴스 감지됨 (${result.category}):`, result.summary);
                injectWarningBanner(el, result, highlightColor);
              }
            }

            const postCandidate = validPostsToSend.find((p) => p.data.id === result.id);
            if (postCandidate) {
              analyzedItems.push({
                id: result.id,
                platform: postCandidate.data.platform,
                author: postCandidate.data.author,
                content: postCandidate.data.content,
                contentLength: postCandidate.data.content.length,
                url: postCandidate.data.url,
                shortcode: postCandidate.data.shortcode,
                mediaDescription: postCandidate.data.mediaDescription,
                isVisible: true,
                extractionSuccess: true,
                status: 'analyzed',
                timestamp: Date.now(),
                analysisResult: result,
              });
            }
          });

          if (analyzedItems.length > 0) {
            saveOrUpdateScannedPosts(analyzedItems);
          }
        } else {
          console.warn('[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 분석 요청 실패 또는 결과 없음:', response.error);

          const failedItems: ScannedPostItem[] = validPostsToSend.map(({ data }) => ({
            id: data.id,
            platform: data.platform,
            author: data.author,
            content: data.content,
            contentLength: data.content.length,
            url: data.url,
            shortcode: data.shortcode,
            mediaDescription: data.mediaDescription,
            isVisible: true,
            extractionSuccess: true,
            status: 'analysis_failed',
            timestamp: Date.now(),
            failureReason: response.error || '분석 응답 오류',
          }));
          saveOrUpdateScannedPosts(failedItems);

          validPostsToSend.forEach(({ element }) => {
            delete element.dataset.detectiumStatus;
          });
        }
      } catch (err: any) {
        console.error('[Detectium][content.ts:scanAndAnalyzeVisiblePosts] 분석 실행 중 오류:', err);

        const failedItems: ScannedPostItem[] = validPostsToSend.map(({ data }) => ({
          id: data.id,
          platform: data.platform,
          author: data.author,
          content: data.content,
          contentLength: data.content.length,
          url: data.url,
          shortcode: data.shortcode,
          mediaDescription: data.mediaDescription,
          isVisible: true,
          extractionSuccess: true,
          status: 'analysis_failed',
          timestamp: Date.now(),
          failureReason: err?.message || '실행 오류',
        }));
        saveOrUpdateScannedPosts(failedItems);

        validPostsToSend.forEach(({ element }) => {
          delete element.dataset.detectiumStatus;
        });
      } finally {
        isAnalyzing = false;
        // 남은 가시 후보가 더 있으면 다음 틱에 이어서 스캔
        if (visibleCandidates.length > 5) {
          setTimeout(() => scanAndAnalyzeVisiblePosts(forceRescan), 1000);
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
      scrollStopTimer = setTimeout(() => {
        scanAndAnalyzeVisiblePosts(false);
      }, 650);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    let lastObservedUrl = window.location.href;
    const handleSpaNavigation = (source: string) => {
      const currentUrl = window.location.href;
      if (currentUrl === lastObservedUrl) return;
      console.info('[Detectium][INIT] SPA 경로 변경 감지', {
        source,
        previousUrl: lastObservedUrl,
        currentUrl,
      });
      lastObservedUrl = currentUrl;
      setTimeout(() => {
        void scanAndAnalyzeVisiblePosts(false);
      }, 900);
    };
    window.addEventListener('popstate', () => handleSpaNavigation('popstate'));
    window.addEventListener('hashchange', () => handleSpaNavigation('hashchange'));

    // 초기 로딩 후 가시 화면의 첫 게시글들 검사
    setTimeout(() => {
      scanAndAnalyzeVisiblePosts(false);
    }, 1200);

    // 동적으로 피드 콘텐츠가 렌더링될 때 대비 (MutationObserver)
    let mutationDebounceTimer: any = null;
    const observer = new MutationObserver(() => {
      handleSpaNavigation('DOM mutation');
      if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        scanAndAnalyzeVisiblePosts(false);
      }, 900);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Background Service Worker 및 Popup으로부터 메시지 수신
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.info('[Detectium][MESSAGE] 메시지 수신', {
        type: message?.type,
        senderUrl: sender.url,
        pageUrl: window.location.href,
        receivedAt: new Date().toISOString(),
      });

      if (message.type === 'PING') {
        sendResponse({ status: 'PONG', url: window.location.href });
        return;
      }

      // 팝업에서 스캔 버튼 클릭 시 (강제 재스캔 플래그 전달)
      if (message.type === 'TRIGGER_SCAN') {
        console.log('[Detectium][content.ts:onMessage] 팝업의 TRIGGER_SCAN 요청 수락 -> 강제 재스캔 실행');
        sendResponse({ success: true, accepted: true });
        void scanAndAnalyzeVisiblePosts(true).then(() => {
          console.info('[Detectium][MESSAGE] 스캔 요청 처리 완료', { url: window.location.href });
        });
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
    console.info('[Detectium][INIT] 메시지 수신기 등록 완료');
  },
});
