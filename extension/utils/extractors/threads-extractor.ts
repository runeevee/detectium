import type { ExtractedPost } from "./types";
import { BasePostExtractor } from "./base-extractor";
import { generateSimpleHash, isClickableMoreButton, wait } from "./common";

/**
 * Threads 단일 게시글에서 첨부된 이미지 URL들을 추출합니다.
 */
export function extractThreadsImageUrls(container: HTMLElement): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const imgElements = container.querySelectorAll<HTMLImageElement>("img");
  imgElements.forEach((img) => {
    // 프로필 아바타 링크 내부 제외
    if (img.closest('a[href^="/@"]')) {
      const rect = img.getBoundingClientRect();
      if (rect.width > 0 && rect.width < 70 && rect.height > 0 && rect.height < 70) {
        return;
      }
    }

    const alt = (img.getAttribute("alt") || "").toLowerCase();
    if (
      alt.includes("프로필") ||
      alt.includes("profile") ||
      alt.includes("아바타") ||
      alt.includes("avatar")
    ) {
      return;
    }

    // 아이콘, 이모지 등 너무 작은 이미지 제외
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 60 && rect.height > 0 && rect.height < 60) {
      return;
    }

    // 고화질 이미지 URL 선별 (currentSrc -> srcset -> src)
    let bestUrl = img.currentSrc || "";
    if (!bestUrl && img.srcset) {
      const candidates = img.srcset.split(",").map((item) => {
        const parts = item.trim().split(/\s+/);
        return {
          url: parts[0] || "",
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

const expandedThreadsPosts = new WeakSet<HTMLElement>();

/**
 * 긴 본문으로 축약된 Threads 게시글의 "더 보기"를 클릭하여 확장합니다.
 */
export async function expandThreadsPost(container: HTMLElement): Promise<boolean> {
  if (expandedThreadsPosts.has(container)) {
    return false;
  }

  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [role="button"], span, div'
    )
  );

  const moreButton = candidates.find((el) => {
    // 프로필이나 액션바 내부 요소는 제외
    if (el.closest('a[href^="/@"], [aria-label*="좋아요" i], [aria-label*="Like" i]')) {
      return false;
    }
    if (isClickableMoreButton(el)) {
      return true;
    }
    const text = (el.innerText || el.textContent || "").trim().toLowerCase();
    return text === "더 보기" || text === "... 더 보기" || text === "more" || text === "... more";
  });

  if (moreButton) {
    expandedThreadsPosts.add(container);
    moreButton.click();
    await wait(100);
    return true;
  }

  return false;
}

/**
 * Threads 포스트 URL에서 게시글 ID를 추출합니다.
 */
export function getThreadsPostId(url: string): string | undefined {
  const match = url.match(/\/(?:@[^/]+\/)?post\/([a-zA-Z0-9_-]+)/);
  return match?.[1];
}

/**
 * Threads 게시글 본문 텍스트를 추출합니다.
 */
export function extractThreadsText(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement;

  // 헤더, 프로필, 버튼, SVG, 리포스트/좋아요 바 제거
  copy.querySelectorAll("button, [role=\"button\"], svg").forEach((el) => el.remove());
  copy.querySelectorAll("header, nav").forEach((el) => el.remove());

  // 유저네임 링크 및 프로필 링크 텍스트 제거
  copy.querySelectorAll('a[href^="/@"]').forEach((el) => {
    // 단, 포스트 링크(/@username/post/...)는 본문 내부 링크일 수도 있으니 /post/가 없는 프로필 링크만 제거
    const href = el.getAttribute("href") || "";
    if (!href.includes("/post/")) {
      el.remove();
    }
  });

  // 본문 텍스트가 될 수 있는 요소 탐색 (Threads는 주로 div[dir="auto"], span[dir="auto"] 사용)
  const dirElements = Array.from(copy.querySelectorAll<HTMLElement>('[dir="auto"]'));
  if (dirElements.length > 0) {
    // 텍스트 길이가 유의미한 요소들 수집
    const texts = dirElements
      .map((el) => (el.innerText || el.textContent || "").trim())
      .filter((t) => t.length > 0 && !t.startsWith("@") && !/^\d+[만천k]?$/i.test(t));

    if (texts.length > 0) {
      // 중복 및 부분 포함 텍스트 필터링
      const uniqueTexts: string[] = [];
      for (const t of texts) {
        if (!uniqueTexts.some((existing) => existing.includes(t))) {
          uniqueTexts.push(t);
        }
      }
      const combined = uniqueTexts.join("\n").trim();
      if (combined.length > 0) {
        return combined;
      }
    }
  }

  // 폴백: 전체 텍스트 추출
  const rawText = (copy.innerText || copy.textContent || "").trim();
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (l === "더 보기" || l === "... 더 보기" || l.toLowerCase() === "more") return false;
      // 좋아요, 답글 숫자 등 단독 숫자 라인 제외
      if (/^\d+[\s,.]*\d*$/.test(l)) return false;
      return true;
    });

  return lines.join("\n").trim();
}

/**
 * 단일 Threads 게시글 컨테이너로부터 ExtractedPost 구조체 생성
 */
export function extractThreadsPost(container: HTMLElement): ExtractedPost | null {
  const content = extractThreadsText(container);
  const imageUrls = extractThreadsImageUrls(container);

  if (!content && imageUrls.length === 0) {
    return null;
  }

  // 게시글 ID 탐색
  let postId = "";
  const postLink = container.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
  if (postLink) {
    const id = getThreadsPostId(postLink.href);
    if (id) {
      postId = `threads-${id}`;
    }
  }

  // 단일 포스트 상세 페이지 URL 확인
  if (!postId && typeof window !== "undefined") {
    const id = getThreadsPostId(window.location.pathname);
    if (id) {
      postId = `threads-${id}`;
    }
  }

  if (!postId) {
    const cleanImageUrls = imageUrls.map((u) => u.split("?")[0]);
    postId = `threads-${generateSimpleHash(content + cleanImageUrls.join(""))}`;
  }

  container.dataset.detectiumImageCount = String(imageUrls.length);

  return {
    data: {
      id: postId,
      platform: "threads",
      content,
      imageUrls,
    },
    element: container,
  };
}

/**
 * Threads 전용 Extractor 구현체
 */
export class ThreadsExtractor extends BasePostExtractor {
  readonly platform = "threads" as const;

  canHandle(hostname: string): boolean {
    return hostname.includes("threads.net") || hostname.includes("threads.com");
  }

  getCandidateElements(): HTMLElement[] {
    // 1. Threads에서 개별 포스트 컨테이너로 쓰이는 대표적인 셀렉터들
    const rawCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[data-pressable-container="true"], article, div[data-testid="thread-item"], div[data-testid="post-item"]'
      )
    );

    let candidates: HTMLElement[] = [];

    if (rawCandidates.length > 0) {
      // 상위 컨테이너가 하위 컨테이너를 포함하는 경우, 하위 컨테이너(실제 개별 포스트)만 선택
      candidates = rawCandidates.filter(
        (el) => !rawCandidates.some((other) => other !== el && el.contains(other))
      );
    } else {
      // 2. Fallback: a[href*="/post/"]의 상위 컨테이너 수집
      const postLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'));
      const seenContainers = new Set<HTMLElement>();

      for (const link of postLinks) {
        // 링크 상위의 적절한 게시글 카드 래퍼 탐색
        let parent: HTMLElement | null = link.parentElement;
        let cardContainer: HTMLElement | null = null;

        while (parent && parent !== document.body) {
          const rect = parent.getBoundingClientRect();
          if (rect.height > 80 && rect.width > 200) {
            cardContainer = parent;
            // 특정 게시글 경계(div 태그이면서 높이가 과도하게 크지 않은 요소) 발견 시 중단
            if (
              parent.matches('div[data-pressable-container="true"], article') ||
              rect.height < 1200
            ) {
              break;
            }
          }
          parent = parent.parentElement;
        }

        if (cardContainer && !seenContainers.has(cardContainer)) {
          seenContainers.add(cardContainer);
          candidates.push(cardContainer);
        }
      }
    }

    // 상세 페이지의 경우 해당 상세 포스트 우선 필터링 (선택적)
    const detailPostId = typeof window !== "undefined" ? getThreadsPostId(window.location.pathname) : undefined;
    if (detailPostId && candidates.length > 0) {
      // 상세 포스트와 일치하는 것이 있으면 해당 요소들을 반환
      const matching = candidates.filter((el) => {
        const link = el.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
        return link ? getThreadsPostId(link.href) === detailPostId : false;
      });
      if (matching.length > 0) {
        return matching;
      }
    }

    return candidates;
  }

  getImageUrls(container: HTMLElement): string[] {
    return extractThreadsImageUrls(container);
  }

  protected override async beforeExtract(element: HTMLElement): Promise<void> {
    await expandThreadsPost(element);
  }

  extractPost(container: HTMLElement): ExtractedPost | null {
    return extractThreadsPost(container);
  }
}

export const threadsExtractor = new ThreadsExtractor();

// 이전 이름 호환용 alias
export const threadExtractor = threadsExtractor;
export const extractThreadPost = extractThreadsPost;
export const extractThreadImageUrls = extractThreadsImageUrls;
export const expandThreadPost = expandThreadsPost;
export const getThreadPostId = getThreadsPostId;
export const extractThreadText = extractThreadsText;
export { ThreadsExtractor as ThreadExtractor };
