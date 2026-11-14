import type { ExtractedPost } from "./types";
import { BasePostExtractor } from "./base-extractor";
import { wait, generateSimpleHash, isClickableMoreButton } from "./common";

/**
 * 인스타그램 단일 게시글 속 모든 이미지의 URL을 반환합니다.
 */
export function extractInstagramImageUrls(article: HTMLElement): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  // 인스타그램 게시글 내 모든 이미지 탐색
  const imgElements = article.querySelectorAll<HTMLImageElement>("img");
  imgElements.forEach((img) => {
    // 프로필 사진 및 헤더 아바타 제외
    if (img.closest("header")) return;
    // 음원/오디오 썸네일 제외
    if (
      img.closest(
        'a[href*="/audio/"], a[href*="/reels/audio/"], a[href*="/music/"], a[href*="audio_id="], [aria-label*="오디오" i], [aria-label*="audio" i], [aria-label*="음악" i], [aria-label*="music" i]'
      )
    ) {
      return;
    }
    const alt = (img.getAttribute("alt") || "").toLowerCase();
    if (
      alt.includes("프로필") ||
      alt.includes("profile") ||
      alt.includes("오디오") ||
      alt.includes("audio") ||
      alt.includes("음원")
    ) {
      return;
    }

    // 크기가 작은 아바타/아이콘 제외
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 100 && rect.height > 0 && rect.height < 100) {
      return;
    }

    // 최적의 이미지 URL 선별 (currentSrc -> srcset -> src)
    let bestUrl = img.currentSrc || "";
    if (!bestUrl && img.srcset) {
      const candidates = img.srcset.split(",").map((item) => {
        const parts = item.trim().split(/\s+/);
        return {
          url: parts[0],
          width: parts[1] ? parseInt(parts[1], 10) || 0 : 0,
        };
      });
      candidates.sort((a, b) => b.width - a.width);
      if (candidates[0]?.url) {
        bestUrl = candidates[0].url;
      }
    }
    if (!bestUrl) {
      bestUrl = img.src || "";
    }

    if (bestUrl && bestUrl.startsWith("http") && !seen.has(bestUrl)) {
      seen.add(bestUrl);
      urls.push(bestUrl);
    }
  });

  return urls.slice(0, 8);
}

// ---------------------------------------------------------------------------
// 인스타그램 음원/오디오 판별 헬퍼
// ---------------------------------------------------------------------------

/**
 * 텍스트가 인스타그램 음원/오디오 관련 표기인지 판별합니다.
 */
