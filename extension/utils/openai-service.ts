import { SERVER_API_URL } from "./constants";
import type { PostData, AnalysisResult } from "./types";

// ArrayBuffer -> Base64 안전 변환 (대용량 이미지 콜스택 초과 방지)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

// 이미지 URL을 가져와서 리사이징 및 Base64 Data URL로 변환
async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) return null;
    const blob = await res.blob();
    const mime = blob.type || "image/jpeg";

    if (typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined") {
      try {
        const bitmap = await createImageBitmap(blob);
        const width = Math.max(1, Math.floor(bitmap.width / 2));
        const height = Math.max(1, Math.floor(bitmap.height / 2));

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, width, height);
          const resizedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.2 });
          const buffer = await resizedBlob.arrayBuffer();
          return `data:image/jpeg;base64,${arrayBufferToBase64(buffer)}`;
        }
      } catch { }
    }

    const buffer = await blob.arrayBuffer();
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } catch (err) {
    console.warn("[Detectium] 이미지 변환 실패:", url, err);
    return null;
  }
}

export type AnalysisImage = {
  label: string;
  dataUrl: string;
};

export interface PostPayloadForServer {
  id: string;
  platform: "x" | "instagram" | "youtube" | "generic";
  content: string;
  imageUrls?: string[];
  analysisImages?: AnalysisImage[];
}

/**
 * 백엔드 서버(POST /api/analyze)로 게시글 분석을 요청하고 결과를 반환합니다.
 */
export async function analyzePostsWithOpenAI(
  posts: PostData[]
): Promise<AnalysisResult[]> {
  if (!posts || posts.length === 0) {
    return [];
  }

  // 캡션과 첨부 이미지가 모두 없는 게시글은 제외
  const validPosts = posts.filter((p) => {
    const trimmedContent = (p.content || "").trim();
    return trimmedContent.length > 0 || Boolean(p.imageUrls?.length);
  });

  if (validPosts.length === 0) {
    return [];
  }

  // 게시글 이미지들을 전처리(리사이즈 및 Data URL 변환)하여 서버로 전송할 정보 구성
  const payloadPosts: PostPayloadForServer[] = await Promise.all(
    validPosts.map(async (p) => {
      const analysisImages: AnalysisImage[] = [];

      if (p.imageUrls?.length) {
        const targets = p.imageUrls.slice(0, 5);
        const converted = await Promise.all(
          targets.map(async (url, index) => {
            const base64 = await fetchImageAsBase64(url);
            return {
              label: `이미지 #${index + 1}`,
              dataUrl: base64 || url,
            };
          })
        );
        analysisImages.push(...converted);
      }

      return {
        id: p.id,
        platform: p.platform,
        content: p.content,
        imageUrls: p.imageUrls,
        analysisImages,
      };
    })
  );

  // 서버의 REST API (/api/analyze) 호출
  const response = await fetch(SERVER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ posts: payloadPosts }),
  });

  if (!response.ok) {
    let errorDetail = `서버 응답 오류 (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error) {
        errorDetail = errJson.error;
      }
    } catch { }
    throw new Error(`[Detectium Server] ${errorDetail}`);
  }

  const data = await response.json();
  if (!data || !data.success) {
    throw new Error(data?.error || "분석 결과를 받아오지 못했습니다.");
  }

  return data.results as AnalysisResult[];
}
