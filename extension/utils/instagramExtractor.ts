import type { PostData } from "./types";
import { wait, generateSimpleHash, isElementInViewport } from "./postExtractor";

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
    if (img.closest('header')) return;
    const alt = (img.getAttribute('alt') || '').toLowerCase();
    if (alt.includes('프로필') || alt.includes('profile')) return;

    // 크기가 작은 아바타/아이콘 제외
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 100 && rect.height > 0 && rect.height < 100) {
      return;
    }

    // 최적의 이미지 URL 선별 (currentSrc -> srcset -> src)
    let bestUrl = img.currentSrc || '';
    if (!bestUrl && img.srcset) {
      const candidates = img.srcset.split(',').map((item) => {
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
      bestUrl = img.src || '';
    }

    if (bestUrl && bestUrl.startsWith('http') && !seen.has(bestUrl)) {
      seen.add(bestUrl);
      urls.push(bestUrl);
    }
  });

  // 동영상 썸네일 포스터도 수집
  const videoElements = article.querySelectorAll<HTMLVideoElement>('video[poster]');
  videoElements.forEach((vid) => {
    const poster = vid.poster || vid.getAttribute('poster');
    if (poster && poster.startsWith('http') && !seen.has(poster)) {
      seen.add(poster);
      urls.push(poster);
    }
  });

  return urls.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Instagram 캡션 찾기
// ---------------------------------------------------------------------------
function findInstagramCaption(article: HTMLElement, author: string): HTMLElement | null {
  const header = article.querySelector('header');
  const candidates = Array.from(
    article.querySelectorAll<HTMLElement>('h1, div._a9zs, span[dir="auto"]')
  ).filter((candidate) => {
    if (header?.contains(candidate) || candidate.closest('ul, button, [role="button"]')) {
      return false;
    }

    const text = (candidate.innerText || candidate.textContent || '').trim();
    return text.length > 0 && text !== author && text !== `@${author}`;
  });

  return (
    candidates.find((candidate) => candidate.matches('h1')) ||
    candidates.find((candidate) => candidate.matches('div._a9zs')) ||
    candidates.sort(
      (a, b) =>
        (b.innerText || b.textContent || '').length - (a.innerText || a.textContent || '').length
    )[0] ||
    null
  );
}

// ---------------------------------------------------------------------------
// Instagram 작성자 추출
// ---------------------------------------------------------------------------

export function extractInstagramAuthor(article: HTMLElement): string {
  const header = article.querySelector('header');
  const authorLink = header?.querySelector<HTMLAnchorElement>('a[href]');
  return (authorLink?.textContent || '').trim();
}

export function findInstagramCaptionContainer(article: HTMLElement, author: string): HTMLElement | null {
  return findInstagramCaption(article, author);
}

// ---------------------------------------------------------------------------
// "더 보기" 버튼 판별
// ---------------------------------------------------------------------------

