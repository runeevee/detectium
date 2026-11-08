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

// 이미지 URL 추출 헬퍼 (X/Twitter)
function extractXImageUrls(article: HTMLElement): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const imgElements = article.querySelectorAll<HTMLImageElement>(
    '[data-testid="tweetPhoto"] img, [data-testid="card.layoutLarge.media"] img, img[src*="pbs.twimg.com/media/"]'
  );

  imgElements.forEach((img) => {
    if (img.closest('[data-testid="Tweet-User-Avatar"]')) return;
    const alt = (img.getAttribute('alt') || '').toLowerCase();
    if (alt.includes('프로필') || alt.includes('profile')) return;

    let bestUrl = img.currentSrc || img.src || '';
    if (bestUrl.includes('pbs.twimg.com/media/')) {
      try {
        const parsed = new URL(bestUrl);
        if (parsed.searchParams.has('name') && parsed.searchParams.get('name') === 'small') {
          parsed.searchParams.set('name', 'large');
          bestUrl = parsed.toString();
        }
      } catch {
        // URL 파싱 에러 무시
      }
    }

    if (bestUrl && bestUrl.startsWith('http') && !seen.has(bestUrl)) {
      seen.add(bestUrl);
      urls.push(bestUrl);
    }
  });

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

// 이미지 URL 추출 헬퍼 (Instagram)
function extractInstagramImageUrls(article: HTMLElement): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  // 인스타그램 게시글 내 모든 이미지 탐색
  const imgElements = article.querySelectorAll<HTMLImageElement>('img');
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

// 이미지 URL 추출 헬퍼 (Generic)
function extractGenericImageUrls(article: HTMLElement): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const imgElements = article.querySelectorAll<HTMLImageElement>('img');
  imgElements.forEach((img) => {
    if (img.closest('header, footer, nav, aside')) return;
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 150) return;
    const src = img.currentSrc || img.src || '';
    if (src && src.startsWith('http') && !seen.has(src)) {
      seen.add(src);
      urls.push(src);
    }
  });
  return urls.slice(0, 4);
}

// X (구 Twitter) 게시글 추출
function extractXPost(article: HTMLElement): { data: PostData; element: HTMLElement } | null {
  // 작성자 정보
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const author = userNameEl ? (userNameEl.textContent || '').replace(/\s+/g, ' ').trim() : '알 수 없음';

  // 본문 텍스트
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const content = textEl ? (textEl.textContent || '').trim() : '';

  // 첨부된 모든 이미지 URL 추출
  const imageUrls = extractXImageUrls(article);

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
    imageUrls.length > 0 ? `[첨부 이미지 ${imageUrls.length}장 확인됨]` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  // 본문, 미디어, 첨부 이미지 모두 없으면 스킵
  if (!content && !combinedMedia && imageUrls.length === 0) {
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
    tweetId = `x-${generateSimpleHash(author + content + imageUrls.join('') + combinedMedia.slice(0, 50))}`;
  }

  article.dataset.detectiumImageCount = String(imageUrls.length);

  return {
    data: {
      id: tweetId,
      platform: 'x',
      author,
      content,
      mediaDescription: combinedMedia,
      imageUrls,
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
    },
    element: article,
  };
}

// 범용 웹사이트 게시글 추출
function extractGenericPost(article: HTMLElement): { data: PostData; element: HTMLElement } | null {
  const text = (article.textContent || '').trim();
  const imageUrls = extractGenericImageUrls(article);

  if (text.length < 30 && imageUrls.length === 0) return null;

  const titleEl = article.querySelector('h1, h2, h3, .title');
  const title = titleEl ? (titleEl.textContent || '').trim() : '';

  const id = `gen-${generateSimpleHash(text.slice(0, 100) + imageUrls.join(''))}`;

  return {
    data: {
      id,
      platform: 'generic',
      author: '웹사이트',
      title,
      content: text.slice(0, 1000),
      imageUrls,
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
    // 이미 분석 진행 중인 경우 스킵
    if (el.dataset.detectiumStatus === 'pending') {
      return;
    }

    // 이미 분석 완료된 경우, 카드뉴스 다음 슬라이드 등으로 새 이미지가 추가되었는지 확인
    if (el.dataset.detectiumStatus === 'done') {
      const prevCount = parseInt(el.dataset.detectiumImageCount || '0', 10);
      let currentImagesCount = 0;
      if (platform === 'instagram') {
        currentImagesCount = extractInstagramImageUrls(el).length;
      } else if (platform === 'x') {
        currentImagesCount = extractXImageUrls(el).length;
      }
      // 새 이미지가 추가되지 않았으면 스킵
      if (currentImagesCount <= prevCount) {
        return;
      }
      // 새 이미지가 추가되었으므로 재분석을 위해 status 해제
      delete el.dataset.detectiumStatus;
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

    // 본문 내용이 있거나, 첨부 이미지가 있거나, 미디어 설명이 있는 경우 분석 대상에 포함
    if (
      parsed &&
      (parsed.data.content.length >= 5 ||
        (parsed.data.imageUrls && parsed.data.imageUrls.length > 0) ||
        (parsed.data.mediaDescription && parsed.data.mediaDescription.length >= 5))
    ) {
      extracted.push(parsed);
    }
  });

  return extracted;
}
