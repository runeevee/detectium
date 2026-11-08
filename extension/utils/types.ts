export interface PostData {
  id: string;
  platform: 'x' | 'instagram' | 'youtube' | 'generic';
  author: string;
  title?: string;
  content: string;
  mediaDescription?: string;
  imageUrls?: string[];
  imagesBase64?: string[];
  extractedImageText?: string;
  url?: string;
  shortcode?: string;
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

/**
 * 사용자가 스캔한 게시글의 상세 메타데이터 및 팩트체크 전달 상태
 */
export interface ScannedPostItem {
  id: string;
  platform: 'x' | 'instagram' | 'youtube' | 'generic';
  author: string;
  content: string;
  contentLength: number;
  url?: string;
  shortcode?: string;
  mediaDescription?: string;
  isVisible: boolean;
  extractionSuccess: boolean;
  status: 'extracted' | 'api_sent' | 'analyzed' | 'analysis_failed' | 'extraction_failed';
  timestamp: number;
  domSelector?: string;
  analysisResult?: AnalysisResult;
  failureReason?: string;
}
