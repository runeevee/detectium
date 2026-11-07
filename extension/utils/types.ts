export interface PostData {
  id: string;
  platform: 'x' | 'instagram' | 'generic';
  author: string;
  title?: string;
  content: string;
  mediaDescription?: string;
  url?: string;
}

export interface AnalysisResult {
  id: string;
  isFakeOrMisleading: boolean;
  category: '통계 왜곡' | '가짜뉴스 / 허위사실' | '과장 및 맥락 왜곡' | '정상' | string;
  riskScore: number; // 0 ~ 100
  summary: string;
  details: string;
  checkedPoints?: string[];
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
