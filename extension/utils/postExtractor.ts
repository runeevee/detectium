import type { PostData } from './types';

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function cleanPostText(text: string): string {
  if (!text) return '';
  return text
    .replace(/(\.{2,}|…)?\s*(더\s*보기|자세히\s*보기|more|show\s*more|read\s*more)\s*$/gi, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 플랫폼 판별
export function getPlatform(): 'x' | 'instagram' | 'generic' {
  const host = window.location.hostname;
  if (host.includes('twitter.com') || host.includes('x.com')) {
    return 'x';
  }
  if (host.includes('instagram.com')) {
    return 'instagram';
  }
  return 'generic';
}

// 요소가 화면(뷰포트)에 일정 부분 노출되어 있는지 확인
export function isElementInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  const isVisibleY = rect.bottom > 40 && rect.top < windowHeight - 40;
  const isVisibleX = rect.right > 0 && rect.left < windowWidth;

  return isVisibleY && isVisibleX && rect.height > 20 && rect.width > 50;
}

// 단순 고유 ID 해시 생성
function generateSimpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// X (구 Twitter) 게시글 추출
function extractXPost(article: HTMLElement): { data: PostData; element: HTMLElement } | null {
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const author = userNameEl ? (userNameEl.textContent || '').replace(/\s+/g, ' ').trim() : '알 수 없음';

  const textEl = article.querySelector('[data-testid="tweetText"]');
  const content = textEl ? (textEl.textContent || '').trim() : '';

  const imgElements = article.querySelectorAll<HTMLImageElement>(
    '[data-testid="tweetPhoto"] img, [data-testid="tweet"] img[alt]'
  );
  const mediaAlts: string[] = [];
  imgElements.forEach((img) => {
    const alt = img.getAttribute('alt');
    if (alt && !alt.startsWith('이미지') && !alt.startsWith('프로필')) {
      mediaAlts.push(alt);
    }
  });

  const cardDetail = article.querySelector('[data-testid*="card"]');
  const cardText = cardDetail ? (cardDetail.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const combinedMedia = [
    mediaAlts.length > 0 ? `[이미지 설명]: ${mediaAlts.join('; ')}` : '',
    cardText ? `[첨부 카드/기사]: ${cardText}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  if (!content && !combinedMedia) {
    return null;
  }

  const statusLink = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  const statusMatch = statusLink?.href.match(/\/status\/(\d+)/);
  const tweetId = statusMatch
    ? `x-${statusMatch[1]}`
    : `x-${generateSimpleHash(author + content + combinedMedia.slice(0, 50))}`;

  return {
    data: {
      id: tweetId,
      platform: 'x',
      author,
      content,
      mediaDescription: combinedMedia,
      url: statusLink ? statusLink.href : undefined,
    },
    element: article,
  };
}

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
    candidates.sort((a, b) => (b.innerText || b.textContent || '').length - (a.innerText || a.textContent || '').length)[0] ||
    null
  );
}

export function extractInstagramAuthor(article: HTMLElement): string {
  const header = article.querySelector('header');
  const authorLink = header?.querySelector<HTMLAnchorElement>('a[href]');
  return (authorLink?.textContent || '').trim();
}

export function findInstagramCaptionContainer(article: HTMLElement, author: string): HTMLElement | null {
  return findInstagramCaption(article, author);
}

function isClickableMoreButton(element: HTMLElement): boolean {
  if (!element.isConnected || element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
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

const expandedInstagramPosts = new WeakSet<HTMLElement>();

async function expandInstagramCaption(article: HTMLElement, author: string): Promise<boolean> {
  if (expandedInstagramPosts.has(article)) {
    return false;
  }

  const caption = findInstagramCaption(article, author);
  if (!caption) {
    return false;
  }

  const captionScope = caption.closest<HTMLElement>('div._a9zs') || caption.parentElement;
  if (!captionScope || captionScope === article || !article.contains(captionScope) || captionScope.closest('ul')) {
    return false;
  }

  const candidates = [
    ...(captionScope.matches('button, [role="button"], a, span')
      ? [captionScope]
      : []),
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

export async function expandYouTubePost(container: HTMLElement): Promise<boolean> {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>('button, [role="button"], tp-yt-paper-button, #expand, #more')
  );
  const moreButton = candidates.find((candidate) => {
    const label = (candidate.innerText || candidate.textContent || '').trim();
    return /^(?:\.{2,}\s*)?(?:more|show more|read more)$/i.test(label) && isClickableMoreButton(candidate);
  });
  if (!moreButton) {
    return false;
  }

  moreButton.click();
  await wait(250);
  return true;
}

// Instagram 피드/게시글 추출
function extractInstagramPost(article: HTMLElement): { data: PostData; element: HTMLElement } | null {
  const headerAuthorEl = article.querySelector('header a, a[role="link"]');
  const author = headerAuthorEl ? (headerAuthorEl.textContent || '').trim() : '인스타그램 작성자';
  const caption = findInstagramCaption(article, author);
  const content = caption ? extractInstagramCaption(caption, article, author) : '';

  const imgElements = article.querySelectorAll<HTMLImageElement>('img[alt]');
  const mediaAlts: string[] = [];
  imgElements.forEach((img) => {
    const alt = img.getAttribute('alt');
    if (alt && !alt.includes('프로필 사진') && alt.length > 5) {
      mediaAlts.push(alt);
    }
  });
  const combinedMedia = mediaAlts.length > 0 ? `[카드뉴스/이미지 내용]: ${mediaAlts.join('; ')}` : '';

  if (!content && !combinedMedia) {
    return null;
  }

  const postLink = article.querySelector<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]');
  const postMatch = postLink?.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
  const shortcode = postMatch?.[2];
  const postId = shortcode
    ? `ig-${shortcode}`
    : `ig-${generateSimpleHash(author + content + combinedMedia.slice(0, 50))}`;

  return {
    data: {
      id: postId,
      platform: 'instagram',
      author,
      content,
      mediaDescription: combinedMedia,
      url: postLink ? postLink.href : undefined,
      shortcode,
    },
    element: article,
  };
}

// 범용 웹사이트 게시글 추출
function extractGenericPost(article: HTMLElement): { data: PostData; element: HTMLElement } | null {
  const text = (article.textContent || '').trim();
  if (text.length < 30) return null;

  const titleEl = article.querySelector('h1, h2, h3, .title');
  const title = titleEl ? (titleEl.textContent || '').trim() : '';
  const id = `gen-${generateSimpleHash(text.slice(0, 100))}`;

  return {
    data: {
      id,
      platform: 'generic',
      author: '웹사이트',
      title,
      content: text.slice(0, 1000),
    },
    element: article,
  };
}

// 현재 페이지에서 가시 영역에 있는 후보 게시글 요소들을 탐색하여 구조화
export async function extractVisiblePosts(
  forceRescan = false
): Promise<Array<{ data: PostData; element: HTMLElement }>> {
  const platform = getPlatform();
  const extracted: Array<{ data: PostData; element: HTMLElement }> = [];
  let candidateElements: NodeListOf<HTMLElement>;

  if (platform === 'x') {
    candidateElements = document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');
  } else if (platform === 'instagram') {
    candidateElements = document.querySelectorAll<HTMLElement>(
      'article, main article, div[role="presentation"] > div > article'
    );
    if (candidateElements.length === 0) {
      candidateElements = document.querySelectorAll<HTMLElement>('main div[style*="flex-direction: column"] > div');
    }
  } else {
    candidateElements = document.querySelectorAll<HTMLElement>('article, [role="article"], .post, .card');
  }

  for (const element of Array.from(candidateElements)) {
    if (element.dataset.detectiumStatus === 'pending' || (element.dataset.detectiumStatus === 'done' && !forceRescan)) {
      continue;
    }
    if (!isElementInViewport(element)) {
      continue;
    }

    let parsed: { data: PostData; element: HTMLElement } | null = null;
    if (platform === 'x') {
      parsed = extractXPost(element);
    } else if (platform === 'instagram') {
      const authorElement = element.querySelector('header a, a[role="link"]');
      const author = authorElement ? (authorElement.textContent || '').trim() : '인스타그램 작성자';
      await expandInstagramCaption(element, author);
      parsed = extractInstagramPost(element);
    } else {
      parsed = extractGenericPost(element);
    }

    if (
      parsed &&
      (parsed.data.content.length >= 10 ||
        (parsed.data.mediaDescription && parsed.data.mediaDescription.length >= 10))
    ) {
      extracted.push(parsed);
    }
  }

  return extracted;
}
