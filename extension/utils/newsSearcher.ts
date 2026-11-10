// Daum 뉴스 검색을 통해 관련 뉴스를 가져와 선동글 판별의 근거로 활용합니다.
// 서비스 워커(background.ts)에서만 호출해야 합니다 (cross-origin fetch 허용 환경).

export interface NewsArticle {
  title: string;
  snippet: string;
  press: string;
  date: string;
}

/** 텍스트에서 검색 키워드를 추출합니다 (최대 50자, 명사구 중심) */
function extractKeywords(text: string): string {
  if (!text || text.trim().length === 0) return '';
  // 특수문자, 이모지, 해시태그 기호, URL 제거
  const cleaned = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#@]\S+/g, '')
    .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 앞에서 최대 60자를 쿼리로 사용 (Daum 검색에 적합)
  return cleaned.slice(0, 60).trim();
}

/** HTML 엔티티를 디코딩합니다 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** HTML 태그를 제거하고 순수 텍스트만 반환합니다 */
function stripTags(html: string | undefined): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

/**
 * Daum 뉴스 검색에서 관련 기사를 최대 5건 가져옵니다.
 * @param query 게시글 본문 또는 OCR 텍스트에서 추출한 검색 쿼리
 * @param timeoutMs 최대 대기 시간 (기본값: 5000ms)
 */
export async function fetchRelatedDaumNews(
  query: string,
  timeoutMs = 5000
): Promise<NewsArticle[]> {
  const keywords = extractKeywords(query);
  if (!keywords || keywords.length < 4) {
    console.log('[Detectium][newsSearcher] 키워드가 너무 짧아 뉴스 검색 생략:', JSON.stringify(keywords));
    return [];
  }

  const searchUrl = `https://search.daum.net/search?w=news&q=${encodeURIComponent(keywords)}&sort=recency`;
  console.log('[Detectium][newsSearcher] Daum 뉴스 검색:', searchUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let html: string;
  try {
    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        // Daum이 일반 브라우저 요청으로 인식하도록 User-Agent 설정
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn('[Detectium][newsSearcher] Daum 뉴스 HTTP 오류:', res.status);
      return [];
    }
    html = await res.text();
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error)?.name === 'AbortError') {
      console.warn('[Detectium][newsSearcher] Daum 뉴스 검색 타임아웃 (5초 초과)');
    } else {
      console.warn('[Detectium][newsSearcher] Daum 뉴스 fetch 실패:', err);
    }
    return [];
  }

  return parseDaumNewsHtml(html);
}

/**
 * Daum 검색 결과 HTML을 파싱하여 뉴스 기사 목록을 반환합니다.
 * 최대 5건까지만 반환합니다.
 */
function parseDaumNewsHtml(html: string): NewsArticle[] {
  const articles: NewsArticle[] = [];

  // 뉴스 아이템 블록 단위로 추출 (각 기사는 class에 "item-" 또는 "wrap_cont" 등을 포함)
  // Daum 검색 HTML에서 뉴스 기사 블록: <li class="..."> ... </li> 또는 <div class="item-title">
  // 타이틀: <strong class="tit-g clamp-g"><a ...>제목</a></strong>
  // 스니펫: <p class="conts-desc clamp-g2"><a ...>요약</a></p>  또는 <p class="conts-desc ...">
  // 날짜 및 언론사: <span class="txt_info">언론사</span> <span class="txt_info">날짜</span>

  const titlePattern = /<strong[^>]*class="[^"]*tit-g[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern = /<p[^>]*class="[^"]*conts-desc[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g;
  // 언론사+날짜 패턴: 연속된 txt_info span들을 순서대로 추출
  const infoBlockPattern = /(<span[^>]*class="[^"]*txt_info[^"]*"[^>]*>[\s\S]*?<\/span>\s*){1,4}/g;

  const titles: string[] = [];
  const snippets: string[] = [];
  const infoBlocks: string[][] = []; // 각 기사의 [언론사?, 날짜?] 배열

  let m: RegExpExecArray | null;

  // 제목 추출
  titlePattern.lastIndex = 0;
  while ((m = titlePattern.exec(html)) !== null) {
    if (m[1] != null) titles.push(stripTags(m[1]));
    if (titles.length >= 5) break;
  }

  // 스니펫 추출
  snippetPattern.lastIndex = 0;
  while ((m = snippetPattern.exec(html)) !== null) {
    if (m[1] != null) snippets.push(stripTags(m[1]));
    if (snippets.length >= 5) break;
  }

  // 언론사 / 날짜 블록 추출
  // txt_info span의 개별 텍스트만 모아서 기사별로 묶기
  const singleInfoPattern = /<span[^>]*class="[^"]*txt_info[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
  const allInfoTexts: string[] = [];
  singleInfoPattern.lastIndex = 0;
  while ((m = singleInfoPattern.exec(html)) !== null) {
    if (m[1] == null) continue;
    const t = stripTags(m[1]);
    if (t) allInfoTexts.push(t);
  }

  // txt_info가 기사당 2개씩(언론사, 날짜) 나오는 패턴 처리
  for (let i = 0; i < allInfoTexts.length; i += 2) {
    infoBlocks.push([allInfoTexts[i] ?? '', allInfoTexts[i + 1] ?? '']);
    if (infoBlocks.length >= 5) break;
  }

  const count = Math.min(titles.length, 5);
  for (let i = 0; i < count; i++) {
    const title = titles[i] ?? '';
    const snippet = snippets[i] ?? '';
    const press = infoBlocks[i]?.[0] ?? '';
    const date = infoBlocks[i]?.[1] ?? '';
    if (title) {
      articles.push({ title, snippet, press, date });
    }
  }

  console.log(`[Detectium][newsSearcher] 파싱된 뉴스 기사 수: ${articles.length}건`);
  return articles;
}

/** 뉴스 기사 배열을 프롬프트용 텍스트로 변환합니다 */
export function formatNewsForPrompt(articles: NewsArticle[]): string {
  if (articles.length === 0) return '';
  return articles
    .map(
      (a, i) =>
        `${i + 1}. [제목] ${a.title}${a.press ? ` [언론사] ${a.press}` : ''}${a.date ? ` [날짜] ${a.date}` : ''}${a.snippet ? `\n   [요약] ${a.snippet}` : ''}`
    )
    .join('\n');
}
