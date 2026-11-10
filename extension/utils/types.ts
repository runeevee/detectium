export interface PostData {
  id: string;
  platform: "x" | "instagram" | "youtube" | "generic";
  author: string;
  title?: string;
  content: string;
  mediaDescription?: string;
  imageUrls?: string[];
  videoFrames?: VideoFrame[];
  imagesBase64?: string[];
  extractedImageText?: string;
  url?: string;
  shortcode?: string;
}

export interface VideoFrame {
  timestampSeconds: number;
  dataUrl: string;
}

export interface AnalysisResult {
  id: string;
  riskScore: number; // 0 ~ 100
  details: string;
  checkedPoints?: string[];
  extractedImageText?: string;
}

export interface AnalyzePostsRequest {
  type: "ANALYZE_POSTS_REQUEST";
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
  platform: "x" | "instagram" | "youtube" | "generic";
  author: string;
  content: string;
  contentLength: number;
  url?: string;
  shortcode?: string;
  mediaDescription?: string;
  isVisible: boolean;
  extractionSuccess: boolean;
  status: "extracted" | "api_sent" | "analyzed" | "analysis_failed" | "extraction_failed";
  timestamp: number;
  domSelector?: string;
  analysisResult?: AnalysisResult;
  failureReason?: string;
}