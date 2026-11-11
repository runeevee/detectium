import type { PostData } from "../types";

export interface ExtractedPost {
  data: PostData;
  element: HTMLElement;
}

export interface PostExtractor {
  readonly platform: PostData["platform"];
  canHandle(hostname: string): boolean;
  extractPost(element: HTMLElement): ExtractedPost | null;
  extractVisiblePosts(): Promise<ExtractedPost[]>;
}
