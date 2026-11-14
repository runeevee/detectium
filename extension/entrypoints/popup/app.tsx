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
          } else if (hostname === "threads.net" || hostname.endsWith(".threads.net")) {
            setCurrentPlatform("Threads");
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
                <Match when={currentPlatform() === "Threads"}>
                  <svg class={css.platformLogo} viewBox="0 0 192 192" aria-label="Threads 로고" fill="currentColor">
                    <path d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.537 60.5382 122.616 44.905 97.5619 44.745C97.4484 44.7443 97.3355 44.7443 97.222 44.7443C82.2364 44.7443 69.7731 51.1409 62.102 62.7807L75.381 72.0625C80.706 63.9772 89.288 59.9015 97.222 59.9015C110.137 59.9015 120.73 68.3241 122.399 84.7797C114.777 83.7431 106.634 83.4727 98.2435 84.0044C65.5597 86.0739 46.8503 103.078 47.3683 126.837C47.8927 150.849 68.2043 165.748 94.7554 165.748C110.364 165.748 123.473 159.27 132.844 147.016C138.834 158.461 149.324 165.748 163.664 165.748C176.49 165.748 185.395 159.167 190.154 148.887L175.767 141.164C173.208 146.46 168.497 149.748 163.664 149.748C154.586 149.748 147.666 142.164 146.993 127.351C154.498 120.373 158.749 110.428 159.135 99.7891C159.489 89.9675 156.402 80.8906 150.771 73.8055C141.442 62.0673 126.064 55.4375 106.377 55.4375C78.4723 55.4375 56.4253 66.8617 44.5779 87.525C33.7226 106.459 31.8105 130.648 39.2273 152.029C44.7573 167.972 54.9084 180.957 68.5134 189.516C82.1184 198.074 98.2435 201.656 114.975 199.824C128.618 198.33 140.669 193.125 150.771 184.281L140.549 172.93C132.484 180.008 122.848 184.172 111.91 185.367C98.5354 186.832 85.6354 183.965 74.7513 177.121C63.8673 170.277 55.7468 159.891 51.3228 147.137C45.3894 130.031 46.919 110.684 55.6025 95.5391C65.0815 79.0117 82.7203 69.8711 105.074 69.8711C120.804 69.8711 133.098 75.168 140.549 84.5508C145.029 90.1914 147.488 97.4336 147.206 105.297C146.902 113.809 143.518 121.766 137.674 127.246C137.491 123.633 137.045 119.539 136.335 114.965C134.619 103.883 129.563 94.6289 122.046 88.8945C114.529 83.1602 105.094 80.125 95.4214 80.332C84.4564 80.5664 74.8324 84.7734 68.2713 92.1797C61.7103 99.5859 58.6233 109.68 59.5843 120.613C60.5453 131.547 65.4943 140.75 73.4913 146.543C81.4884 152.336 91.9544 154.512 102.949 152.684C114.929 150.688 124.675 142.945 129.563 131.18C132.304 139.117 136.192 145.898 141.537 88.9883ZM100.865 137.898C93.4334 139.141 86.3264 137.664 80.8243 133.742C75.3223 129.82 71.9103 123.598 71.2503 116.207C70.5903 108.816 72.7303 101.996 77.2913 96.9844C81.8523 91.9727 88.5134 89.1211 96.0644 88.9609C102.664 88.8203 109.116 90.8711 114.238 94.7461C119.36 98.6211 122.812 104.094 123.978 111.609C124.786 116.805 125.131 122.094 125.013 127.469C118.84 133.43 110.428 136.297 100.865 137.898Z" />
                  </svg>
                </Match>
                <Match when={currentPlatform() !== "Instagram" && currentPlatform() !== "X" && currentPlatform() !== "Threads"}>
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
