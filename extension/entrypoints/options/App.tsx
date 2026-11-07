import { createSignal, onMount, Show } from "solid-js";

interface Settings {
  [key: string]: unknown;
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

export default () => {
  const [isEnabled, setIsEnabled] = createSignal<boolean>(DEFAULT_SETTINGS.isEnabled);
  const [apiKey, setApiKey] = createSignal<string>(DEFAULT_SETTINGS.apiKey);
  const [detectionThreshold, setDetectionThreshold] = createSignal<number>(DEFAULT_SETTINGS.detectionThreshold);
  const [highlightColor, setHighlightColor] = createSignal<string>(DEFAULT_SETTINGS.highlightColor);
  const [statusMessage, setStatusMessage] = createSignal<string>('');
  const [loading, setLoading] = createSignal<boolean>(true);

  onMount(() => {
    // 확장 프로그램 스토리지에서 설정 불러오기
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        const loaded = items as unknown as Settings;
        setIsEnabled(typeof loaded.isEnabled === 'boolean' ? loaded.isEnabled : DEFAULT_SETTINGS.isEnabled);
        setApiKey(typeof loaded.apiKey === 'string' ? loaded.apiKey : DEFAULT_SETTINGS.apiKey);
        setDetectionThreshold(typeof loaded.detectionThreshold === 'number' ? loaded.detectionThreshold : DEFAULT_SETTINGS.detectionThreshold);
        setHighlightColor(typeof loaded.highlightColor === 'string' ? loaded.highlightColor : DEFAULT_SETTINGS.highlightColor);
        setLoading(false);
      });
    } else {
      // 로컬 개발 환경 대응
      const saved = localStorage.getItem('detectium_settings');
      if (saved) {
        const loaded = JSON.parse(saved) as Settings;
        setIsEnabled(loaded.isEnabled);
        setApiKey(loaded.apiKey);
        setDetectionThreshold(loaded.detectionThreshold);
        setHighlightColor(loaded.highlightColor);
      }
      setLoading(false);
    }
  });

  const handleSave = (e: Event) => {
    e.preventDefault();
    const newSettings: Settings = {
      isEnabled: isEnabled(),
      apiKey: apiKey(),
      detectionThreshold: detectionThreshold(),
      highlightColor: highlightColor(),
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.set(newSettings, () => {
        setStatusMessage('설정이 성공적으로 저장되었습니다.');
        setTimeout(() => setStatusMessage(''), 3000);
      });
    } else {
      localStorage.setItem('detectium_settings', JSON.stringify(newSettings));
      setStatusMessage('설정이 로컬에 저장되었습니다. (개발 모드)');
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  return (
    <Show
      when={!loading()}
      fallback={<div class="loading-container">설정을 불러오는 중...</div>}
    >
      <div class="options-container">
        <header class="options-header">
          <h1>Detectium 설정 (SolidJS)</h1>
          <p class="subtitle">크롬 확장 프로그램의 동작 옵션을 구성하세요.</p>
        </header>

        <form onSubmit={handleSave} class="settings-form">
          <section class="form-group">
            <label class="switch-label">
              <span class="label-text">확장 프로그램 활성화</span>
              <input
                type="checkbox"
                checked={isEnabled()}
                onChange={(e) => setIsEnabled(e.currentTarget.checked)}
              />
            </label>
          </section>

          <section class="form-group">
            <label for="apiKey" class="label-text">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              class="input-text"
              placeholder="API 키를 입력하세요"
              value={apiKey()}
              onInput={(e) => setApiKey(e.currentTarget.value)}
            />
          </section>

          <section class="form-group">
            <label for="threshold" class="label-text">
              감지 임계값 ({detectionThreshold()}%)
            </label>
            <input
              id="threshold"
              type="range"
              min="0"
              max="100"
              class="input-range"
              value={detectionThreshold()}
              onInput={(e) => setDetectionThreshold(Number(e.currentTarget.value))}
            />
          </section>

          <section class="form-group">
            <label for="color" class="label-text">
              강조 표시 색상
            </label>
            <div class="color-picker-wrapper">
              <input
                id="color"
                type="color"
                class="input-color"
                value={highlightColor()}
                onInput={(e) => setHighlightColor(e.currentTarget.value)}
              />
              <span class="color-code">{highlightColor()}</span>
            </div>
          </section>

          <div class="actions">
            <button type="submit" class="btn-primary">
              저장하기
            </button>
            <Show when={statusMessage()}>
              <span class="status-badge">{statusMessage()}</span>
            </Show>
          </div>
        </form>
      </div>
    </Show>
  );
};