export function isInstagramAudioText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // "원본 오디오", "오리지널 오디오", "Original audio" 등 단독 또는 구분자 뒤 패턴
  if (/^(?:.*[•·\s])?(?:원본\s*오디오|오리지널\s*오디오|original\s*audio)$/i.test(trimmed)) {
    return true;
  }

  // 음악 기호로 시작하는 오디오 정보 표기 (예: "🎵 Artist - Track")
  if (/^[🎵🎶]\s*.+$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * 인스타그램 음원/오디오 관련 요소인지 판별합니다. (캡션 후보 필터링)
 */
export function isInstagramAudioElement(element: HTMLElement): boolean {
  // 1. 음원 링크 자체이거나 음원 링크 내부 요소인 경우
  if (
    element.closest(
      'a[href*="/audio/"], a[href*="/reels/audio/"], a[href*="/music/"], a[href*="audio_id="]'
    )
  ) {
    return true;
  }

  // 2. 오디오/음악 관련 aria-label을 가진 요소 자체이거나 그 내부인 경우
  if (
    element.closest(
      '[aria-label*="오디오" i], [aria-label*="audio" i], [aria-label*="음악" i], [aria-label*="music" i]'
    )
  ) {
    return true;
  }

  // 3. audio 태그 자체이거나 내부인 경우
  if (element.closest("audio") || element.matches("audio")) {
    return true;
  }

  // 4. 텍스트 자체가 순수 음원/오디오 표기인 경우
  const text = (element.innerText || element.textContent || "").trim();
  if (isInstagramAudioText(text)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Instagram 캡션 찾기
// ---------------------------------------------------------------------------
export function findInstagramCaption(article: HTMLElement): HTMLElement | null {
  const header = article.querySelector("header");
  const candidates = Array.from(
    article.querySelectorAll<HTMLElement>("h1, div._a9zs, span[dir=\"auto\"]")
  ).filter((candidate) => {
    if (header?.contains(candidate) || candidate.closest("ul, button, [role=\"button\"]")) {
      return false;
    }

    // 음원/오디오 관련 요소 제외
    if (isInstagramAudioElement(candidate)) {
      return false;
    }

    const text = (candidate.innerText || candidate.textContent || "").trim();
    if (!text || isInstagramAudioText(text)) {
      return false;
    }

    return true;
  });

  return (
    candidates.find((candidate) => candidate.matches("h1")) ||
    candidates.find((candidate) => candidate.matches("div._a9zs")) ||
    candidates.sort(
      (a, b) =>
        (b.innerText || b.textContent || "").length - (a.innerText || a.textContent || "").length
    )[0] ||
    null
  );
}

// ---------------------------------------------------------------------------
// 확장된 게시글 추적 (모듈 레벨 WeakSet)
// ---------------------------------------------------------------------------
const expandedInstagramPosts = new WeakSet<HTMLElement>();

// ---------------------------------------------------------------------------
// Instagram 캡션 "더 보기" 확장
// ---------------------------------------------------------------------------
export async function expandInstagramCaption(article: HTMLElement): Promise<boolean> {
  if (expandedInstagramPosts.has(article)) {
    return false;
  }

  const caption = findInstagramCaption(article);
  if (!caption) {
    return false;
  }

  const captionScope = caption.closest<HTMLElement>("div._a9zs") || caption.parentElement;
  if (
    !captionScope ||
    captionScope === article ||
    !article.contains(captionScope) ||
    captionScope.closest("ul")
  ) {
    return false;
  }

  const candidates = [
    ...(captionScope.matches("button, [role=\"button\"], a, span") ? [captionScope] : []),
    ...Array.from(captionScope.querySelectorAll<HTMLElement>("button, [role=\"button\"], a, span")),
  ];
  const moreButton = candidates.find(
    (candidate) =>
      !candidate.closest("ul, header") &&
      captionScope.contains(candidate) &&
      isClickableMoreButton(candidate)
  );
  if (!moreButton) {
    return false;
  }

  expandedInstagramPosts.add(article);
  moreButton.click();
  await wait(100);
  return true;
}

// ---------------------------------------------------------------------------
// Instagram 캡션 텍스트 추출 (버튼, 음원 등 제거)
// ---------------------------------------------------------------------------
export function extractInstagramCaption(caption: HTMLElement, article: HTMLElement): string {
  const copy = caption.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("button, [role=\"button\"], a[role=\"button\"]").forEach((element) => element.remove());

  // 음원 / 오디오 관련 요소 제거
  copy.querySelectorAll("audio").forEach((el) => el.remove());
  copy
    .querySelectorAll(
      'a[href*="/audio/"], a[href*="/reels/audio/"], a[href*="/music/"], a[href*="audio_id="], [aria-label*="오디오" i], [aria-label*="audio" i], [aria-label*="음악" i], [aria-label*="music" i]'
    )
    .forEach((el) => el.remove());
  copy.querySelectorAll("svg").forEach((svg) => {
    const label = (svg.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("오디오") || label.includes("audio") || label.includes("음악") || label.includes("music")) {
      const target = svg.closest("a") || svg.parentElement || svg;
      target.remove();
    }
  });

  const header = article.querySelector("header");
  const headerLinks = Array.from(header?.querySelectorAll<HTMLAnchorElement>("a[href]") || []);
  const headerHrefs = new Set(headerLinks.map((link) => link.getAttribute("href")));
  copy.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    if (headerHrefs.has(link.getAttribute("href"))) {
      link.remove();
    }
  });

  let text = (copy.innerText || copy.textContent || "").trim();

  // 음원 관련 텍스트 라인 제거
  if (text) {
    const lines = text.split("\n");
    const filteredLines = lines.filter((line) => !isInstagramAudioText(line));
    text = filteredLines.join("\n").trim();
  }

  return text;
}

// ---------------------------------------------------------------------------
// Instagram 게시글 추출 (단일 article)
// ---------------------------------------------------------------------------
export function extractInstagramPost(article: HTMLElement): ExtractedPost | null {
  // 캡션만 추출
  const caption = findInstagramCaption(article);
  let content = caption ? extractInstagramCaption(caption, article) : "";

  // 추출된 본문 전체가 음원 표기인 경우 비움
  if (isInstagramAudioText(content)) {
    content = "";
  }

  const imageUrls = extractInstagramImageUrls(article);
  if (!content && imageUrls.length === 0) {
    return null;
  }

  // 게시글 ID
  let postId = "";
  const postLink = article.querySelector<HTMLAnchorElement>("a[href*=\"/p/\"], a[href*=\"/reel/\"]");
  if (postLink) {
    const match = postLink.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
    if (match) {
      postId = `ig-${match[2]}`;
    }
  }

  // 단일 게시글/릴스 페이지일 경우 현재 URL pathname에서도 ID 추출
  if (!postId && typeof window !== "undefined") {
    const match = window.location.pathname.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
    if (match) {
      postId = `ig-${match[2]}`;
    }
  }

  if (!postId) {
    // 쿼리 파라미터가 동적으로 변하는 이미지 URL은 쿼리를 제외하여 일관된 해시 유지
    const cleanImageUrls = imageUrls.map((u) => u.split("?")[0]);
    postId = `ig-${generateSimpleHash(content + cleanImageUrls.join(""))}`;
  }

  article.dataset.detectiumImageCount = String(imageUrls.length);

  return {
    data: {
      id: postId,
      platform: "instagram",
      content,
      imageUrls,
    },
    element: article,
  };
}

/**
 * 인스타그램 전용 Extractor 구현체
 */
export class InstagramExtractor extends BasePostExtractor {
  readonly platform = "instagram" as const;

  canHandle(hostname: string): boolean {
    return hostname.includes("instagram.com");
  }

  getCandidateElements(): HTMLElement[] {
    let candidateElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        "article, main article, div[role=\"presentation\"] > div > article"
      )
    );
    if (candidateElements.length === 0) {
      // 일부 인스타그램 뷰 대응
      candidateElements = Array.from(
        document.querySelectorAll<HTMLElement>(
          "main div[style*=\"flex-direction: column\"] > div"
        )
      );
    }
    return candidateElements;
  }

  getImageUrls(article: HTMLElement): string[] {
    return extractInstagramImageUrls(article);
  }

  protected override async beforeExtract(element: HTMLElement): Promise<void> {
    await expandInstagramCaption(element);
  }

  extractPost(article: HTMLElement): ExtractedPost | null {
    return extractInstagramPost(article);
  }
}

export const instagramExtractor = new InstagramExtractor();
