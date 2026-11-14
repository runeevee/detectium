import { createSignal, onMount, Switch, Match, For, Show } from "solid-js";
import type { ScannedPostItem } from "../../utils/types";
import css from "./popup.module.css";

function getSourceTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export default () => {
  const [isEnabled, setIsEnabled] = createSignal<boolean>(true);
  const [loading, setLoading] = createSignal<boolean>(true);
  const [currentPlatform, setCurrentPlatform] = createSignal("확인 중...");
  const [cacheStatus, setCacheStatus] = createSignal<string>("");
  const [cachedPostCount, setCachedPostCount] = createSignal(0);
  const [warningPosts, setWarningPosts] = createSignal<ScannedPostItem[]>([]);
  const [showWarningHistory, setShowWarningHistory] = createSignal(false);
  const [warningHistoryArrow, setWarningHistoryArrow] = createSignal("◀");

  onMount(() => {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          setCurrentPlatform("확인할 수 없음");
          return;
        }

        const tabUrl = tabs[0]?.url;
        if (!tabUrl) {
          setCurrentPlatform("지원되지 않는 페이지");
          return;
        }

        try {
          const hostname = new URL(tabUrl).hostname.toLowerCase();
          if (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) {
            setCurrentPlatform("Instagram");
          } else if (
            hostname === "x.com" ||
            hostname.endsWith(".x.com") ||
            hostname === "twitter.com" ||
            hostname.endsWith(".twitter.com")
          ) {
            setCurrentPlatform("X");
          } else if (hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be") {
            setCurrentPlatform("YouTube");
          } else if (hostname) {
            setCurrentPlatform("기타 웹사이트");
          } else {
            setCurrentPlatform("지원되지 않는 페이지");
          }
        } catch {
          setCurrentPlatform("지원되지 않는 페이지");
        }
      });
    } else {
      setCurrentPlatform("확인할 수 없음");
    }

    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      chrome.storage.sync.get(["isEnabled"], (res) => {
        if (typeof res.isEnabled === "boolean") {
          setIsEnabled(res.isEnabled);
        }
        setLoading(false);
      });
    } else {
      setLoading(false);
    }

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(["scannedPosts"], (res) => {
        if (chrome.runtime.lastError) {
          setCacheStatus("캐시 정보를 불러오지 못했습니다.");
          return;
        }

        const scannedPosts: ScannedPostItem[] = Array.isArray(res.scannedPosts) ? res.scannedPosts : [];
        setCachedPostCount(scannedPosts.length);
        setWarningPosts(
          scannedPosts
            .filter(
              (post) =>
                post.status === "analyzed" &&
                post.analysisResult?.isCredible === false
            )
            .sort((a, b) => b.timestamp - a.timestamp)
        );
      });
    }
  });

  // 활성화 / 비활성화 토글 핸들러
  const handleToggle = () => {
    const next = !isEnabled();
    setIsEnabled(next);
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      chrome.storage.sync.set({ isEnabled: next });
    }
  };

  const handleClearCache = () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setCacheStatus("브라우저 저장소를 사용할 수 없습니다.");
      return;
    }

    chrome.storage.local.remove(["scannedPosts"], () => {
      if (chrome.runtime.lastError) {
        setCacheStatus("캐시 삭제에 실패했습니다.");
        return;
      }

      setCacheStatus("캐시가 비워졌습니다.");
      setCachedPostCount(0);
      setWarningPosts([]);
      setShowWarningHistory(false);
      setWarningHistoryArrow("◀");
    });
  };

  const toggleWarningHistory = () => {
    if (showWarningHistory()) {
      setShowWarningHistory(false);
      setWarningHistoryArrow("◀");
    } else {
      setShowWarningHistory(true);
      setWarningHistoryArrow("▼");
    }
  };

  const handleOpenLink = (url: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
  };

  return (
    <Switch>
      <Match when={loading()}>
        <div class={css.popupBox}></div>
      </Match>
      <Match when={!loading()}>
        <div class={css.popupBox}>
          {/* 헤더 */}
          <header class={css.header}>
            <div class={css.brand}>
              <img class={css.brandIcon} src="/img/logo-48.png" alt="" aria-hidden="true" />
              <span class={css.brandTitle}>커트니</span>
            </div>
            <label class={css.switchContainer}>
              <input
                type="checkbox"
                class={css.switchInput}
                aria-label="커트니 활성화"
                checked={isEnabled()}
                onChange={handleToggle}
              />
              <span class={css.switchTrack}>
                <span class={css.switchThumb}></span>
              </span>
            </label>
          </header>

          <section class={css.platformSection}>
            <div class={css.platformValue}>
              <Switch>
                <Match when={currentPlatform() === "Instagram"}>
                  <svg class={css.platformLogo} viewBox="0 0 24 24" aria-label="Instagram 로고">
                    <defs>
                      <linearGradient id="instagram-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#feda75" />
                        <stop offset="50%" stop-color="#d62976" />
                        <stop offset="100%" stop-color="#4f5bd5" />
                      </linearGradient>
                    </defs>
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="5"
                      fill="none"
                      stroke="url(#instagram-gradient)"
                      stroke-width="2"
                    />
                    <circle cx="12" cy="12" r="4" fill="none" stroke="url(#instagram-gradient)" stroke-width="2" />
                    <circle cx="17.5" cy="6.8" r="1.2" fill="#d62976" />
                  </svg>
                </Match>
                <Match when={currentPlatform() === "X"}>
                  <svg class={css.platformLogo} viewBox="-0.25 0 24.5 24.5" aria-label="X 로고">
                    <path
                      fill="currentColor"
                      d="M18.901 1.153h3.68L14.54 10.281l9.598 13.066h-7.5l-5.879-7.693-6.731 7.693H.346l8.576-9.805L-.25 1.153h7.69l5.314 7.023zm-1.291 20.013h2.039L6.54 3.217H4.351z"
                    />
                  </svg>
                </Match>
                <Match when={currentPlatform() !== "Instagram" && currentPlatform() !== "X"}>
                  <span class={`mtrl-icon ${css.platformFallbackIcon}`}>language</span>
                </Match>
              </Switch>
              <span class={css.platformName}>{currentPlatform()}</span>
            </div>
          </section>

          <section class={css.section}>
            <div class={css.cacheSection}>
              <div class={css.cacheSummary}>
                <span class={css.cacheDescription}>{cachedPostCount()}개 게시글 캐시됨</span>
                <Switch>
                  <Match when={warningPosts().length > 0}>
                    <button
                      type="button"
                      class={css.warningHistoryToggle}
                      aria-label={showWarningHistory() ? "경고 내역 접기" : "경고 내역 보기"}
                      aria-expanded={showWarningHistory()}
                      title={showWarningHistory() ? "경고 내역 접기" : "경고 내역 보기"}
                      onClick={toggleWarningHistory}
                    >
                      {warningHistoryArrow()}
                    </button>
                  </Match>
                </Switch>
              </div>
              <Switch>
                <Match when={showWarningHistory()}>
                  <div class={css.warningHistory}>
                    <For each={warningPosts()}>
                      {(post) => {
                        const [showSourceLinks, setShowSourceLinks] = createSignal(false);
                        return (
                          <details class={css.warningItem}>
                            <summary class={css.warningSummary}>
                              {post.platform} · 신뢰성 의심
                            </summary>
                            <div class={css.warningDetails}>
                              <p>{post.content}</p>
                              <p>{post.analysisResult?.description}</p>
                              {post.analysisResult?.links && post.analysisResult.links.length > 0 && (
                                <>
                                  <button
                                    type="button"
                                    class={css.sourceToggleBtn}
                                    aria-expanded={showSourceLinks()}
                                    aria-label={showSourceLinks() ? "출처 확인하기, 접기" : "출처 확인하기, 펼치기"}
                                    onClick={() => setShowSourceLinks((visible) => !visible)}
                                  >
                                    <span class={css.sourceToggleIcon} aria-hidden="true">
                                      {showSourceLinks() ? "▼" : "▶"}
                                    </span>
                                    <span>출처 확인하기</span>
                                  </button>
                                  <Show when={showSourceLinks()}>
                                    <div class={css.warningLinks}>
                                      <span class={css.warningLinksTitle}>출처 링크</span>
                                      <ul class={css.warningLinksList}>
                                        <For each={post.analysisResult.links}>
                                          {(link) => (
                                            <li class={css.warningLinkItem}>
                                              <a
                                                href={link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class={css.sourceLink}
                                                onClick={(e) => handleOpenLink(link, e)}
                                              >
                                                {getSourceTitle(link)} ↗
                                              </a>
                                            </li>
                                          )}
                                        </For>
                                      </ul>
                                    </div>
                                  </Show>
                                </>
                              )}
                            </div>
                          </details>
                        );
                      }}
                    </For>
                  </div>
                </Match>
              </Switch>
              <button type="button" class={css.clearCacheBtn} onClick={handleClearCache}>
                캐시 비우기
              </button>
              <Switch>
                <Match when={Boolean(cacheStatus())}>
                  <span class={css.cacheStatus}>{cacheStatus()}</span>
                </Match>
              </Switch>
            </div>
          </section>
        </div>
      </Match>
    </Switch>
  );
};
