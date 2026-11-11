import type { PostData } from "../types";
import type { ExtractedPost, PostExtractor } from "./types";
import { isElementInViewport } from "./common";

export abstract class BasePostExtractor implements PostExtractor {
  abstract readonly platform: PostData["platform"];

  abstract canHandle(hostname: string): boolean;

  abstract getCandidateElements(): HTMLElement[];

  abstract extractPost(element: HTMLElement): ExtractedPost | null;

  abstract getImageUrls(element: HTMLElement): string[];

  /**
   * 요소에서 게시글을 추출하기 전 수행할 비동기 작업(예: '더 보기' 캡션 확장 등)
   */
  protected async beforeExtract?(_element: HTMLElement): Promise<void>;

  /** 캡션이 5자 이상이거나 첨부 이미지가 있는 게시글만 추출합니다. */
  protected isValidPost(post: ExtractedPost): boolean {
    const { data } = post;
    return Boolean(
      data.content.trim().length >= 5 ||
      data.imageUrls?.length
    );
  }

  /**
   * 현재 뷰포트에 표시된 유효 게시글들을 스캔하여 구조화
   */
  async extractVisiblePosts(): Promise<ExtractedPost[]> {
    const candidateElements = this.getCandidateElements();
    const extracted: ExtractedPost[] = [];
    const visibleIndexes = candidateElements
      .map((element, index) => (isElementInViewport(element) ? index : -1))
      .filter((index) => index >= 0);

    if (visibleIndexes.length === 0) {
      return extracted;
    }

    const firstIndex = Math.max(0, visibleIndexes[0] - 2);
    const lastIndex = Math.min(
      candidateElements.length - 1,
      visibleIndexes[visibleIndexes.length - 1] + 2
    );
    const visibleIndexSet = new Set(visibleIndexes);
    const viewportCenterY = window.innerHeight / 2;
    const prioritizedCandidates = candidateElements
      .slice(firstIndex, lastIndex + 1)
      .map((element, offset) => ({ element, index: firstIndex + offset }))
      .sort((a, b) => {
        const aVisible = visibleIndexSet.has(a.index);
        const bVisible = visibleIndexSet.has(b.index);
        if (aVisible !== bVisible) {
          return aVisible ? -1 : 1;
        }

        if (!aVisible) {
          const aDistance =
            a.index < visibleIndexes[0]
              ? visibleIndexes[0] - a.index
              : a.index - visibleIndexes[visibleIndexes.length - 1];
          const bDistance =
            b.index < visibleIndexes[0]
              ? visibleIndexes[0] - b.index
              : b.index - visibleIndexes[visibleIndexes.length - 1];
          if (aDistance !== bDistance) {
            return aDistance - bDistance;
          }
        }

        const aRect = a.element.getBoundingClientRect();
        const bRect = b.element.getBoundingClientRect();
        const aDistance = Math.abs((aRect.top + aRect.bottom) / 2 - viewportCenterY);
        const bDistance = Math.abs((bRect.top + bRect.bottom) / 2 - viewportCenterY);
        return aDistance - bDistance;
      });

    for (const { element: el } of prioritizedCandidates) {
      // 이미 분석 진행 중인 경우 스킵
      if (el.dataset.detectiumStatus === "pending") {
        continue;
      }

      if (el.dataset.detectiumStatus === "skipped") {
        continue;
      }

      if (el.dataset.detectiumStatus === "failed") {
        continue;
      }

      // 이미 분석 완료된 경우
      if (el.dataset.detectiumStatus === "done") {
        // 카드뉴스 다음 슬라이드 등으로 새 이미지가 추가되었는지 확인
        const prevCount = parseInt(el.dataset.detectiumImageCount || "0", 10);
        const currentImagesCount = this.getImageUrls(el).length;
        if (currentImagesCount <= prevCount) {
          continue;
        }
        delete el.dataset.detectiumStatus;
      }

      // 추출 전 전처리 (예: 본문 펼치기)
      if (this.beforeExtract) {
        await this.beforeExtract(el);
      }

      const parsed = this.extractPost(el);
      if (parsed && this.isValidPost(parsed)) {
        extracted.push(parsed);
      }
    }

    return extracted;
  }
}
