import { extractVisiblePosts } from "../utils/postExtractor";
import { injectWarningBanner } from "../utils/domRenderer";
import type { AnalyzePostsRequest, AnalyzePostsResponse, ScannedPostItem } from "../utils/types";

type PostData = AnalyzePostsRequest["posts"][number];

export default defineContentScript({
  matches: ["*://*/*"],
  runAt: "document_idle",
  main(_ctx) {
    // 중복 주입 방지
    const initializedKey = "__detectiumContentScriptInitialized";
    const contentGlobal = globalThis as typeof globalThis & Record<string, unknown>;
    if (contentGlobal[initializedKey] === true) {
      return;
    }
    contentGlobal[initializedKey] = true;

    const BATCH_SIZE = 3;
    const MAX_STORED_POSTS = 25;
    const BACKGROUND_TIMEOUT_MS = 90_000;

    let isExtensionActive = true;
    let highlightColor = "#4f46e5";

    // 진행 중인 분석 요청 관리
    const pendingElementsMap = new Map<string, HTMLElement>();

    // 스토리지 설정 동기화
    const syncSettings = () => {
      chrome.storage.sync.get(["isEnabled", "highlightColor"], (result) => {
        if (typeof result.isEnabled === "boolean") {
          isExtensionActive = result.isEnabled;
        }
        if (typeof result.highlightColor === "string") {
          highlightColor = result.highlightColor;
        }
      });
    };

    syncSettings();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync") {
        if (changes.isEnabled && typeof changes.isEnabled.newValue === "boolean") {
          isExtensionActive = changes.isEnabled.newValue;
        }
        if (changes.highlightColor && typeof changes.highlightColor.newValue === "string") {
          highlightColor = changes.highlightColor.newValue;
        }
      }
    });

    // 스캔 게시글 스토리지 동기화 (경쟁 상태 방지용 직렬 큐)
    let saveQueue: Promise<void> = Promise.resolve();

    const saveOrUpdateScannedPosts = (newOrUpdatedItems: ScannedPostItem[]): Promise<void> => {
      if (!chrome.storage?.local) return saveQueue;

      saveQueue = saveQueue
        .then(
          () =>
            new Promise<void>((resolve) => {
              chrome.storage.local.get(["scannedPosts"], (res) => {
                const existing: ScannedPostItem[] = Array.isArray(res?.scannedPosts) ? res.scannedPosts : [];
                const map = new Map<string, ScannedPostItem>();

                existing.forEach((item) => map.set(item.id, item));

                newOrUpdatedItems.forEach((item) => {
                  const prev = map.get(item.id);
                  map.set(item.id, {
                    ...prev,
                    ...item,
                    analysisResult: item.analysisResult || prev?.analysisResult,
                  });
                });

                const merged = Array.from(map.values())
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .slice(0, MAX_STORED_POSTS);

                chrome.storage.local.set({ scannedPosts: merged }, () => resolve());
              });
            })
        )
        .catch((error: unknown) => {
          console.error("[Detectium] 스토리지 저장 실패:", error);
        });

      return saveQueue;
    };

    const buildScannedItem = (
      data: PostData,
      status: ScannedPostItem["status"],
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
      const cls = typeof element.className === "string" ? element.className.trim() : "";
      return element.tagName.toLowerCase() + (cls ? `.${cls.split(/\s+/).join(".")}` : "");
    };

    // 토스트 알림 (Shadow DOM)
    const showNotification = (title: string, message: string) => {
      const containerId = "detectium-toast-container";
      let hostElement = document.getElementById(containerId);

      if (!hostElement) {
        hostElement = document.createElement("div");
        hostElement.id = containerId;
        hostElement.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
        document.body.appendChild(hostElement);
      }

      const shadow = hostElement.shadowRoot || hostElement.attachShadow({ mode: "open" });

      const toast = document.createElement("div");
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

      const header = document.createElement("div");
      header.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 8px;";

      const titleEl = document.createElement("strong");
      titleEl.style.cssText = "font-size: 14px; font-weight: 600; color: #fff;";
      titleEl.textContent = `🔍 ${title}`;

      const closeBtn = document.createElement("span");
      closeBtn.style.cssText = "cursor: pointer; opacity: 0.7; font-size: 16px;";
      closeBtn.textContent = "×";

      header.append(titleEl, closeBtn);

      const body = document.createElement("p");
      body.style.cssText = "margin: 0; line-height: 1.4; color: #cbd5e1; word-break: break-word; white-space: pre-wrap;";
      body.textContent = message;

      toast.append(header, body);
      shadow.appendChild(toast);

      requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
      });

      const closeToast = () => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 250);
      };

      closeBtn.addEventListener("click", closeToast);
      setTimeout(closeToast, 4500);
    };

    // 팩트체크 대상 검증
    const isValidFactCheckTarget = (data: PostData): boolean => {
      const trimmedContent = data.content.trim();
      const trimmedAuthor = (data.author || "").trim();

      if (data.platform === "instagram" && trimmedContent.length === 0) {
        return false;
      }
      if (trimmedContent.length === 0 && (!data.mediaDescription || data.mediaDescription.length < 10)) {
        return false;
      }
      if (
        trimmedContent === trimmedAuthor ||
        trimmedContent.replace(/[@\s]/g, "") === trimmedAuthor.replace(/[@\s]/g, "")
      ) {
        return false;
      }

      return true;
    };

    let isAnalyzing = false;
    let activeScan: Promise<void> | null = null;

    const scheduleNextBatch = (remaining: number) => {
      if (remaining > BATCH_SIZE) {
        setTimeout(() => {
          void scanAndAnalyzeVisiblePosts(false);
        }, 1000);
      }
    };

    const scanAndAnalyzeVisiblePosts = (forceRescan = false): Promise<void> => {
      if (activeScan) {
        return activeScan;
      }

      activeScan = runScanAndAnalyzeVisiblePosts(forceRescan)
        .catch((error: unknown) => {
          console.error("[Detectium] 스캔 오류:", error);
        })
        .finally(() => {
          activeScan = null;
        });
      return activeScan;
    };

    const runScanAndAnalyzeVisiblePosts = async (forceRescan = false): Promise<void> => {
      if (!isExtensionActive || (isAnalyzing && !forceRescan)) {
        return;
      }

      if (forceRescan) {
        document.querySelectorAll<HTMLElement>("[data-detectium-status]").forEach((el) => {
          delete el.dataset.detectiumStatus;
        });
      }

      const extracted: unknown = await (extractVisiblePosts as (force?: boolean) => unknown)(forceRescan);
      if (!Array.isArray(extracted)) {
        return;
      }

      const visibleCandidates = extracted as Array<{ data: PostData; element: HTMLElement }>;
      if (visibleCandidates.length === 0) {
        return;
      }

      const batchToProcess = visibleCandidates.slice(0, BATCH_SIZE);

      batchToProcess.forEach(({ data, element }) => {
        element.dataset.detectiumStatus = "pending";
        pendingElementsMap.set(data.id, element);
      });

      // 1. 추출 완료된 게시글 스토리지 동기화
      saveOrUpdateScannedPosts(
        batchToProcess.map(({ data, element }) =>
          buildScannedItem(data, "extracted", { domSelector: describeElement(element) })
        )
      );

      // 2. 유효 텍스트 검증
      const validPostsToSend: typeof batchToProcess = [];
      batchToProcess.forEach((candidate) => {
        if (isValidFactCheckTarget(candidate.data)) {
          validPostsToSend.push(candidate);
        } else {
          candidate.element.dataset.detectiumStatus = "skipped";
          pendingElementsMap.delete(candidate.data.id);
        }
      });

      if (validPostsToSend.length === 0) {
        scheduleNextBatch(visibleCandidates.length);
        return;
      }

      const postsPayload = validPostsToSend.map((item) => item.data);
      isAnalyzing = true;

      // API 전송 상태로 스토리지 업데이트
      saveOrUpdateScannedPosts(
        validPostsToSend.map(({ data, element }) =>
          buildScannedItem(data, "api_sent", { domSelector: element.tagName.toLowerCase() })
        )
      );

      const handleFailure = (reason: string) => {
        saveOrUpdateScannedPosts(
          validPostsToSend.map(({ data }) =>
            buildScannedItem(data, "analysis_failed", { failureReason: reason })
          )
        );
        validPostsToSend.forEach(({ element }) => {
          delete element.dataset.detectiumStatus;
        });
      };

      try {
        const payload: AnalyzePostsRequest = {
          type: "ANALYZE_POSTS_REQUEST",
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
              resolve({
                success: false,
                error: chrome.runtime.lastError.message,
              });
            } else {
              resolve(res || { success: false, error: "응답이 비어있습니다." });
            }
          });
        });

        if (response.success && response.results) {
          const analyzedItems: ScannedPostItem[] = [];

          response.results.forEach((result) => {
            const el = pendingElementsMap.get(result.id);
            if (el) {
              el.dataset.detectiumStatus = "done";

              if (result.isFakeOrMisleading) {
                injectWarningBanner(el, result, highlightColor);
              }
            }

            const postCandidate = validPostsToSend.find((p) => p.data.id === result.id);
            if (postCandidate) {
              analyzedItems.push(buildScannedItem(postCandidate.data, "analyzed", { analysisResult: result }));
            }
          });

          // 미응답 항목은 상태 초기화하여 추후 재시도 가능하게 함
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
          handleFailure(response.error || "분석 응답 오류");
        }
      } catch (err: unknown) {
        console.error("[Detectium] 분석 실행 중 오류:", err);
        handleFailure(err instanceof Error ? err.message : "실행 오류");
      } finally {
        isAnalyzing = false;
        batchToProcess.forEach(({ data }) => pendingElementsMap.delete(data.id));
        scheduleNextBatch(visibleCandidates.length);
      }
    };

    // 트리거: 스크롤 정지 / SPA 이동 / 초기 로딩 / DOM 변화
    let scrollStopTimer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(() => {
        void scanAndAnalyzeVisiblePosts(false);
      }, 1500);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    let lastObservedUrl = window.location.href;
    const handleSpaNavigation = () => {
      const currentUrl = window.location.href;
      if (currentUrl === lastObservedUrl) return;
      lastObservedUrl = currentUrl;
      setTimeout(() => {
        void scanAndAnalyzeVisiblePosts(false);
      }, 900);
    };

    window.addEventListener("popstate", handleSpaNavigation);
    window.addEventListener("hashchange", handleSpaNavigation);

    setTimeout(() => {
      void scanAndAnalyzeVisiblePosts(false);
    }, 1200);

    let mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      handleSpaNavigation();
      if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        void scanAndAnalyzeVisiblePosts(false);
      }, 900);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // 메시지 수신 핸들러
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "PING") {
        sendResponse({ status: "PONG", url: window.location.href });
        return;
      }

      if (message.type === "TRIGGER_SCAN") {
        sendResponse({ success: true, accepted: true });
        void scanAndAnalyzeVisiblePosts(true);
        return;
      }

      if (message.type === "ANALYZE_TEXT_REQUEST") {
        if (!isExtensionActive) {
          showNotification("Detectium 알림", "현재 확장이 비활성화되어 있습니다. 팝업에서 활성화해 주세요.");
          return;
        }

        const selectedText: string = message.text || "";
        showNotification(
          "분석 요청 접수",
          `선택한 텍스트 (${selectedText.length}자):\n"${selectedText.slice(0, 70)}${selectedText.length > 70 ? "..." : ""}"`
        );
        sendResponse({ success: true });
      }
    });
  },
});
