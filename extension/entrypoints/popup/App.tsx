import { createSignal, onMount, Show, createMemo } from "solid-js";
import css from "./popup.module.css";

interface FilterLevel {
  step: number;
  label: string;
  threshold: number;
  description: string;
}

const FILTER_LEVELS: FilterLevel[] = [
  {
    step: 0,
    label: "약함",
    threshold: 70,
    description: "위험도 70점 이상 (명백한 선동·조작 게시글 차단)",
  },
  {
    step: 1,
    label: "보통",
    threshold: 50,
    description: "위험도 50점 이상 (왜곡·편향 및 선동 게시글 차단)",
  },
  {
    step: 2,
    label: "강함",
    threshold: 40,
    description: "위험도 40점 이상 (경미한 과장·의심 게시글까지 감지)",
  },
];

export default () => {
  const [isEnabled, setIsEnabled] = createSignal<boolean>(true);
  const [currentStep, setCurrentStep] = createSignal<number>(1); // 기본 보통(50)
  const [loading, setLoading] = createSignal<boolean>(true);
  const [currentPlatform, setCurrentPlatform] = createSignal("확인 중...");
  const [cacheStatus, setCacheStatus] = createSignal<string>("");

  const activeLevel = createMemo(() => {
    const step = currentStep();
    return FILTER_LEVELS[step] || FILTER_LEVELS[1];
  });

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
      chrome.storage.sync.get(["isEnabled", "detectionThreshold"], (res) => {
        if (typeof res.isEnabled === "boolean") {
          setIsEnabled(res.isEnabled);
        }

        const th = typeof res.detectionThreshold === "number" ? res.detectionThreshold : 50;
        if (th <= 40) {
          setCurrentStep(2); // 강함
        } else if (th <= 50) {
          setCurrentStep(1); // 보통
        } else {
          setCurrentStep(0); // 약함
        }

        setLoading(false);
      });
    } else {
      setLoading(false);
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

  // 필터링 강도 슬라이더 변경 핸들러
  const handleStepChange = (step: number) => {
    const clampedStep = Math.max(0, Math.min(2, step));
    setCurrentStep(clampedStep);
    const target = FILTER_LEVELS[clampedStep] || FILTER_LEVELS[1];
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      chrome.storage.sync.set({ detectionThreshold: target?.threshold });
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
    });
  };

  return (
    <Show when={!loading()} fallback={<div class={css.popupBox}></div>}>
      <div class={css.popupBox}>
        {/* 헤더 */}
        <header class={css.header}>
          <div class={css.brand}>
            <span class={`${css.materialIcon} ${css.brandIcon}`}>verified_user</span>
            <span class={css.brandTitle}>Detectium</span>
          </div>
          <div
            class={`${css.statusIndicator} ${
              isEnabled() ? css.active : css.inactive
            }`}
          >
            <span class={css.statusDot}></span>
            <span>{isEnabled() ? "보호 중" : "꺼짐"}</span>
          </div>
        </header>

        <section class={css.section}>
          <div class={css.platformCard}>
            <div class={css.platformIconWrap}>
              <span class={`${css.materialIcon} ${css.platformIcon}`}>language</span>
            </div>
            <div class={css.platformInfo}>
              <span class={css.platformLabel}>현재 접속 중인 플랫폼</span>
              <span class={css.platformName}>{currentPlatform()}</span>
            </div>
          </div>
        </section>

        {/* 1. 활성화 / 비활성화 라운드 바 토글 스위치 */}
        <section class={css.section}>
          <div class={css.toggleCard}>
            <div class={css.toggleInfo}>
              <span class={css.toggleLabel}>실시간 게시글 필터링</span>
              <span class={css.toggleSubLabel}>
                {isEnabled() ? "SNS 피드를 실시간 감지합니다" : "감지 기능이 중지되었습니다"}
              </span>
            </div>
            <label class={css.switchContainer}>
              <input
                type="checkbox"
                class={css.switchInput}
                checked={isEnabled()}
                onChange={handleToggle}
              />
              <span class={css.switchTrack}>
                <span class={css.switchThumb}></span>
              </span>
            </label>
          </div>
        </section>

        {/* 2. 필터링 강도 3단계 슬라이드 바 */}
        <section class={css.section}>
          <div class={css.strengthCard}>
            <div class={css.sectionHeader}>
              <div class={css.sectionTitleWrap}>
                <span class={`${css.materialIcon} ${css.sectionIcon}`}>tune</span>
                <span class={css.sectionTitle}>필터링 강도</span>
              </div>
              <span class={css.strengthValueBadge}>
                {activeLevel()?.label} ({activeLevel()?.threshold}점↑)
              </span>
            </div>

            <div class={css.sliderWrapper}>
              {/* 가로 라인 배경 및 활성 진행 라인 */}
              <div class={css.sliderTrackLine}>
                <div
                  class={css.sliderTrackFill}
                  style={{ width: `${(currentStep() / 2) * 100}%` }}
                ></div>
              </div>

              {/* 3단계 스텝 눈금 도트 */}
              <div class={css.sliderStepDots}>
                <span
                  class={`${css.stepDot} ${
                    currentStep() >= 0 ? css.active : ""
                  }`}
                ></span>
                <span
                  class={`${css.stepDot} ${
                    currentStep() >= 1 ? css.active : ""
                  }`}
                ></span>
                <span
                  class={`${css.stepDot} ${
                    currentStep() >= 2 ? css.active : ""
                  }`}
                ></span>
              </div>

              {/* 동그라미(Thumb)가 움직이는 3단계 슬라이더 Range Input */}
              <input
                type="range"
                min="0"
                max="2"
                step="1"
                value={currentStep()}
                class={css.rangeInput}
                onInput={(e) => handleStepChange(Number(e.currentTarget.value))}
              />

              {/* 하단 3단계 텍스트 (약함 / 보통 / 강함) */}
              <div class={css.labelsRow}>
                <button
                  type="button"
                  class={`${css.labelBtn} ${
                    currentStep() === 0 ? css.selected : ""
                  }`}
                  onClick={() => handleStepChange(0)}
                >
                  <span>약함</span>
                  <span class={css.scoreNotice}>70점 이상</span>
                </button>
                <button
                  type="button"
                  class={`${css.labelBtn} ${
                    currentStep() === 1 ? css.selected : ""
                  }`}
                  onClick={() => handleStepChange(1)}
                >
                  <span>보통</span>
                  <span class={css.scoreNotice}>50점 이상</span>
                </button>
                <button
                  type="button"
                  class={`${css.labelBtn} ${
                    currentStep() === 2 ? css.selected : ""
                  }`}
                  onClick={() => handleStepChange(2)}
                >
                  <span>강함</span>
                  <span class={css.scoreNotice}>40점 이상</span>
                </button>
              </div>
            </div>

            {/* 현재 강도 설명 */}
            <div class={css.descBox}>
              <span class={`${css.materialIcon} ${css.descIcon}`}>info</span>
              <span>{activeLevel()?.description}</span>
            </div>
          </div>
        </section>

        <section class={css.section}>
          <div class={css.cacheCard}>
            <div class={css.sectionHeader}>
              <div class={css.sectionTitleWrap}>
                <span class={`${css.materialIcon} ${css.sectionIcon}`}>delete</span>
                <span class={css.sectionTitle}>캐시 관리</span>
              </div>
            </div>

            <button type="button" class={css.clearCacheBtn} onClick={handleClearCache}>
              게시글 캐시 비우기
            </button>

            <Show when={cacheStatus()}>
              <span class={css.cacheStatus}>{cacheStatus()}</span>
            </Show>
          </div>
        </section>
      </div>
    </Show>
  );
};
