import type { ExtractedPost } from "./types";
import { BasePostExtractor } from "./baseExtractor";
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
    const alt = (img.getAttribute("alt") || "").toLowerCase();
    if (alt.includes("프로필") || alt.includes("profile")) return;

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

    const text = (candidate.innerText || candidate.textContent || "").trim();
    return text.length > 0;
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
// Instagram 캡션 텍스트 추출 (버튼 등 제거)
// ---------------------------------------------------------------------------
export function extractInstagramCaption(caption: HTMLElement, article: HTMLElement): string {
  const copy = caption.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("button, [role=\"button\"], a[role=\"button\"]").forEach((element) => element.remove());

  const header = article.querySelector("header");
  const headerLinks = Array.from(header?.querySelectorAll<HTMLAnchorElement>("a[href]") || []);
  const headerHrefs = new Set(headerLinks.map((link) => link.getAttribute("href")));
  copy.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    if (headerHrefs.has(link.getAttribute("href"))) {
      link.remove();
    }
  });

  return (copy.innerText || copy.textContent || "").trim();
}

// ---------------------------------------------------------------------------
// Instagram 게시글 추출 (단일 article)
// ---------------------------------------------------------------------------
export function extractInstagramPost(article: HTMLElement): ExtractedPost | null {
  // 캡션만 추출
  const caption = findInstagramCaption(article);
  const content = caption ? extractInstagramCaption(caption, article) : "";

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

  if (!postId) {
    postId = `ig-${generateSimpleHash(content + imageUrls.join(""))}`;
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
