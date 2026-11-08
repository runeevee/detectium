export interface PostData {
  id: string;
  platform: 'x' | 'instagram' | 'generic';
  author: string;
  title?: string;
  content: string;
  mediaDescription?: string;
  imageUrls?: string[];
  imagesBase64?: string[];
  extractedImageText?: string;
  url?: string;
}

export interface AnalysisResult {
  id: string;
  isFakeOrMisleading: boolean;
  category: '선동성 게시글' | '선동 및 여론 조작' | '통계 왜곡' | '가짜뉴스 / 허위사실' | '과장 및 맥락 왜곡' | '정상' | string;
  riskScore: number; // 0 ~ 100
  summary: string;
  details: string;
  checkedPoints?: string[];
  extractedImageText?: string;
}

export interface AnalyzePostsRequest {
  type: 'ANALYZE_POSTS_REQUEST';
  posts: PostData[];
}

export interface AnalyzePostsResponse {
  success: boolean;
  results?: AnalysisResult[];
  error?: string;
}
