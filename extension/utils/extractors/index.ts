import type { ExtractedPost, PostExtractor } from "./types";
import { xExtractor } from "./x-extractor";
import { instagramExtractor } from "./instagram-extractor";
import { threadsExtractor } from "./threads-extractor";
import { genericExtractor } from "./generic-extractor";

export * from "./types";
export * from "./common";
export * from "./base-extractor";
export * from "./x-extractor";
export * from "./instagram-extractor";
export * from "./threads-extractor";
export * from "./generic-extractor";

// 기본 등록된 Extractor 목록 (우선순위 순서)
const registeredExtractors: PostExtractor[] = [
  xExtractor,
  instagramExtractor,
  threadsExtractor,
];

/**
 * 새로운 Extractor를 우선순위 상단에 등록
 */
export function registerExtractor(extractor: PostExtractor): void {
  const index = registeredExtractors.findIndex((e) => e.platform === extractor.platform);
  if (index !== -1) {
    registeredExtractors.splice(index, 1);
  }
  registeredExtractors.unshift(extractor);
}

/**
 * 현재 호스트명/URL에 적합한 PostExtractor 반환
 */
export function getExtractor(hostname?: string): PostExtractor {
  const targetHost = hostname || (typeof window !== "undefined" ? window.location.hostname : "");

  for (const extractor of registeredExtractors) {
    if (extractor.canHandle(targetHost)) {
      return extractor;
    }
  }

  return genericExtractor;
}

/**
 * 현재 페이지의 활성 플랫폼 Extractor를 통해 가시 영역의 게시글들을 추출합니다.
 */
export async function extractVisiblePosts(): Promise<ExtractedPost[]> {
  const extractor = getExtractor();
  return extractor.extractVisiblePosts();
}
