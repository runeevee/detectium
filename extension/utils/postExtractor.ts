import type { PostData } from './types';

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

  // 세로축으로 최소 40px 이상 보이고 가로축도 화면 안에 걸쳐있는지 확인
  const isVisibleY = rect.bottom > 40 && rect.top < (windowHeight - 40);
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
  // 작성자 정보
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const author = userNameEl ? (userNameEl.textContent || '').replace(/\s+/g, ' ').trim() : '알 수 없음';

  // 본문 텍스트
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const content = textEl ? (textEl.textContent || '').trim() : '';

  // 이미지/미디어 설명 (alt 태그)
  const imgElements = article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img, [data-testid="tweet"] img[alt]');
  const mediaAlts: string[] = [];
  imgElements.forEach((img) => {
    const alt = img.getAttribute('alt');
    if (alt && !alt.startsWith('이미지') && !alt.startsWith('프로필')) {
      mediaAlts.push(alt);
    }
  });

  // 링크 카드 (뉴스 기사 미리보기 등)
  const cardDetail = article.querySelector('[data-testid*="card"]');
  let cardText = '';
  if (cardDetail) {
    cardText = (cardDetail.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // 결합된 미디어 정보
  const combinedMedia = [
    mediaAlts.length > 0 ? `[이미지 설명]: ${mediaAlts.join('; ')}` : '',
    cardText ? `[첨부 카드/기사]: ${cardText}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  // 본문이나 미디어 둘 다 유의미한 내용이 없으면 스킵
  if (!content && !combinedMedia) {
    return null;
  }

  // 트윗 고유 ID
  let tweetId = '';
  const statusLink = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  if (statusLink) {
    const match = statusLink.href.match(/\/status\/(\d+)/);
    if (match) {
      tweetId = `x-${match[1]}`;
    }
  }

  if (!tweetId) {
    tweetId = `x-${generateSimpleHash(author + content + combinedMedia.slice(0, 50))}`;
  }

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

// Instagram 피드/게시글 추출
function extractInstagramPost(article: HTMLElement): { data: PostData; element: HTMLElement } | null {
  // 작성자 헤더
  const headerAuthorEl = article.querySelector('header a, a[role="link"]');
  const author = headerAuthorEl ? (headerAuthorEl.textContent || '').trim() : '인스타그램 작성자';

  // 캡션 본문 (인스타그램 상세 뷰의 h1, 혹은 캡션 텍스트 블록)
  const captionEl = article.querySelector('h1, div._a9zs, span[dir="auto"]');
  const content = captionEl ? (captionEl.textContent || '').trim() : '';

  // 카드뉴스 슬라이드 이미지 alt 태그 수집
  const imgElements = article.querySelectorAll<HTMLImageElement>('img[alt]');
  const mediaAlts: string[] = [];
  imgElements.forEach((img) => {
    const alt = img.getAttribute('alt');
    // 인스타그램 기본 "프로필 사진", "May be an image of..." 등 정제
    if (alt && !alt.includes('프로필 사진') && alt.length > 5) {
      mediaAlts.push(alt);
    }
  });

  const combinedMedia = mediaAlts.length > 0 ? `[카드뉴스/이미지 내용]: ${mediaAlts.join('; ')}` : '';

  if (!content && !combinedMedia) {
    return null;
  }

  // 게시글 고유 URL / ID
  let postId = '';
  const postLink = article.querySelector<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]');
  if (postLink) {
    const match = postLink.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
    if (match) {
      postId = `ig-${match[2]}`;
    }
  }

  if (!postId) {
    postId = `ig-${generateSimpleHash(author + content + combinedMedia.slice(0, 50))}`;
  }

  return {
    data: {
      id: postId,
      platform: 'instagram',
      author,
      content,
      mediaDescription: combinedMedia,
      url: postLink ? postLink.href : undefined,
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
export function extractVisiblePosts(): Array<{ data: PostData; element: HTMLElement }> {
  const platform = getPlatform();
  const extracted: Array<{ data: PostData; element: HTMLElement }> = [];

  let candidateElements: NodeListOf<HTMLElement>;

  if (platform === 'x') {
    candidateElements = document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');
  } else if (platform === 'instagram') {
    // 인스타그램 메인 피드 및 상세 뷰의 게시글 article
    candidateElements = document.querySelectorAll<HTMLElement>('article, main article, div[role="presentation"] > div > article');
    if (candidateElements.length === 0) {
      // 일부 인스타그램 뷰 대응
      candidateElements = document.querySelectorAll<HTMLElement>('main div[style*="flex-direction: column"] > div');
    }
  } else {
    candidateElements = document.querySelectorAll<HTMLElement>('article, [role="article"], .post, .card');
  }

  candidateElements.forEach((el) => {
    // 이미 분석 진행 중이거나 완료된 경우 스킵
    if (el.dataset.detectiumStatus === 'pending' || el.dataset.detectiumStatus === 'done') {
      return;
    }

    // 뷰포트 내에 보이는지 검사
    if (!isElementInViewport(el)) {
      return;
    }

    let parsed: { data: PostData; element: HTMLElement } | null = null;
    if (platform === 'x') {
      parsed = extractXPost(el);
    } else if (platform === 'instagram') {
      parsed = extractInstagramPost(el);
    } else {
      parsed = extractGenericPost(el);
    }

    if (parsed && (parsed.data.content.length >= 10 || (parsed.data.mediaDescription && parsed.data.mediaDescription.length >= 10))) {
      extracted.push(parsed);
    }
  });

  return extracted;
}
