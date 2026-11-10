import type { ExtractedPost } from "./types";
import { BasePostExtractor } from "./baseExtractor";
import { wait, generateSimpleHash, isClickableMoreButton } from "./common";
import { extractVideoFrames } from "../videoFrameExtractor";

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

  // 동영상 썸네일 포스터도 수집
  const videoElements = article.querySelectorAll<HTMLVideoElement>("video[poster]");
  videoElements.forEach((vid) => {
    const poster = vid.poster || vid.getAttribute("poster");
    if (poster && poster.startsWith("http") && !seen.has(poster)) {
      seen.add(poster);
      urls.push(poster);
    }
  });

  return urls.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Instagram 캡션 찾기
// ---------------------------------------------------------------------------
export function findInstagramCaption(article: HTMLElement, author: string): HTMLElement | null {
  const header = article.querySelector("header");
  const candidates = Array.from(
    article.querySelectorAll<HTMLElement>("h1, div._a9zs, span[dir=\"auto\"]")
  ).filter((candidate) => {
    if (header?.contains(candidate) || candidate.closest("ul, button, [role=\"button\"]")) {
      return false;
    }

    const text = (candidate.innerText || candidate.textContent || "").trim();
    return text.length > 0 && text !== author && text !== `@${author}`;
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
// Instagram 작성자 추출
// ---------------------------------------------------------------------------
export function extractInstagramAuthor(article: HTMLElement): string {
  const header = article.querySelector("header");
  const authorLink = header?.querySelector<HTMLAnchorElement>("a[href]");
  return (authorLink?.textContent || "").trim();
}

// ---------------------------------------------------------------------------
// 확장된 게시글 추적 (모듈 레벨 WeakSet)
// ---------------------------------------------------------------------------
const expandedInstagramPosts = new WeakSet<HTMLElement>();

// ---------------------------------------------------------------------------
// Instagram 캡션 "더 보기" 확장
// ---------------------------------------------------------------------------
export async function expandInstagramCaption(article: HTMLElement, author: string): Promise<boolean> {
  if (expandedInstagramPosts.has(article)) {
    return false;
  }

  const caption = findInstagramCaption(article, author);
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
export function extractInstagramCaption(caption: HTMLElement, article: HTMLElement, author: string): string {
  const copy = caption.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("button, [role=\"button\"], a[role=\"button\"]").forEach((element) => element.remove());

  const header = article.querySelector("header");
  const authorLinks = Array.from(header?.querySelectorAll<HTMLAnchorElement>("a[href]") || []);
  const authorHrefs = new Set(authorLinks.map((link) => link.getAttribute("href")));
  copy.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    const linkText = (link.innerText || link.textContent || "").trim();
    if (authorHrefs.has(link.getAttribute("href")) || linkText === author || linkText === `@${author}`) {
      link.remove();
    }
  });

  return (copy.innerText || copy.textContent || "").trim();
}

// ---------------------------------------------------------------------------
// Instagram 작성자 해결 (헤더 우선, 없으면 폴백)
// ---------------------------------------------------------------------------
export function resolveInstagramAuthor(article: HTMLElement): string {
  const fromHeader = extractInstagramAuthor(article);
  if (fromHeader) return fromHeader;
  const fallbackEl = article.querySelector("header a, a[role=\"link\"]");
  const fallback = fallbackEl ? (fallbackEl.textContent || "").trim() : "";
  return fallback || "인스타그램 작성자";
}

// ---------------------------------------------------------------------------
// Instagram 게시글 추출 (단일 article)
// ---------------------------------------------------------------------------
export function extractInstagramPost(article: HTMLElement): ExtractedPost | null {
  const author = resolveInstagramAuthor(article);

  // 캡션 본문 (정제된 캡션 -> 실패 시 기존 방식 폴백)
  const caption = findInstagramCaption(article, author);
  let content = caption ? extractInstagramCaption(caption, article, author) : "";
  if (!content) {
    const captionEl = article.querySelector("h1, div._a9zs, span[dir=\"auto\"]");
    content = captionEl ? (captionEl.textContent || "").trim() : "";
  }

  // 게시글 내 모든 첨부 이미지 추출
  const imageUrls = extractInstagramImageUrls(article);
  const videoCount = article.querySelectorAll("video").length;

  // 카드뉴스 슬라이드 이미지 alt 태그 수집
  const imgElements = article.querySelectorAll<HTMLImageElement>("img[alt]");
  const mediaAlts: string[] = [];
  imgElements.forEach((img) => {
    const alt = img.getAttribute("alt");
    if (alt && !alt.includes("프로필 사진") && alt.length > 5) {
      mediaAlts.push(alt);
    }
  });

  const combinedMedia = [
    mediaAlts.length > 0 ? `[카드뉴스/이미지 내용]: ${mediaAlts.join("; ")}` : "",
    videoCount > 0 ? `[동영상 첨부: ${videoCount}개]` : "",
    imageUrls.length > 0 ? `[첨부 이미지 ${imageUrls.length}장 확인됨]` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  // 본문, 미디어 설명, 첨부 이미지 모두 없으면 스킵
  if (!content && !combinedMedia && imageUrls.length === 0) {
    return null;
  }

  // 게시글 고유 URL / ID / shortcode
  let postId = "";
  let shortcode: string | undefined;
  const postLink = article.querySelector<HTMLAnchorElement>("a[href*=\"/p/\"], a[href*=\"/reel/\"]");
  if (postLink) {
    const match = postLink.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
    if (match) {
      shortcode = match[2];
      postId = `ig-${match[2]}`;
    }
  }

  if (!postId) {
    postId = `ig-${generateSimpleHash(author + content + imageUrls.join("") + combinedMedia.slice(0, 50))}`;
  }

  article.dataset.detectiumImageCount = String(imageUrls.length);

  return {
    data: {
      id: postId,
      platform: "instagram",
      author,
      content,
      mediaDescription: combinedMedia,
      imageUrls,
      url: postLink ? postLink.href : undefined,
      shortcode,
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
    await expandInstagramCaption(element, resolveInstagramAuthor(element));
  }

  protected override async enrichPost(post: ExtractedPost): Promise<void> {
    post.data.videoFrames = await extractVideoFrames(post.element);
  }

  extractPost(article: HTMLElement): ExtractedPost | null {
    return extractInstagramPost(article);
  }
}

export const instagramExtractor = new InstagramExtractor();
