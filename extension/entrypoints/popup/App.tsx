import React, { useEffect, useState } from 'react';

export default function App() {
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // 스토리지 상태 로드
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get(['isEnabled'], (res) => {
        setIsEnabled(res.isEnabled ?? true);
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
  }, []);

  const toggleEnabled = () => {
    const nextState = !isEnabled;
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

  if (loading) {
    return <div className="popup-container loading">로딩 중...</div>;
  }

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="logo-area">
          <span className="logo-icon">🔍</span>
          <span className="logo-title">Detectium</span>
        </div>
        <span className={`status-pill ${isEnabled ? 'active' : 'inactive'}`}>
          {isEnabled ? '작동 중' : '비활성'}
        </span>
      </header>

      <main className="popup-body">
        <div className="site-info">
          <span className="info-label">현재 사이트</span>
          <span className="site-host" title={currentUrl}>
            {currentUrl || '로컬 환경'}
          </span>
        </div>

        <button
          className={`toggle-btn ${isEnabled ? 'active' : 'inactive'}`}
          onClick={toggleEnabled}
        >
          {isEnabled ? '탐지 기능 끄기' : '탐지 기능 켜기'}
        </button>
      </main>

      <footer className="popup-footer">
        <button className="link-button" onClick={openOptionsPage}>
          ⚙️ 상세 설정 열기
        </button>
      </footer>
    </div>
  );
}
