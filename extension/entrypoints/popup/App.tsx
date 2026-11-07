import { createSignal, onMount, Show } from "solid-js";

export default () => {
  const [isEnabled, setIsEnabled] = createSignal<boolean>(true);
  const [currentUrl, setCurrentUrl] = createSignal<string>('');
  const [loading, setLoading] = createSignal<boolean>(true);

  onMount(() => {
    // 스토리지 상태 로드
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get(['isEnabled'], (res) => {
        setIsEnabled(typeof res.isEnabled === 'boolean' ? res.isEnabled : true);
        setLoading(false);
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
    } else {
      window.open('/options.html', '_blank');
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

        <footer class="popup-footer">
          <button class="link-button" onClick={openOptionsPage}>
            ⚙️ 상세 설정 열기
          </button>
        </footer>
      </div>
    </Show>
  );
};
