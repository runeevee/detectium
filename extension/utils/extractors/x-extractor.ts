import type { ExtractedPost } from "./types";
import { BasePostExtractor } from "./base-extractor";
import { generateSimpleHash, isClickableMoreButton, wait } from "./common";

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

  return urls.slice(0, 8);
}

const expandedXPosts = new WeakSet<HTMLElement>();

function getXStatusId(url: string): string | undefined {
  return url.match(/\/status\/(\d+)/)?.[1];
}

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
  // 캡션 텍스트
  const textEl = article.querySelector("[data-testid=\"tweetText\"]");
  const textCopy = textEl?.cloneNode(true) as HTMLElement | undefined;
  textCopy?.querySelectorAll("button, [role=\"button\"], [data-testid*=\"show-more\"]").forEach((el) => {
    el.remove();
  });
  const content = textCopy ? (textCopy.innerText || textCopy.textContent || "").trim() : "";

  // 첨부된 모든 이미지 URL 추출
  const imageUrls = extractXImageUrls(article);
  if (!content && imageUrls.length === 0) {
    return null;
  }

  // 트윗 고유 ID
  let tweetId = "";
  const statusLink = article.querySelector<HTMLAnchorElement>("a[href*=\"/status/\"]");
  if (statusLink) {
    const statusId = getXStatusId(statusLink.href);
    if (statusId) {
      tweetId = `x-${statusId}`;
    }
  }

  // 단일 트윗 상세 페이지의 경우 URL pathname에서도 추출
  if (!tweetId && typeof window !== "undefined") {
    const statusId = getXStatusId(window.location.pathname);
    if (statusId) {
      tweetId = `x-${statusId}`;
    }
  }

  if (!tweetId) {
    const cleanImageUrls = imageUrls.map((u) => u.split("?")[0]);
    tweetId = `x-${generateSimpleHash(content + cleanImageUrls.join(""))}`;
  }

  article.dataset.detectiumImageCount = String(imageUrls.length);

  return {
    data: {
      id: tweetId,
      platform: "x",
      content,
      imageUrls,
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
    const tweets = Array.from(document.querySelectorAll<HTMLElement>("article[data-testid=\"tweet\"]"));
    const detailStatusId = getXStatusId(window.location.pathname);
    if (!detailStatusId) {
      return tweets;
    }

    return tweets.filter((tweet) => {
      const statusLink = tweet.querySelector<HTMLAnchorElement>("a[href*=\"/status/\"]");
      return statusLink !== null && getXStatusId(statusLink.href) === detailStatusId;
    });
  }

  getImageUrls(article: HTMLElement): string[] {
    return extractXImageUrls(article);
  }

  protected override async beforeExtract(element: HTMLElement): Promise<void> {
    await expandXPost(element);
  }

  extractPost(article: HTMLElement): ExtractedPost | null {
    return extractXPost(article);
  }
}

export const xExtractor = new XExtractor();