export function isClickableMoreButton(element: HTMLElement): boolean {
  if (
    !element.isConnected ||
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  ) {
    return false;
  }
  if (element instanceof HTMLButtonElement && element.disabled) {
    return false;
  }

  const isMoreLabel = (label: string): boolean =>
    /^(?:\.{2,}\s*)?(?:더\s*보기|자세히\s*보기|more|show\s*more|read\s*more)$/i.test(
      label.replace(/…/g, '...').trim()
    );
  const labels = [
    element.innerText || '',
    element.textContent || '',
    element.getAttribute('aria-label') || '',
  ];
  if (!labels.some(isMoreLabel)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    (element.matches('button, [role="button"], a') || style.cursor === 'pointer') &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.pointerEvents !== 'none' &&
    Number.parseFloat(style.opacity || '1') > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

// ---------------------------------------------------------------------------
// 확장된 게시글 추적 (모듈 레벨 WeakSet)
// ---------------------------------------------------------------------------

const expandedInstagramPosts = new WeakSet<HTMLElement>();

// ---------------------------------------------------------------------------
// Instagram 캡션 "더 보기" 확장
// ---------------------------------------------------------------------------

async function expandInstagramCaption(article: HTMLElement, author: string): Promise<boolean> {
  if (expandedInstagramPosts.has(article)) {
    return false;
  }

  const caption = findInstagramCaption(article, author);
  if (!caption) {
    return false;
  }

  const captionScope = caption.closest<HTMLElement>('div._a9zs') || caption.parentElement;
  if (
    !captionScope ||
    captionScope === article ||
    !article.contains(captionScope) ||
    captionScope.closest('ul')
  ) {
    return false;
  }

  const candidates = [
    ...(captionScope.matches('button, [role="button"], a, span') ? [captionScope] : []),
    ...Array.from(captionScope.querySelectorAll<HTMLElement>('button, [role="button"], a, span')),
  ];
  const moreButton = candidates.find(
    (candidate) =>
      !candidate.closest('ul, header') &&
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

function extractInstagramCaption(caption: HTMLElement, article: HTMLElement, author: string): string {
  const copy = caption.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('button, [role="button"], a[role="button"]').forEach((element) => element.remove());

  const header = article.querySelector('header');
  const authorLinks = Array.from(header?.querySelectorAll<HTMLAnchorElement>('a[href]') || []);
  const authorHrefs = new Set(authorLinks.map((link) => link.getAttribute('href')));
  copy.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const linkText = (link.innerText || link.textContent || '').trim();
    if (authorHrefs.has(link.getAttribute('href')) || linkText === author || linkText === `@${author}`) {
      link.remove();
    }
  });

  return (copy.innerText || copy.textContent || '').trim();
}

export function extractCleanCaptionText(caption: HTMLElement, author: string): string {
  const article = caption.closest<HTMLElement>('article') || caption.parentElement || caption;
  return extractInstagramCaption(caption, article, author);
}

export async function expandInstagramPost(article: HTMLElement): Promise<boolean> {
  return expandInstagramCaption(article, extractInstagramAuthor(article));
}

// ---------------------------------------------------------------------------
// Instagram 작성자 해결 (헤더 우선, 없으면 폴백)
// ---------------------------------------------------------------------------

function resolveInstagramAuthor(article: HTMLElement): string {
  const fromHeader = extractInstagramAuthor(article);
  if (fromHeader) return fromHeader;
  const fallbackEl = article.querySelector('header a, a[role="link"]');
  const fallback = fallbackEl ? (fallbackEl.textContent || '').trim() : '';
  return fallback || '인스타그램 작성자';
}

// ---------------------------------------------------------------------------
// Instagram 게시글 추출 (단일 article)
// ---------------------------------------------------------------------------
export function extractInstagramPost(article: HTMLElement): { data: PostData; element: HTMLElement } | null {
  const author = resolveInstagramAuthor(article);

  // 캡션 본문 (정제된 캡션 -> 실패 시 기존 방식 폴백)
  const caption = findInstagramCaption(article, author);
  let content = caption ? extractInstagramCaption(caption, article, author) : '';
  if (!content) {
    const captionEl = article.querySelector('h1, div._a9zs, span[dir="auto"]');
    content = captionEl ? (captionEl.textContent || '').trim() : '';
  }

  // 게시글 내 모든 첨부 이미지 추출
  const imageUrls = extractInstagramImageUrls(article);

  // 카드뉴스 슬라이드 이미지 alt 태그 수집
  const imgElements = article.querySelectorAll<HTMLImageElement>('img[alt]');
  const mediaAlts: string[] = [];
  imgElements.forEach((img) => {
    const alt = img.getAttribute('alt');
    if (alt && !alt.includes('프로필 사진') && alt.length > 5) {
      mediaAlts.push(alt);
    }
  });

  const combinedMedia = [
    mediaAlts.length > 0 ? `[카드뉴스/이미지 내용]: ${mediaAlts.join('; ')}` : '',
    imageUrls.length > 0 ? `[첨부 이미지 ${imageUrls.length}장 확인됨]` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  // 본문, 미디어 설명, 첨부 이미지 모두 없으면 스킵
  if (!content && !combinedMedia && imageUrls.length === 0) {
    return null;
  }

  // 게시글 고유 URL / ID / shortcode
  let postId = '';
  let shortcode: string | undefined;
  const postLink = article.querySelector<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]');
  if (postLink) {
    const match = postLink.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
    if (match) {
      shortcode = match[2];
      postId = `ig-${match[2]}`;
    }
  }

  if (!postId) {
    postId = `ig-${generateSimpleHash(author + content + imageUrls.join('') + combinedMedia.slice(0, 50))}`;
  }

  article.dataset.detectiumImageCount = String(imageUrls.length);

  return {
    data: {
      id: postId,
      platform: 'instagram',
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

// ---------------------------------------------------------------------------
// Instagram 가시 게시글 전체 스캔 루프
// ---------------------------------------------------------------------------

export async function extractInstagramVisiblePosts(
  forceRescan = false
): Promise<Array<{ data: PostData; element: HTMLElement }>> {
  const extracted: Array<{ data: PostData; element: HTMLElement }> = [];

  // 인스타그램 메인 피드 및 상세 뷰의 게시글 article
  let candidateElements = document.querySelectorAll<HTMLElement>(
    'article, main article, div[role="presentation"] > div > article'
  );
  if (candidateElements.length === 0) {
    // 일부 인스타그램 뷰 대응
    candidateElements = document.querySelectorAll<HTMLElement>(
      'main div[style*="flex-direction: column"] > div'
    );
  }

  for (const el of Array.from(candidateElements)) {
    // 이미 분석 진행 중인 경우 스킵
    if (el.dataset.detectiumStatus === 'pending') {
      continue;
    }

    // 이미 분석 완료된 경우
    if (el.dataset.detectiumStatus === 'done') {
      if (forceRescan) {
        delete el.dataset.detectiumStatus;
      } else {
        // 카드뉴스 다음 슬라이드 등으로 새 이미지가 추가되었는지 확인
        const prevCount = parseInt(el.dataset.detectiumImageCount || '0', 10);
        const currentImagesCount = extractInstagramImageUrls(el).length;
        if (currentImagesCount <= prevCount) {
          continue;
        }
        delete el.dataset.detectiumStatus;
      }
    }

    // 뷰포트 내에 보이는지 검사
    if (!isElementInViewport(el)) {
      continue;
    }

    // 캡션의 "더 보기"를 먼저 펼친 뒤 추출
    await expandInstagramCaption(el, resolveInstagramAuthor(el));
    const parsed = extractInstagramPost(el);

    if (
      parsed &&
      (parsed.data.content.length >= 5 ||
        (parsed.data.imageUrls && parsed.data.imageUrls.length > 0) ||
        (parsed.data.mediaDescription && parsed.data.mediaDescription.length >= 5))
    ) {
      extracted.push(parsed);
    }
  }

  return extracted;
}
