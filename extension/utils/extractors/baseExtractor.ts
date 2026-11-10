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

  /**
   * 추출한 게시글에 플랫폼별 미디어 정보를 추가합니다.
   */
  protected async enrichPost?(_post: ExtractedPost): Promise<void>;

  /**
   * 유효한 게시글인지 검증 (본문 5자 이상 or 첨부 이미지 존재 or 미디어 설명 5자 이상)
   */
  protected isValidPost(post: ExtractedPost): boolean {
    const { data } = post;
    return Boolean(
      (data.content && data.content.length >= 5) ||
      (data.imageUrls && data.imageUrls.length > 0) ||
      (data.mediaDescription && data.mediaDescription.length >= 5)
    );
  }

  /**
   * 현재 뷰포트에 표시된 유효 게시글들을 스캔하여 구조화
   */
  async extractVisiblePosts(forceRescan = false): Promise<ExtractedPost[]> {
    const candidateElements = this.getCandidateElements();
    const extracted: ExtractedPost[] = [];

    for (const el of candidateElements) {
      // 이미 분석 진행 중인 경우 스킵
      if (el.dataset.detectiumStatus === "pending") {
        continue;
      }

      // 이미 분석 완료된 경우
      if (el.dataset.detectiumStatus === "done") {
        if (forceRescan) {
          delete el.dataset.detectiumStatus;
        } else {
          // 카드뉴스 다음 슬라이드 등으로 새 이미지가 추가되었는지 확인
          const prevCount = parseInt(el.dataset.detectiumImageCount || "0", 10);
          const currentImagesCount = this.getImageUrls(el).length;
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

      // 추출 전 전처리 (예: 본문 펼치기)
      if (this.beforeExtract) {
        await this.beforeExtract(el);
      }

      const parsed = this.extractPost(el);
      if (parsed && this.isValidPost(parsed)) {
        if (this.enrichPost) {
          await this.enrichPost(parsed);
        }
        extracted.push(parsed);
      }
    }

    return extracted;
  }
}
