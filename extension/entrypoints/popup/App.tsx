import { createSignal, onMount, onCleanup, Show, For, createMemo } from "solid-js";
import type { ScannedPostItem } from '../../utils/types';
import css from "./popup.module.css";

import {
  cleanPostText as cleanPostTextImpl,
  wait as waitImpl,
  expandYouTubePost as expandYouTubePostImpl,
} from '../../utils/postExtractor';
import {
  expandInstagramPost as expandInstagramPostImpl,
  extractInstagramAuthor,
  findInstagramCaptionContainer,
  extractCleanCaptionText,
} from '../../utils/instagramExtractor';

interface ContentScriptResponse {
  status?: string;
  success?: boolean;
  accepted?: boolean;
  error?: string;
  url?: string;
}

function sendTabMessageWithTimeout(
  tabId: number,
  message: { type: string },
  timeoutMs = 8000
): Promise<{ response?: ContentScriptResponse; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ error: `메시지 응답 제한 시간(${timeoutMs}ms)을 초과했습니다.` });
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response: ContentScriptResponse | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const error = chrome.runtime.lastError?.message;
      resolve(error ? { error } : { response });
    });
  });
}

// ============================================================================
// 1. 유틸리티 및 텍스트 정제 함수
// ============================================================================

export const wait = waitImpl;
export const cleanPostText = cleanPostTextImpl;

// ============================================================================
// 2. 플랫폼별 '더보기' 자동 확장 함수
// ============================================================================

export const expandInstagramPost = expandInstagramPostImpl;
export const expandYouTubePost = expandYouTubePostImpl;

// ============================================================================
// 3. 통합 확장 및 전체 본문 수집 헬퍼 함수
// ============================================================================

export async function expandPost(
  container: HTMLElement,
  platform: 'instagram' | 'youtube' | 'x' | 'generic' | string = 'generic'
): Promise<boolean> {
  if (platform === 'instagram') {
    return await expandInstagramPost(container);
  }
  if (platform === 'youtube') {
    return await expandYouTubePost(container);
  }
  const igResult = await expandInstagramPost(container);
  if (igResult) return true;
  return await expandYouTubePost(container);
}

export async function expandAndExtractContent(
  container: HTMLElement,
  platform: 'instagram' | 'youtube' | 'x' | 'generic' | string = 'generic'
): Promise<string> {
  try {
    if (platform === 'instagram') {
      const author = extractInstagramAuthor(container);
      const captionContainer = findInstagramCaptionContainer(container, author);
      if (captionContainer) {
        await expandPost(container, 'instagram');
        return extractCleanCaptionText(captionContainer, author);
      }
      return cleanPostText((container.innerText || container.textContent || '').trim());
    }

    await expandPost(container, platform);

    let targetEl: Element | null = null;
    if (platform === 'youtube') {
      targetEl =
        container.querySelector('#content-text, yt-formatted-string#content-text, #description') ||
        container;
    } else {
      targetEl = container;
    }

    const rawText = ((targetEl as HTMLElement)?.innerText || targetEl?.textContent || container.textContent || '').trim();
    return cleanPostText(rawText);
  } catch (error) {
    console.warn('[Detectium] 본문 수집 중 오류 (원문 반환):', error);
    return cleanPostText((container.innerText || container.textContent || '').trim());
  }
}

