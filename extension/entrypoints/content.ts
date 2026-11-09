import { extractVisiblePosts, getPlatform } from "../utils/postExtractor";
import { injectWarningBanner } from "../utils/domRenderer";
import type { AnalyzePostsRequest, AnalyzePostsResponse, ScannedPostItem } from '../utils/types';

type PostData = AnalyzePostsRequest['posts'][number];

export default defineContentScript({
  matches: ["*://*/*"],
  runAt: 'document_idle',
  main(ctx) {
    // ==========================================
    // 0. 중복 주입 방지
    // ==========================================
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

    // ==========================================
    // 1. 상태 및 설정
    // ==========================================
    const BATCH_SIZE = 3; // 이미지 OCR/비전 분석 속도를 고려한 배치 크기
    const MAX_STORED_POSTS = 25;
    const BACKGROUND_TIMEOUT_MS = 90_000;

    let isExtensionActive = true;
    let highlightColor = '#4f46e5';

    // 진행 중인 분석 요청 관리 (처리 후 정리하여 메모리 누수 방지)
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

    // ==========================================
    // 2. 스캔 게시글 스토리지 동기화 (팝업 표시용)
    // ==========================================
    // 동시 호출 시 get -> set 경쟁 상태로 데이터가 유실되지 않도록 직렬화
    let saveQueue: Promise<void> = Promise.resolve();

    const saveOrUpdateScannedPosts = (newOrUpdatedItems: ScannedPostItem[]): Promise<void> => {
      if (!chrome.storage?.local) return saveQueue;

      saveQueue = saveQueue
        .then(
          () =>
            new Promise<void>((resolve) => {
              chrome.storage.local.get(['scannedPosts'], (res) => {
                const existing: ScannedPostItem[] = Array.isArray(res?.scannedPosts) ? res.scannedPosts : [];
                const map = new Map<string, ScannedPostItem>();

                existing.forEach((item) => map.set(item.id, item));

                newOrUpdatedItems.forEach((item) => {
                  const prev = map.get(item.id);
                  map.set(item.id, {
                    ...prev,
                    ...item,
                    // 기존 분석 결과가 있다면 보존
                    analysisResult: item.analysisResult || prev?.analysisResult,
                  });
                });

                // 최신순 정렬 후 최대 개수만 보관
                const merged = Array.from(map.values())
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .slice(0, MAX_STORED_POSTS);

                chrome.storage.local.set({ scannedPosts: merged }, () => {
                  console.log(`[Detectium][content.ts:saveOrUpdateScannedPosts] 스토리지 저장 완료 (총 ${merged.length}개 게시글)`);
                  resolve();
                });
              });
            })
        )
        .catch((error: unknown) => {
          console.error('[Detectium][content.ts:saveOrUpdateScannedPosts] 저장 실패:', error);
        });

      return saveQueue;
    };

    // ScannedPostItem 생성 헬퍼 (반복되던 객체 생성 코드를 통합)
    const buildScannedItem = (
      data: PostData,
      status: ScannedPostItem['status'],
      extra: Partial<ScannedPostItem> = {}
    ): ScannedPostItem => ({
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
      status,
      timestamp: Date.now(),
      ...extra,
    });

    const describeElement = (element: HTMLElement): string => {
      const cls = typeof element.className === 'string' ? element.className.trim() : '';
      return element.tagName.toLowerCase() + (cls ? `.${cls.split(/\s+/).join('.')}` : '');
    };

    // ==========================================
    // 3. 토스트 알림 (Shadow DOM으로 페이지 스타일과 격리)
    // ==========================================
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

      // 사용자가 선택한 텍스트가 들어오므로 innerHTML 대신 textContent로 XSS 방지
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';

      const titleEl = document.createElement('strong');
      titleEl.style.cssText = 'font-size: 14px; font-weight: 600; color: #fff;';
      titleEl.textContent = `🔍 ${title}`;

      const closeBtn = document.createElement('span');
      closeBtn.style.cssText = 'cursor: pointer; opacity: 0.7; font-size: 16px;';
      closeBtn.textContent = '×';

      header.append(titleEl, closeBtn);

      const body = document.createElement('p');
      body.style.cssText = 'margin: 0; line-height: 1.4; color: #cbd5e1; word-break: break-word; white-space: pre-wrap;';
      body.textContent = message;

      toast.append(header, body);
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

      closeBtn.addEventListener('click', closeToast);
      setTimeout(closeToast, 4500);
    };

    // ==========================================
    // 4. 팩트체크 대상 검증
    // ==========================================
    const isValidFactCheckTarget = (data: PostData): boolean => {
      const trimmedContent = data.content.trim();
      const trimmedAuthor = (data.author || '').trim();

      if (data.platform === 'instagram' && trimmedContent.length === 0) {
        console.warn(`[Detectium][content.ts:scan] 인스타그램 캡션이 비어 있어 API 전송 제외 (ID: ${data.id})`);
        return false;
      }

      if (trimmedContent.length === 0 && (!data.mediaDescription || data.mediaDescription.length < 10)) {
        console.warn(`[Detectium][content.ts:scan] 본문 내용이 없어 API 전송 제외 (ID: ${data.id}, 작성자: ${data.author})`);
        return false;
      }

      if (trimmedContent === trimmedAuthor || trimmedContent.replace(/[@\s]/g, '') === trimmedAuthor.replace(/[@\s]/g, '')) {
        console.warn(`[Detectium][content.ts:scan] 캡션에 작성자 계정명만 포함되어 있어 API 전송 제외 (ID: ${data.id})`);
        return false;
      }

      return true;
    };

    // ==========================================
    // 5. 스캔 & 분석
    // ==========================================
    let isAnalyzing = false;
    let activeScan: Promise<void> | null = null;

    // 남은 가시 후보가 더 있으면 다음 틱에 이어서 스캔 (후속 스캔은 강제 재스캔 아님: 무한 반복 방지)
    const scheduleNextBatch = (remaining: number) => {
      if (remaining > BATCH_SIZE) {
        setTimeout(() => {
          void scanAndAnalyzeVisiblePosts(false);
        }, 1000);
      }
    };

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

    const runScanAndAnalyzeVisiblePosts = async (forceRescan = false): Promise<void> => {
      console.log(`[Detectium][content.ts:scan] 스캔 시작 요청 (활성 상태: ${isExtensionActive}, 분석 중: ${isAnalyzing}, 강제: ${forceRescan})`);

      if (!isExtensionActive) {
        console.log('[Detectium][content.ts:scan] 확장이 비활성화 상태이므로 스캔 건너뜀');
        return;
      }

      if (isAnalyzing && !forceRescan) {
        console.log('[Detectium][content.ts:scan] 이미 분석이 진행 중이므로 건너뜀');
        return;
      }

      console.info('[Detectium][EXTRACT] 게시글 추출 시작', {
        url: window.location.href,
        platform: getPlatform(),
        forceRescan,
        startedAt: new Date().toISOString(),
      });

      // extractVisiblePosts()는 인자가 없는 동기 함수이므로,
      // 강제 재스캔은 기존 처리 상태 마킹(pending/done/skipped)을 지워서 다시 후보가 되게 처리
      if (forceRescan) {
        document.querySelectorAll<HTMLElement>('[data-detectium-status]').forEach((el) => {
          delete el.dataset.detectiumStatus;
        });
      }
      // 동기/비동기 구현 모두 대응: Promise면 기다리고, 배열이 아니면 원인 파악을 위해 로그를 남기고 종료
      const extracted: unknown = await (extractVisiblePosts as (force?: boolean) => unknown)(forceRescan);
      if (!Array.isArray(extracted)) {
        console.error('[Detectium][EXTRACT] extractVisiblePosts 반환값이 배열이 아닙니다:', {
          type: typeof extracted,
          value: extracted,
        });
        return;
      }
      const visibleCandidates = extracted as Array<{ data: PostData; element: HTMLElement }>;
      if (visibleCandidates.length === 0) {
        console.log('[Detectium][content.ts:scan] 화면에서 추출된 가시 게시글이 없습니다.');
        return;
      }
      console.log(`[Detectium][content.ts:scan] postExtractor.ts에서 게시글 ${visibleCandidates.length}개 전달받음`);

      const batchToProcess = visibleCandidates.slice(0, BATCH_SIZE);

      // 대상 엘리먼트들에 pending 상태 마킹
      batchToProcess.forEach(({ data, element }) => {
        element.dataset.detectiumStatus = 'pending';
        pendingElementsMap.set(data.id, element);
      });

      // 1. 추출 완료된 게시글을 스토리지에 동기화 (팝업에서 확인용)
      saveOrUpdateScannedPosts(
        batchToProcess.map(({ data, element }) =>
          buildScannedItem(data, 'extracted', { domSelector: describeElement(element) })
        )
      );

      // 2. 유효한 텍스트 검증: 전송 불가 게시글은 제외
      const validPostsToSend: typeof batchToProcess = [];
      batchToProcess.forEach((candidate) => {
        if (isValidFactCheckTarget(candidate.data)) {
          validPostsToSend.push(candidate);
        } else {
          // 'pending'으로 남지 않도록 건너뜀 상태로 표시하고 맵에서 제거
          candidate.element.dataset.detectiumStatus = 'skipped';
          pendingElementsMap.delete(candidate.data.id);
        }
      });

      if (validPostsToSend.length === 0) {
        console.log('[Detectium][content.ts:scan] 유효한 팩트체크 대상 게시글이 없어 API 분석 요청 생략');
        scheduleNextBatch(visibleCandidates.length);
        return;
      }

      const postsPayload = validPostsToSend.map((item) => item.data);
      const totalImagesInBatch = validPostsToSend.reduce((sum, item) => sum + (item.data.imageUrls?.length || 0), 0);

      isAnalyzing = true;
      console.log(
        `[Detectium] 스크롤 정지 감지: 뷰포트 내 게시글 ${validPostsToSend.length}개 분석 시작 (첨부 이미지 총 ${totalImagesInBatch}장)`,
        validPostsToSend
      );

      // 3. API 전달 데이터 검증 로그
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
      saveOrUpdateScannedPosts(
        validPostsToSend.map(({ data, element }) =>
          buildScannedItem(data, 'api_sent', { domSelector: element.tagName.toLowerCase() })
        )
      );

      // 실패 공통 처리: 상태 기록 + 재검사 가능하도록 dataset 초기화
      const handleFailure = (reason: string) => {
        saveOrUpdateScannedPosts(
          validPostsToSend.map(({ data }) =>
            buildScannedItem(data, 'analysis_failed', { failureReason: reason })
          )
        );
        validPostsToSend.forEach(({ element }) => {
          delete element.dataset.detectiumStatus;
        });
      };

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
              error: `Background 응답 제한 시간(${BACKGROUND_TIMEOUT_MS / 1000}초)을 초과했습니다.`,
            });
          }, BACKGROUND_TIMEOUT_MS);

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
        console.log(`[Detectium][content.ts:scan] background.ts 응답 수신 (성공: ${response.success})`);

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
                console.warn(`[Detectium][content.ts:injectWarningBanner] 선동/왜곡 게시글 감지됨 [${result.category}]:`, result.summary);
                injectWarningBanner(el, result, highlightColor);
              }
            }

            const postCandidate = validPostsToSend.find((p) => p.data.id === result.id);
            if (postCandidate) {
              analyzedItems.push(buildScannedItem(postCandidate.data, 'analyzed', { analysisResult: result }));
            }
          });

          // 응답에 포함되지 않은 게시글은 'pending'으로 남지 않도록 초기화 (다음 스캔에서 재시도)
          const returnedIds = new Set(response.results.map((r) => r.id));
          validPostsToSend.forEach(({ data, element }) => {
            if (!returnedIds.has(data.id)) {
              delete element.dataset.detectiumStatus;
            }
          });

          if (analyzedItems.length > 0) {
            saveOrUpdateScannedPosts(analyzedItems);
          }
        } else {
          console.warn('[Detectium][content.ts:scan] 분석 요청 실패 또는 결과 없음:', response.error);
          handleFailure(response.error || '분석 응답 오류');
        }
      } catch (err: unknown) {
        console.error('[Detectium][content.ts:scan] 분석 실행 중 오류:', err);
        handleFailure(err instanceof Error ? err.message : '실행 오류');
      } finally {
        isAnalyzing = false;
        batchToProcess.forEach(({ data }) => pendingElementsMap.delete(data.id));
        scheduleNextBatch(visibleCandidates.length);
      }
    };

    // ==========================================
    // 6. 트리거: 스크롤 정지 / SPA 이동 / 초기 로딩 / DOM 변화
    // ==========================================
    let scrollStopTimer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      // 사용자가 스크롤을 멈췄을 때 (650ms 동안 추가 스크롤이 없을 때)
      scrollStopTimer = setTimeout(() => {
        void scanAndAnalyzeVisiblePosts(false);
      }, 3000);
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
      void scanAndAnalyzeVisiblePosts(false);
    }, 1200);

    // 동적으로 피드 콘텐츠가 렌더링될 때 대비 (MutationObserver)
    let mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      handleSpaNavigation('DOM mutation');
      if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        void scanAndAnalyzeVisiblePosts(false);
      }, 900);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // ==========================================
    // 7. Background / Popup 메시지 수신
    // ==========================================
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

      // 팝업에서 스캔 버튼 클릭 시 (강제 재스캔)
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

        const selectedText: string = message.text || '';
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
