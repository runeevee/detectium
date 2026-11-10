import type { ExtractedPost } from './types';
import { BasePostExtractor } from './baseExtractor';
import { generateSimpleHash } from './common';

/**
 * 이미지 URL 추출 헬퍼 (Generic)
 */
export function extractGenericImageUrls(article: HTMLElement): string[] {
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

/**
 * 범용 웹사이트 게시글 추출
 */
export function extractGenericPost(article: HTMLElement): ExtractedPost | null {
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

/**
 * 범용 웹사이트용 Extractor 구현체 (Fallback)
 */
export class GenericExtractor extends BasePostExtractor {
  readonly platform = 'generic' as const;

  canHandle(_hostname: string): boolean {
    return true;
  }

  getCandidateElements(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('article, [role="article"], .post, .card'));
  }

  getImageUrls(article: HTMLElement): string[] {
    return extractGenericImageUrls(article);
  }

  extractPost(article: HTMLElement): ExtractedPost | null {
    return extractGenericPost(article);
  }
}

export const genericExtractor = new GenericExtractor();