export default () => {
  const [isEnabled, setIsEnabled] = createSignal<boolean>(true);
  const [currentUrl, setCurrentUrl] = createSignal<string>("");
  const [loading, setLoading] = createSignal<boolean>(true);
  const [scannedPosts, setScannedPosts] = createSignal<ScannedPostItem[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal<number>(0);
  const [copyFeedback, setCopyFeedback] = createSignal<boolean>(false);
  const [isScanning, setIsScanning] = createSignal<boolean>(false);
  const [statusNotice, setStatusNotice] = createSignal<string>("");

  // 현재 선택된 게시글
  const currentPost = createMemo(() => {
    const list = scannedPosts();
    const idx = selectedIndex();
    if (list.length === 0) return null;
    return list[idx] || list[0] || null;
  });

  onMount(() => {
    // 1. 활성화 상태 로드
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.sync.get(["isEnabled"], (res) => {
        setIsEnabled(typeof res.isEnabled === "boolean" ? res.isEnabled : true);
        setLoading(false);
      });

      // 2. 수집된 게시글 목록 로드
      chrome.storage.local.get(['scannedPosts'], (res) => {
        if (Array.isArray(res.scannedPosts)) {
          setScannedPosts(res.scannedPosts);
        }
      });

      // 3. 실시간 스토리지 변경 감지
      const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
        if (area === 'local' && changes.scannedPosts) {
          const newPosts = changes.scannedPosts.newValue;
          if (Array.isArray(newPosts)) {
            setScannedPosts(newPosts);
          }
        }
      };
      chrome.storage.onChanged.addListener(handleStorageChange);

      onCleanup(() => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      });
    } else {
      setLoading(false);
    }

    // 현재 탭 URL 조회
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          try {
            const parsed = new URL(tabs[0].url);
            setCurrentUrl(parsed.hostname);
          } catch {
            setCurrentUrl(tabs[0].url);
          }
        }
      });
    }
  });

  const toggleEnabled = () => {
    const nextState = !isEnabled();
    setIsEnabled(nextState);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.set({ isEnabled: nextState });
    }
  };

  const openOptionsPage = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    } else {
      window.open("/options.html", "_blank");
    }
  };

  // 원문 복사 기능
  const handleCopyCaption = async () => {
    const post = currentPost();
    if (!post?.content) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(post.content);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = post.content;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
    }
  };

  // 현재 화면 수동 스캔 트리거
  const handleTriggerScan = () => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    setIsScanning(true);
    setStatusNotice('현재 화면 가시 게시글 및 캡션 더보기 탐색 중...');
    console.info('[Detectium][POPUP] 스캔 버튼 클릭', {
      clickedAt: new Date().toISOString(),
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const queryError = chrome.runtime.lastError;
      if (queryError) {
        console.error('[Detectium][POPUP] 활성 탭 조회 실패:', queryError.message);
        setIsScanning(false);
        setStatusNotice(`⚠️ 활성 탭 조회 실패: ${queryError.message || '알 수 없는 오류'}`);
        return;
      }

      const activeTab = tabs[0];
      const activeTabId = activeTab?.id;
      console.info('[Detectium][POPUP] 활성 탭 조회 결과', {
        tabId: activeTabId,
        url: activeTab?.url,
      });
      if (activeTabId === undefined) {
        console.error('[Detectium][POPUP] 활성 탭을 찾을 수 없습니다.');
        setIsScanning(false);
        setStatusNotice('활성 탭을 찾을 수 없습니다.');
        return;
      }

      const sendScanRequest = async () => {
        console.info('[Detectium][MESSAGE] 메시지 전송', {
          type: 'PING',
          tabId: activeTabId,
          url: activeTab?.url,
          sentAt: new Date().toISOString(),
        });
        const ping = await sendTabMessageWithTimeout(activeTabId, { type: 'PING' });
        if (ping.error || ping.response?.status !== 'PONG') {
          const error = ping.error || `예상하지 못한 응답: ${JSON.stringify(ping.response)}`;
          console.error('[Detectium][MESSAGE] Content Script PING 실패:', {
            tabId: activeTabId,
            url: activeTab?.url,
            error,
          });
          setIsScanning(false);
          setStatusNotice(`⚠️ Content Script 미연결: ${error}`);
          return;
        }

        console.info('[Detectium][MESSAGE] PING 응답 수신', ping.response);
        console.info('[Detectium][MESSAGE] 메시지 전송', {
          type: 'TRIGGER_SCAN',
          tabId: activeTabId,
          url: activeTab?.url,
          sentAt: new Date().toISOString(),
        });
        const scan = await sendTabMessageWithTimeout(activeTabId, { type: 'TRIGGER_SCAN' });
        setIsScanning(false);
        if (scan.error) {
          console.error('[Detectium][MESSAGE] 스캔 메시지 전송 실패:', {
            tabId: activeTabId,
            url: activeTab?.url,
            error: scan.error,
          });
          setStatusNotice(`⚠️ 스캔 요청 실패: ${scan.error}`);
          return;
        }
        console.info('[Detectium][MESSAGE] 응답 수신', {
          tabId: activeTabId,
          response: scan.response,
          receivedAt: new Date().toISOString(),
        });
        if (scan.response?.success === false) {
          setStatusNotice(`⚠️ 스캔 실패: ${scan.response.error || '자세한 내용은 페이지 콘솔을 확인하세요.'}`);
          return;
        }
        setStatusNotice('✓ 스캔 요청이 Content Script에 전달되었습니다.');
        setTimeout(() => setStatusNotice(''), 3000);
      };

      void sendScanRequest().catch((error: unknown) => {
        console.error('[Detectium][MESSAGE] 스캔 메시지 처리 오류:', error);
        setIsScanning(false);
        setStatusNotice('⚠️ 메시지 처리 중 오류가 발생했습니다. 팝업 콘솔을 확인하세요.');
      });
    });
  };

  // 목록 전체 비우기
  const handleClearHistory = () => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ scannedPosts: [] }, () => {
        setScannedPosts([]);
        setSelectedIndex(0);
      });
    }
  };

  return (
    <Show
      when={!loading()}
      fallback={<div class="popup-container loading">로딩 중...</div>}
    >
      <div class="popup-container">
        <header class="popup-header">
          <div class="logo-area">
            <span class="logo-icon">🔍</span>
            <span class="logo-title">Detectium</span>
          </div>
          <span class={`status-pill ${isEnabled() ? 'active' : 'inactive'}`}>
            {isEnabled() ? '작동 중' : '비활성'}
          </span>
        </header>

        <main class="popup-body">
          <div class="site-info">
            <span class="info-label">현재 사이트</span>
            <span class="site-host" title={currentUrl()}>
              {currentUrl() || '로컬 환경'}
            </span>
          </div>

          <button
            class={`toggle-btn ${isEnabled() ? 'active' : 'inactive'}`}
            onClick={toggleEnabled}
          >
            {isEnabled() ? '탐지 기능 끄기' : '탐지 기능 켜기'}
          </button>
        </main>

         {/* ================================================================= */}
        {/* 5. 수집한 텍스트 확인 섹션 (요구사항 5)                           */}
        {/* ================================================================= */}
        <section class="scanned-section">
          {/* 상태 안내 알림 */}
          <Show when={statusNotice()}>
            <div class="status-notice-banner">
              {statusNotice()}
            </div>
          </Show>

          <div class="section-header">
            <div class="section-title-wrap">
              <span class="section-title">수집된 게시글</span>
              <span class="posts-count-badge">{scannedPosts().length}개</span>
            </div>
            <div class="section-actions">
              <button
                class="icon-btn"
                onClick={handleTriggerScan}
                disabled={isScanning()}
                title="현재 화면 즉시 스캔"
              >
                {isScanning() ? '⏳' : '🔄'}
              </button>
              <Show when={scannedPosts().length > 0}>
                <button
                  class="icon-btn text-btn"
                  onClick={handleClearHistory}
                  title="기록 지우기"
                >
                  비우기
                </button>
              </Show>
            </div>
          </div>

          {/* 게시글이 없는 경우 */}
          <Show when={scannedPosts().length === 0}>
            <div class="empty-state">
              <p class="empty-text">현재 수집된 게시글이 없습니다.</p>
              <p class="empty-subtext">인스타그램 피드를 스크롤하거나 우측 상단 🔄 버튼을 눌러보세요.</p>
            </div>
          </Show>

          {/* 게시글이 있는 경우 */}
          <Show when={scannedPosts().length > 0}>
            {/* 복수 게시글 탭 셀렉터 */}
            <Show when={scannedPosts().length > 1}>
              <div class="post-tabs-scroll">
                <For each={scannedPosts()}>
                  {(post, idx) => (
                    <button
                      class={`post-tab-btn ${selectedIndex() === idx() ? 'active' : ''}`}
                      onClick={() => setSelectedIndex(idx())}
                    >
                      <span class="tab-index">#{idx() + 1}</span>
                      <span class="tab-author">@{post.author || '익명'}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            {/* 선택된 게시글 상세 정보 */}
            <Show when={currentPost()}>
              {(post) => (
                <div class="post-detail-card">
                  {/* 메타데이터 요약 */}
                  <div class="post-meta-grid">
                    <div class="meta-item">
                      <span class="meta-label">작성자</span>
                      <span class="meta-value author-name" title={post().author}>
                        @{post().author || '미확인'}
                      </span>
                    </div>

                    <div class="meta-item">
                      <span class="meta-label">캡션 글자 수</span>
                      <span class="meta-value text-length">
                        {post().contentLength.toLocaleString()}자
                      </span>
                    </div>

                    <div class="meta-item full-row">
                      <span class="meta-label">게시글 URL</span>
                      <Show
                        when={post().url}
                        fallback={<span class="meta-value text-muted">URL 없음</span>}
                      >
                        <a
                          class="meta-value post-url-link"
                          href={post().url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={post().url}
                        >
                          {post().url}
                        </a>
                      </Show>
                    </div>

                    <div class="meta-item">
                      <span class="meta-label">추출 결과</span>
                      <span
                        class={`status-badge ${
                          post().extractionSuccess ? 'badge-success' : 'badge-danger'
                        }`}
                      >
                        {post().extractionSuccess ? '✓ 추출 성공' : '✕ 추출 실패'}
                      </span>
                    </div>

                    <div class="meta-item">
                      <span class="meta-label">팩트체크 전달 상태</span>
                      <span class={`status-badge badge-${post().status}`}>
                        {post().status === 'extracted' && '대기 중 (추출 완료)'}
                        {post().status === 'api_sent' && 'API 전달 완료 (분석 중)'}
                        {post().status === 'analyzed' && '분석 완료'}
                        {post().status === 'analysis_failed' && '분석 실패'}
                        {post().status === 'extraction_failed' && '추출 실패'}
                      </span>
                    </div>
                  </div>

                  {/* 미디어/카드뉴스 설명이 있는 경우 */}
                  <Show when={post().mediaDescription}>
                    <div class="media-description-box">
                      <span class="box-label">🖼️ 카드뉴스/이미지 설명</span>
                      <p class="media-text">{post().mediaDescription}</p>
                    </div>
                  </Show>

                  {/* 추출된 캡션 원문 영역 */}
                  <div class="caption-content-box">
                    <div class="caption-header">
                      <span class="box-label">
                        📝 추출된 캡션 원문 ({post().contentLength}자)
                      </span>
                      <button
                        class={`copy-btn ${copyFeedback() ? 'copied' : ''}`}
                        onClick={handleCopyCaption}
                        title="캡션 전체 복사"
                      >
                        {copyFeedback() ? '✓ 복사됨' : '📋 원문 복사'}
                      </button>
                    </div>

                    <div class="caption-scroll-area">
                      <Show
                        when={post().content}
                        fallback={<span class="empty-caption">(추출된 본문 텍스트가 없습니다)</span>}
                      >
                        <pre class="caption-pre-text">{post().content}</pre>
                      </Show>
                    </div>
                  </div>

                  {/* 팩트체크 분석 결과 요약 (분석 완료 시) */}
                  <Show when={post().analysisResult}>
                    {(result) => (
                      <div
                        class={`analysis-result-box ${
                          result().isFakeOrMisleading ? 'result-warning' : 'result-safe'
                        }`}
                      >
                        <div class="result-header">
                          <span class="result-category">
                            {result().isFakeOrMisleading ? '⚠️ ' : '✅ '}
                            {result().category}
                          </span>
                          <span class="risk-score">위험도 {result().riskScore}점</span>
                        </div>
                        <p class="result-summary">{result().summary}</p>
                        <Show when={result().details}>
                          <p class="result-details">{result().details}</p>
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </Show>
        </section>

        {/* 하단 푸터 */}

        <footer class="popup-footer">
          <button class="link-button" onClick={openOptionsPage}>
            ⚙️ 상세 설정 열기
          </button>
        </footer>
      </div>
    </Show>
  );
};
