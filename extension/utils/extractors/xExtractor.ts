import type { ExtractedPost } from "./types";
import { BasePostExtractor } from "./baseExtractor";
import { generateSimpleHash, isClickableMoreButton, wait } from "./common";
import { extractVideoFrames } from "../videoFrameExtractor";

/**
 * 이미지 URL 추출 헬퍼 (X/Twitter)
 */
export function extractXImageUrls(article: HTMLElement): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const imgElements = article.querySelectorAll<HTMLImageElement>(
    "[data-testid=\"tweetPhoto\"] img, [data-testid=\"card.layoutLarge.media\"] img, img[src*=\"pbs.twimg.com/media/\"]"
  );

  imgElements.forEach((img) => {
    if (img.closest("[data-testid=\"Tweet-User-Avatar\"]")) return;
    const alt = (img.getAttribute("alt") || "").toLowerCase();
    if (alt.includes("프로필") || alt.includes("profile")) return;

    let bestUrl = img.currentSrc || img.src || "";
    if (bestUrl.includes("pbs.twimg.com/media/")) {
      try {
        const parsed = new URL(bestUrl);
        if (parsed.searchParams.has("name")) {
          parsed.searchParams.set("name", "large");
          bestUrl = parsed.toString();
        }
      } catch {
        // URL 파싱 에러 무시
      }
    }

    if (bestUrl && bestUrl.startsWith("http") && !seen.has(bestUrl)) {
      seen.add(bestUrl);
      urls.push(bestUrl);
    }
  });

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

const expandedXPosts = new WeakSet<HTMLElement>();

/**
 * Expand a truncated X post before extracting its text.
 */
export async function expandXPost(article: HTMLElement): Promise<boolean> {
  if (expandedXPosts.has(article)) {
    return false;
  }

  const tweetText = article.querySelector<HTMLElement>("[data-testid=\"tweetText\"]");
  if (!tweetText) {
    return false;
  }

  const candidates = Array.from(
    tweetText.querySelectorAll<HTMLElement>(
      "button, [role=\"button\"], a, [data-testid*=\"show-more\"]"
    )
  );
  const moreButton = candidates.find(isClickableMoreButton);

  if (moreButton) {
    expandedXPosts.add(article);
    moreButton.click();
    await wait(100);
    return true;
  }

  return false;
}

/**
 * X (구 Twitter) 단일 게시글 추출
 */
export function extractXPost(article: HTMLElement): ExtractedPost | null {
  // 작성자 정보
  const userNameEl = article.querySelector("[data-testid=\"User-Name\"]");
  const author = userNameEl ? (userNameEl.textContent || "").replace(/\s+/g, " ").trim() : "알 수 없음";

  // 본문 텍스트
  const textEl = article.querySelector("[data-testid=\"tweetText\"]");
  const textCopy = textEl?.cloneNode(true) as HTMLElement | undefined;
  textCopy?.querySelectorAll("button, [role=\"button\"], [data-testid*=\"show-more\"]").forEach((el) => {
    el.remove();
  });
  const content = textCopy ? (textCopy.innerText || textCopy.textContent || "").trim() : "";

  // 첨부된 모든 이미지 URL 추출
  const imageUrls = extractXImageUrls(article);
  const videoCount = article.querySelectorAll("video").length;

  // 이미지/미디어 설명 (alt 태그)
  const imgElements = article.querySelectorAll<HTMLImageElement>(
    "[data-testid=\"tweetPhoto\"] img, [data-testid=\"tweet\"] img[alt]"
  );
  const mediaAlts: string[] = [];
  imgElements.forEach((img) => {
    const alt = img.getAttribute("alt");
    if (alt && !alt.startsWith("이미지") && !alt.startsWith("프로필")) {
      mediaAlts.push(alt);
    }
  });

  // 링크 카드 (뉴스 기사 미리보기 등)
  const cardDetail = article.querySelector("[data-testid*=\"card\"]");
  const cardText = cardDetail ? (cardDetail.textContent || "").replace(/\s+/g, " ").trim() : "";

  // 결합된 미디어 정보
  const combinedMedia = [
    mediaAlts.length > 0 ? `[이미지 설명]: ${mediaAlts.join("; ")}` : "",
    cardText ? `[첨부 카드/기사]: ${cardText}` : "",
    videoCount > 0 ? `[동영상 첨부: ${videoCount}개]` : "",
    imageUrls.length > 0 ? `[첨부 이미지 ${imageUrls.length}장 확인됨]` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  // 본문, 미디어, 첨부 이미지 모두 없으면 스킵
  if (!content && !combinedMedia && imageUrls.length === 0) {
    return null;
  }

  // 트윗 고유 ID
  let tweetId = "";
  const statusLink = article.querySelector<HTMLAnchorElement>("a[href*=\"/status/\"]");
  if (statusLink) {
    const match = statusLink.href.match(/\/status\/(\d+)/);
    if (match) {
      tweetId = `x-${match[1]}`;
    }
  }

  if (!tweetId) {
    tweetId = `x-${generateSimpleHash(author + content + imageUrls.join("") + combinedMedia.slice(0, 50))}`;
  }

  article.dataset.detectiumImageCount = String(imageUrls.length);

  return {
    data: {
      id: tweetId,
      platform: "x",
      author,
      content,
      mediaDescription: combinedMedia,
      imageUrls,
      url: statusLink ? statusLink.href : undefined,
    },
    element: article,
  };
}

/**
 * X (구 Twitter) 전용 Extractor 구현체
 */
export class XExtractor extends BasePostExtractor {
  readonly platform = "x" as const;

  canHandle(hostname: string): boolean {
    return hostname.includes("twitter.com") || hostname.includes("x.com");
  }

  getCandidateElements(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("article[data-testid=\"tweet\"]"));
  }

  getImageUrls(article: HTMLElement): string[] {
    return extractXImageUrls(article);
  }

  protected override async beforeExtract(element: HTMLElement): Promise<void> {
    await expandXPost(element);
  }

  protected override async enrichPost(post: ExtractedPost): Promise<void> {
    post.data.videoFrames = await extractVideoFrames(post.element);
  }

  extractPost(article: HTMLElement): ExtractedPost | null {
    return extractXPost(article);
  }
}

export const xExtractor = new XExtractor();
