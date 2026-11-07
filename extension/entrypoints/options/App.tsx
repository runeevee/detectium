import { createSignal, onMount, Show, For } from "solid-js";

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

const COLOR_PRESETS = [
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Violet', value: '#7c3aed' },
  { name: 'Emerald', value: '#059669' },
  { name: 'Sky', value: '#0284c7' },
  { name: 'Rose', value: '#e11d48' },
  { name: 'Amber', value: '#d97706' },
];

export default () => {
  const [isEnabled, setIsEnabled] = createSignal<boolean>(DEFAULT_SETTINGS.isEnabled);
  const [apiKey, setApiKey] = createSignal<string>(DEFAULT_SETTINGS.apiKey);
  const [detectionThreshold, setDetectionThreshold] = createSignal<number>(DEFAULT_SETTINGS.detectionThreshold);
  const [highlightColor, setHighlightColor] = createSignal<string>(DEFAULT_SETTINGS.highlightColor);
  const [showApiKey, setShowApiKey] = createSignal<boolean>(false);
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
        setStatusMessage('모든 설정이 안전하게 저장되었습니다.');
        setTimeout(() => setStatusMessage(''), 3000);
      });
    } else {
      localStorage.setItem('detectium_settings', JSON.stringify(newSettings));
      setStatusMessage('설정이 로컬 스토리지에 저장되었습니다. (개발 환경)');
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  const getThresholdLabel = (val: number) => {
    if (val < 40) return '낮은 감도 (정밀 감지, 오탐 최소화)';
    if (val < 70) return '표준 감도 (균형 잡힌 분석)';
    if (val < 90) return '권장 감도 (적극적인 탐지)';
    return '최대 감도 (의심 항목 전체 알림)';
  };

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="loading-screen">
          <div class="spinner"></div>
          <p>Detectium 설정을 불러오는 중입니다...</p>
        </div>
      }
    >
      <div class="fullpage-layout">
        {/* 상단 글로벌 헤더 */}
        <header class="navbar">
          <div class="navbar-content">
            <div class="brand">
              <div class="brand-icon">🔍</div>
              <div>
                <h1 class="brand-title">Detectium</h1>
                <span class="brand-subtitle">확장 프로그램 환경설정</span>
              </div>
            </div>
            <div class="navbar-status">
              <span class={`status-chip ${isEnabled() ? 'active' : 'inactive'}`}>
                <span class="status-dot"></span>
                {isEnabled() ? '시스템 활성화됨' : '시스템 비활성'}
              </span>
            </div>
          </div>
        </header>

        {/* 메인 설정 컨테이너 */}
        <main class="page-body">
          <div class="page-container">
            <div class="page-header">
              <h2>전체 설정</h2>
              <p>웹 콘텐츠 자동 분석, 탐지 민감도 및 알림 UI 환경을 맞춤 설정합니다.</p>
            </div>

            <form onSubmit={handleSave} class="settings-form">
              {/* 섹션 1: 활성화 상태 */}
              <section class="settings-card">
                <div class="card-header">
                  <div>
                    <h3 class="card-title">기본 동작 설정</h3>
                    <p class="card-desc">웹 브라우징 중 실시간 탐지 및 컨텍스트 메뉴 동작 여부를 지정합니다.</p>
                  </div>
                </div>
                <div class="card-body">
                  <label class="switch-row">
                    <div class="switch-info">
                      <span class="switch-title">Detectium 실시간 모니터링 활성화</span>
                      <span class="switch-help">비활성화 시 모든 페이지에서의 자동 알림 및 탐지 작업이 일시 중지됩니다.</span>
                    </div>
                    <div class="toggle-control">
                      <input
                        type="checkbox"
                        id="toggle-enable"
                        class="toggle-checkbox"
                        checked={isEnabled()}
                        onChange={(e) => setIsEnabled(e.currentTarget.checked)}
                      />
                      <label for="toggle-enable" class="toggle-slider"></label>
                    </div>
                  </label>
                </div>
              </section>

              {/* 섹션 2: API 인증 */}
              <section class="settings-card">
                <div class="card-header">
                  <div>
                    <h3 class="card-title">인증 및 API 키</h3>
                    <p class="card-desc">통계 왜곡 및 가짜뉴스 판별에 사용될 OpenAI API 키를 설정합니다.</p>
                  </div>
                </div>
                <div class="card-body">
                  <div class="form-field">
                    <label for="apiKey" class="field-label">OpenAI API Key</label>
                    <div class="input-with-button">
                      <input
                        id="apiKey"
                        type={showApiKey() ? 'text' : 'password'}
                        class="text-input"
                        placeholder="sk-proj-..."
                        value={apiKey()}
                        onInput={(e) => setApiKey(e.currentTarget.value)}
                      />
                      <button
                        type="button"
                        class="btn-ghost"
                        onClick={() => setShowApiKey(!showApiKey())}
                      >
                        {showApiKey() ? '숨기기' : '보기'}
                      </button>
                    </div>
                    <span class="field-help">개인 OpenAI API 키를 입력하지 않을 경우 시스템 기본 환경변수 키가 사용됩니다. (chrome.storage.sync에 안전하게 보관)</span>
                  </div>
                </div>
              </section>

              {/* 섹션 3: 감도 설정 */}
              <section class="settings-card">
                <div class="card-header">
                  <div>
                    <h3 class="card-title">탐지 임계값 및 감도</h3>
                    <p class="card-desc">알림을 트리거할 신뢰도 최소 임계치를 조정합니다.</p>
                  </div>
                </div>
                <div class="card-body">
                  <div class="form-field">
                    <div class="slider-header">
                      <label for="threshold" class="field-label">탐지 신뢰도 임계값</label>
                      <span class="slider-value">{detectionThreshold()}%</span>
                    </div>
                    <input
                      id="threshold"
                      type="range"
                      min="10"
                      max="100"
                      step="5"
                      class="range-slider"
                      value={detectionThreshold()}
                      onInput={(e) => setDetectionThreshold(Number(e.currentTarget.value))}
                    />
                    <div class="slider-footer">
                      <span class="slider-subtext">{getThresholdLabel(detectionThreshold())}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* 섹션 4: UI 스타일 & 하이라이트 */}
              <section class="settings-card">
                <div class="card-header">
                  <div>
                    <h3 class="card-title">강조 표시 및 알림 테마</h3>
                    <p class="card-desc">웹페이지에서 탐지된 요소와 알림 배너에 적용될 강조 색상을 지정합니다.</p>
                  </div>
                </div>
                <div class="card-body">
                  <div class="form-field">
                    <label class="field-label">테마 색상 선택</label>
                    <div class="color-preset-grid">
                      <For each={COLOR_PRESETS}>
                        {(preset) => (
                          <button
                            type="button"
                            class={`preset-chip ${highlightColor() === preset.value ? 'selected' : ''}`}
                            onClick={() => setHighlightColor(preset.value)}
                          >
                            <span class="chip-color" style={{ background: preset.value }}></span>
                            <span class="chip-name">{preset.name}</span>
                          </button>
                        )}
                      </For>
                    </div>
                    <div class="custom-color-row">
                      <span class="custom-color-label">사용자 지정 색상:</span>
                      <div class="color-picker-box">
                        <input
                          id="color"
                          type="color"
                          class="native-color-picker"
                          value={highlightColor()}
                          onInput={(e) => setHighlightColor(e.currentTarget.value)}
                        />
                        <code class="color-hex">{highlightColor()}</code>
                      </div>
                    </div>
                  </div>

                  {/* 라이브 프리뷰 */}
                  <div class="preview-box">
                    <span class="preview-tag">알림 UI 미리보기</span>
                    <div class="preview-toast" style={{ "border-left-color": highlightColor() }}>
                      <div class="preview-title">
                        <span style={{ color: highlightColor() }}>🔍</span>
                        <strong>위험 요소 감지 알림</strong>
                      </div>
                      <p class="preview-desc">현재 설정된 테마 색상으로 웹페이지 알림 배너가 렌더링됩니다.</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* 하단 고정 바 / 버튼 영역 */}
              <div class="form-actions-bar">
                <div class="actions-container">
                  <Show when={statusMessage()}>
                    <div class="toast-message">
                      <span class="toast-icon">✓</span>
                      <span>{statusMessage()}</span>
                    </div>
                  </Show>
                  <div class="actions-right">
                    <button type="submit" class="btn-primary">
                      변경사항 저장
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </main>
      </div>
    </Show>
  );
};
