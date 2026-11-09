import { createSignal, onMount, onCleanup, Show, For, createMemo } from "solid-js";
import type { ScannedPostItem } from "../../utils/types";

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

export default () => {
  const [isEnabled, setIsEnabled] = createSignal<boolean>(true);
  const [currentUrl, setCurrentUrl] = createSignal<string>("");
  const [loading, setLoading] = createSignal<boolean>(true);
  const [scannedPosts, setScannedPosts] = createSignal<ScannedPostItem[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal<number>(0);
  const [copyFeedback, setCopyFeedback] = createSignal<boolean>(false);
  const [isScanning, setIsScanning] = createSignal<boolean>(false);
  const [statusNotice, setStatusNotice] = createSignal<string>("");

  const currentPost = createMemo(() => {
    const list = scannedPosts();
    const idx = selectedIndex();
    if (list.length === 0) return null;
    return list[idx] || list[0] || null;
  });

  onMount(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.sync.get(["isEnabled"], (res) => {
        setIsEnabled(typeof res.isEnabled === "boolean" ? res.isEnabled : true);
        setLoading(false);
      });

      chrome.storage.local.get(["scannedPosts"], (res) => {
        if (Array.isArray(res.scannedPosts)) {
          setScannedPosts(res.scannedPosts);
        }
      });

      const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
        if (area === "local" && changes.scannedPosts) {
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

    if (typeof chrome !== "undefined" && chrome.tabs) {
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
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.sync.set({ isEnabled: nextState });
    }
  };

  const openOptionsPage = () => {
    if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
    } else {
      window.open("/options.html", "_blank");
    }
  };

  const handleCopyCaption = async () => {
    const post = currentPost();
    if (!post?.content) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(post.content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = post.content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      console.error("[Detectium] 클립보드 복사 실패:", err);
    }
  };

  const handleTriggerScan = () => {
    if (typeof chrome === "undefined" || !chrome.tabs) return;

    setIsScanning(true);
    setStatusNotice("현재 화면 가시 게시글 탐색 중...");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const queryError = chrome.runtime.lastError;
      if (queryError) {
        console.error("[Detectium] 활성 탭 조회 실패:", queryError.message);
        setIsScanning(false);
        setStatusNotice(`⚠️ 활성 탭 조회 실패: ${queryError.message || "알 수 없는 오류"}`);
        return;
      }

      const activeTab = tabs[0];
      const activeTabId = activeTab?.id;
      if (activeTabId === undefined) {
        setIsScanning(false);
        setStatusNotice("활성 탭을 찾을 수 없습니다.");
        return;
      }

      const sendScanRequest = async () => {
        const ping = await sendTabMessageWithTimeout(activeTabId, { type: "PING" });
        if (ping.error || ping.response?.status !== "PONG") {
          const error = ping.error || "Content Script에 연결할 수 없습니다.";
          setIsScanning(false);
          setStatusNotice(`⚠️ Content Script 미연결: ${error}`);
          return;
        }

        const scan = await sendTabMessageWithTimeout(activeTabId, { type: "TRIGGER_SCAN" });
        setIsScanning(false);
        if (scan.error) {
          setStatusNotice(`⚠️ 스캔 요청 실패: ${scan.error}`);
          return;
        }
        if (scan.response?.success === false) {
          setStatusNotice(`⚠️ 스캔 실패: ${scan.response.error || "자세한 내용은 페이지 콘솔을 확인하세요."}`);
          return;
        }
        setStatusNotice("✓ 스캔 요청이 전달되었습니다.");
        setTimeout(() => setStatusNotice(""), 3000);
      };

      void sendScanRequest().catch((error: unknown) => {
        console.error("[Detectium] 스캔 메시지 처리 오류:", error);
        setIsScanning(false);
        setStatusNotice("⚠️ 메시지 처리 중 오류가 발생했습니다.");
      });
    });
  };

  const handleClearHistory = () => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
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
          <span class={`status-pill ${isEnabled() ? "active" : "inactive"}`}>
            {isEnabled() ? "작동 중" : "비활성"}
          </span>
        </header>

        <main class="popup-body">
          <div class="site-info">
            <span class="info-label">현재 사이트</span>
            <span class="site-host" title={currentUrl()}>
              {currentUrl() || "로컬 환경"}
            </span>
          </div>

          <button
            class={`toggle-btn ${isEnabled() ? "active" : "inactive"}`}
            onClick={toggleEnabled}
          >
            {isEnabled() ? "탐지 기능 끄기" : "탐지 기능 켜기"}
          </button>
        </main>

        <section class="scanned-section">
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
                {isScanning() ? "⏳" : "🔄"}
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

          <Show when={scannedPosts().length === 0}>
            <div class="empty-state">
              <p class="empty-text">현재 수집된 게시글이 없습니다.</p>
              <p class="empty-subtext">피드를 스크롤하거나 우측 상단 🔄 버튼을 눌러보세요.</p>
            </div>
          </Show>

          <Show when={scannedPosts().length > 0}>
            <Show when={scannedPosts().length > 1}>
              <div class="post-tabs-scroll">
                <For each={scannedPosts()}>
                  {(post, idx) => (
                    <button
                      class={`post-tab-btn ${selectedIndex() === idx() ? "active" : ""}`}
                      onClick={() => setSelectedIndex(idx())}
                    >
                      <span class="tab-index">#{idx() + 1}</span>
                      <span class="tab-author">@{post.author || "익명"}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={currentPost()}>
              {(post) => (
                <div class="post-detail-card">
                  <div class="post-meta-grid">
                    <div class="meta-item">
                      <span class="meta-label">작성자</span>
                      <span class="meta-value author-name" title={post().author}>
                        @{post().author || "미확인"}
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
                          post().extractionSuccess ? "badge-success" : "badge-danger"
                        }`}
                      >
                        {post().extractionSuccess ? "✓ 추출 성공" : "✕ 추출 실패"}
                      </span>
                    </div>

                    <div class="meta-item">
                      <span class="meta-label">상태</span>
                      <span class={`status-badge badge-${post().status}`}>
                        {post().status === "extracted" && "대기 중 (추출 완료)"}
                        {post().status === "api_sent" && "분석 요청 중"}
                        {post().status === "analyzed" && "분석 완료"}
                        {post().status === "analysis_failed" && "분석 실패"}
                        {post().status === "extraction_failed" && "추출 실패"}
                      </span>
                    </div>
                  </div>

                  <Show when={post().mediaDescription}>
                    <div class="media-description-box">
                      <span class="box-label">🖼️ 카드뉴스/이미지 설명</span>
                      <p class="media-text">{post().mediaDescription}</p>
                    </div>
                  </Show>

                  <div class="caption-content-box">
                    <div class="caption-header">
                      <span class="box-label">
                        📝 추출된 캡션 원문 ({post().contentLength}자)
                      </span>
                      <button
                        class={`copy-btn ${copyFeedback() ? "copied" : ""}`}
                        onClick={handleCopyCaption}
                        title="캡션 전체 복사"
                      >
                        {copyFeedback() ? "✓ 복사됨" : "📋 원문 복사"}
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

                  <Show when={post().analysisResult}>
                    {(result) => (
                      <div
                        class={`analysis-result-box ${
                          result().isFakeOrMisleading ? "result-warning" : "result-safe"
                        }`}
                      >
                        <div class="result-header">
                          <span class="result-category">
                            {result().isFakeOrMisleading ? "⚠️ " : "✅ "}
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

        <footer class="popup-footer">
          <button class="link-button" onClick={openOptionsPage}>
            ⚙️ 상세 설정 열기
          </button>
        </footer>
      </div>
    </Show>
  );
};
