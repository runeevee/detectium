import { createSignal, onMount, Show } from "solid-js";
import css from "./options.module.css";

interface Settings {
  [key: string]: unknown;
  isEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  isEnabled: true,
};

export default () => {
  const [isEnabled, setIsEnabled] = createSignal<boolean>(DEFAULT_SETTINGS.isEnabled);
  const [statusMessage, setStatusMessage] = createSignal<string>("");
  const [loading, setLoading] = createSignal<boolean>(true);

  onMount(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        const loaded = items as Settings;
        setIsEnabled(typeof loaded.isEnabled === "boolean" ? loaded.isEnabled : DEFAULT_SETTINGS.isEnabled);
        setLoading(false);
      });
    } else {
      const saved = localStorage.getItem("detectium_settings");
      if (saved) {
        const loaded = JSON.parse(saved) as Settings;
        setIsEnabled(loaded.isEnabled);
      }
      setLoading(false);
    }
  });

  function saveOptions(e: Event) {
    e.preventDefault();
    const newSettings: Settings = {
      isEnabled: isEnabled(),
    };

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.sync.set(newSettings, () => {
        setStatusMessage("모든 설정이 안전하게 저장되었습니다.");
        setTimeout(() => setStatusMessage(""), 3000);
      });
    } else {
      localStorage.setItem("detectium_settings", JSON.stringify(newSettings));
      setStatusMessage("설정이 로컬 스토리지에 저장되었습니다. (개발 환경)");
      setTimeout(() => setStatusMessage(""), 3000);
    }
  }

  return (
    <Show when={!loading()} fallback={<div class="page-container">로딩 중...</div>}>
      <div class={css.optionsBox}>
        <main class="page-body">
          <div class="page-container">
            <div class="page-header">
              <h2>전체 설정</h2>
              <p>웹 콘텐츠 자동 분석 동작을 설정합니다.</p>
            </div>

            <form onSubmit={saveOptions} class="settings-form">
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

              {statusMessage() && (
                <div style={{ color: "#16a34a", "font-size": "13px", "font-weight": "600", "margin-top": "10px" }}>
                  {statusMessage()}
                </div>
              )}

              <div class={css.saveBox}>
                <button class={css.saveBtn} type="submit">
                  저장
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </Show>
  );
};
