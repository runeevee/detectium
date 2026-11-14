export interface PostData {
  id: string;
  platform: "x" | "instagram" | "youtube" | "threads" | "thread" | "generic";
  content: string;
  imageUrls?: string[];
}

export interface AnalysisResult {
  id: string;
  isCredible: boolean;
  description: string;
  analysisContent: {
    violatedPoints: string[];
  };
  extractedImageText?: string;
  links?: string[];
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
  platform: "x" | "instagram" | "youtube" | "threads" | "thread" | "generic";
  content: string;
  contentLength: number;
  isVisible: boolean;
  extractionSuccess: boolean;
  status: "extracted" | "api_sent" | "analyzed" | "analysis_failed" | "extraction_failed";
  timestamp: number;
  domSelector?: string;
  analysisResult?: AnalysisResult;
  failureReason?: string;
}