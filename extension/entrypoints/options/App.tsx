import React, { useEffect, useState } from 'react';

interface Settings {
  isEnabled: boolean;
  apiKey: string;
  detectionThreshold: number;
  highlightColor: string;
}

const DEFAULT_SETTINGS: Settings = {
  isEnabled: true,
  apiKey: '',
  detectionThreshold: 75,
  highlightColor: '#4f46e5',
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // 확장 프로그램 스토리지에서 기존 설정 불러오기
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        setSettings(items as Settings);
        setLoading(false);
      });
    } else {
      // 로컬 개발 환경(일반 브라우저 탭) 대응
      const saved = localStorage.getItem('detectium_settings');
      if (saved) {
        setSettings(JSON.parse(saved));
      }
      setLoading(false);
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.set(settings, () => {
        setStatusMessage('설정이 성공적으로 저장되었습니다.');
        setTimeout(() => setStatusMessage(''), 3000);
      });
    } else {
      localStorage.setItem('detectium_settings', JSON.stringify(settings));
      setStatusMessage('설정이 로컬에 저장되었습니다. (개발 모드)');
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  if (loading) {
    return <div className="loading-container">설정을 불러오는 중...</div>;
  }

  return (
    <div className="options-container">
      <header className="options-header">
        <h1>Detectium 설정</h1>
        <p className="subtitle">크롬 확장 프로그램의 동작 옵션을 구성하세요.</p>
      </header>

      <form onSubmit={handleSave} className="settings-form">
        <section className="form-group">
          <label className="switch-label">
            <span className="label-text">확장 프로그램 활성화</span>
            <input
              type="checkbox"
              checked={settings.isEnabled}
              onChange={(e) =>
                setSettings({ ...settings, isEnabled: e.target.checked })
              }
            />
          </label>
        </section>

        <section className="form-group">
          <label htmlFor="apiKey" className="label-text">
            API Key
          </label>
          <input
            id="apiKey"
            type="password"
            className="input-text"
            placeholder="API 키를 입력하세요"
            value={settings.apiKey}
            onChange={(e) =>
              setSettings({ ...settings, apiKey: e.target.value })
            }
          />
        </section>

        <section className="form-group">
          <label htmlFor="threshold" className="label-text">
            감지 임계값 ({settings.detectionThreshold}%)
          </label>
          <input
            id="threshold"
            type="range"
            min="0"
            max="100"
            className="input-range"
            value={settings.detectionThreshold}
            onChange={(e) =>
              setSettings({
                ...settings,
                detectionThreshold: Number(e.target.value),
              })
            }
          />
        </section>

        <section className="form-group">
          <label htmlFor="color" className="label-text">
            강조 표시 색상
          </label>
          <div className="color-picker-wrapper">
            <input
              id="color"
              type="color"
              className="input-color"
              value={settings.highlightColor}
              onChange={(e) =>
                setSettings({ ...settings, highlightColor: e.target.value })
              }
            />
            <span className="color-code">{settings.highlightColor}</span>
          </div>
        </section>

        <div className="actions">
          <button type="submit" className="btn-primary">
            저장하기
          </button>
          {statusMessage && <span className="status-badge">{statusMessage}</span>}
        </div>
      </form>
    </div>
  );
}
