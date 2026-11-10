import OpenAI from 'openai';
import type { PostData, AnalysisResult } from './types';
import { fetchRelatedDaumNews, formatNewsForPrompt } from './newsSearcher';

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

    // OffscreenCanvas 지원 시 브라우저 환경에서 이미지 다운스케일링 (최대 1024px, 토큰 절약 및 OCR 정확도)
    if (typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined") {
      try {
        const bitmap = await createImageBitmap(blob);
        const maxDimension = 1024;
        let { width, height } = bitmap;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        // 다운스케일
        const canvas = new OffscreenCanvas(width / 2, height / 2);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, width / 2, height / 2);
          const resizedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
          const buffer = await resizedBlob.arrayBuffer();
          return `data:image/jpeg;base64,${arrayBufferToBase64(buffer)}`;
        }
      } catch {
        // 리사이징 실패 시 원본 Blob 사용
      }
    }

    const buffer = await blob.arrayBuffer();
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } catch (err) {
    console.warn("[Detectium] 이미지 변환 실패:", url, err);
    return null;
  }
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export async function analyzePostsWithOpenAI(
  posts: PostData[],
  apiKey?: string,
  detectionThreshold = 50
): Promise<AnalysisResult[]> {
  const effectiveKey = apiKey?.trim() || process.env.OPENAI_API_KEY;

  if (!effectiveKey) {
    throw new Error("OpenAI API 키가 설정되지 않았습니다. 확장 프로그램 설정 페이지에서 API 키를 입력해주세요.");
  }

  if (!posts || posts.length === 0) {
    return [];
  }

  // 캡션이 빈 문자열이거나 작성자 계정명만 포함되어 있는 게시글은 API 전송에서 제외
  const validPosts = posts.filter((p) => {
    const trimmedContent = (p.content || "").trim();
    const trimmedAuthor = (p.author || "").trim();
    const hasImages = Boolean(p.imageUrls && p.imageUrls.length > 0);

    if (p.platform === "instagram" && !trimmedContent) {
      return false;
    }
    if (!trimmedContent && !hasImages && (!p.mediaDescription || p.mediaDescription.length < 10)) {
      return false;
    }
    if (
      trimmedContent &&
      trimmedAuthor &&
      (trimmedContent === trimmedAuthor ||
        trimmedContent.replace(/[@\s]/g, "") === trimmedAuthor.replace(/[@\s]/g, ""))
    ) {
      return false;
    }
    return true;
  });

  if (validPosts.length === 0) {
    return [];
  }

  const client = new OpenAI({
    apiKey: effectiveKey,
    dangerouslyAllowBrowser: true,
  });

  // 게시글 본문을 합쳐 뉴스 검색용 쿼리 생성 (이미지 변환과 병렬 실행)
  const combinedQuery = validPosts
    .map((p) => p.content || p.mediaDescription || '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 80);

  // 이미지 Base64 변환 + Daum 뉴스 검색을 병렬로 실행 (서로 독립)
  const [postsWithImages, relatedNews] = await Promise.all([
    Promise.all(
      validPosts.map(async (p) => {
        let imagesBase64: string[] = [];
        if (p.imageUrls && p.imageUrls.length > 0) {
          // 게시글당 최대 5장의 이미지 변환 (대부분의 카드뉴스는 3~5장 내외)
          const targets = p.imageUrls.slice(0, 5);
          const converted = await Promise.all(
            targets.map(async (url) => {
              const base64 = await fetchImageAsBase64(url);
              return base64 || url;
            })
          );
          imagesBase64 = converted.filter((b): b is string => Boolean(b));
        }
        return { ...p, imagesBase64 };
      })
    ),
    fetchRelatedDaumNews(combinedQuery),
  ]);

  const newsPromptBlock =
    relatedNews.length > 0
      ? `\n[관련 뉴스 현황 - Daum 뉴스 최신 검색 결과 ${relatedNews.length}건]\n${formatNewsForPrompt(relatedNews)}\n`
      : '';

  const systemPrompt = `
당신은 SNS 게시글, 카드뉴스, 인스타그램/X 이미지의 "이미지 텍스트 추출(OCR)", "선동성 게시글 판별", "통계 왜곡 및 가짜뉴스/허위정보"를 전문적으로 검증하는 대한민국 최고의 AI 팩트체커 "Detectium"입니다.

[분석 절차 및 핵심 원칙]
1단계 - 이미지 텍스트 정밀 추출 (OCR):
- 첨부된 모든 이미지를 면밀히 확인하고, 이미지 안에 포함된 모든 텍스트(카드뉴스 제목, 본문, 자막, 통계 수치, 도표 내용, 인용문, 기사 캡처 문구 등)를 빠짐없이 추출(OCR)하십시오.
- 추출한 이미지 텍스트는 결과의 "extractedImageText" 필드에 "[이미지 1] ... \\n[이미지 2] ..." 형식으로 상세히 기록하십시오.
- 이미지가 없거나 텍스트가 전혀 없는 경우에만 "이미지 내 텍스트 없음"으로 기록하십시오.

2단계 - 주장 및 의도 분석:
- 게시글 본문과 이미지에서 추출한 텍스트 전체를 통합하여 검증 가능한 진술과 글의 의도를 파악합니다.

3단계 - 관련 뉴스와 비교 검증 (★최우선 판별 기준★):${newsPromptBlock ? `
- 아래 "[관련 뉴스 현황]"에 나열된 실제 Daum 뉴스 검색 결과와 게시글의 주장을 면밀히 비교합니다.
- 뉴스 보도 내용과 상반되거나 사실을 과장·왜곡한 주장이 있으면 선동/왜곡으로 판정합니다.
- 뉴스 보도와 일치하는 사실이라도 선동적 프레이밍(편향된 어휘, 적대감 유발, 출처 은폐)으로 제시한 경우 선동으로 판정합니다.
- 뉴스 검색 결과에 존재하지 않거나 뉴스와 상충하는 주장은 허위정보로 판정합니다.
- details 필드에 "○○ 뉴스(언론사명)에 따르면 실제로는 ~이나, 게시글은 ~로 왜곡했습니다" 형태로 근거를 명시하십시오.` : `
- 관련 뉴스를 찾지 못한 경우, 게시글 자체의 표현·어휘·논리 구조만으로 선동성을 판별합니다.`}

4단계 - 선동성 및 왜곡 여부 판정:
- 글이 "대중을 선동하는 글"이거나 사실을 왜곡한 경우 즉시 경고 대상으로 분류합니다.

[분석 기준]
1. 선동성 게시글 및 여론 조작 (★핵심 기준★):
   - 대중의 감정적 분노, 적대감, 혐오, 불안을 부추기기 위해 자극적인 표현이나 편향된 어휘로 선동하는 글
   - 전체 맥락을 의도적으로 거세하고 자극적인 일부 문구·숫자·발언만 발췌하여 오해를 유발하는 글 (악마의 편집, 체리피킹 선동)
   - 출처 없는 "카더라" 소문, 조작된 캡처본, 음모론을 마치 사실인 양 포장하여 대중을 호도하는 글
   - "충격", "경악", "소름 돋는 진실", "전 국민 분노", "폭로" 등 자극적인 표제로 시작하여 비합리적인 결론과 적개심을 유도하는 카드뉴스/게시글
   - 특정 인물이나 집단을 표적 삼아 흑색선전을 펼치거나 집단적 비난을 유도하는 글

2. 통계 왜곡:
   - 상관관계를 인과관계로 비약하거나 억지 주장
   - 표본 편향 및 체리피킹 (유리한 수치나 기간만 발췌)
   - 왜곡된 그래프/수치 인용, 출처가 불분명하거나 조작된 통계
   - 단위 왜곡 또는 전체 맥락을 은폐한 퍼센트 과장

3. 가짜뉴스 및 허위 정보:
   - 명백히 사실과 다르거나 조작된 뉴스/주장
   - 음모론, 확인되지 않은 악의적 루머의 기정사실화
   - 맥락을 악의적으로 잘라내어 오해를 유발하는 글
   - 오래된 정보를 최신 사실처럼 제시하거나, 과거 사건의 사진/영상을 현재 사건처럼 사용하는 경우
   - 출처 없는 "카더라" 정보, 전문가·기관 사칭, 존재하지 않는 연구/기관 인용

4. 판별 및 임계값 설정 (★핵심 판별 규칙★):
   - 현재 필터링 강도 임계값: ${detectionThreshold}점
     (강도 기준: [약함] 70점 이상 필터링 | [보통] 50점 이상 필터링 | [강함] 40점 이상 필터링)
   - riskScore 점수 산정 기준 (0~100점):
     * 0 ~ 39점 (정상/낮은 위험): 사실에 부합하거나 통상적인 개인 의견, 건전한 비판
     * 40 ~ 49점 (경미한 과장/주의): 자극적 어휘, 부분적 과장, 출처 불분명한 경미한 주장 (강함 강도에서 필터링)
     * 50 ~ 69점 (보통 위험/왜곡·선동): 악마의 편집, 체리피킹, 통계 왜곡, 대중의 감정적 분노 조장 (보통 이상 강도에서 필터링)
     * 70 ~ 100점 (높은 위험/명백한 조작·선동): 명백한 허위 사실, 날조된 정보, 노골적인 선동 및 흑색선전 (약함 강도에서도 필터링)
   - isFakeOrMisleading 판정:
     * 산출된 riskScore가 ${detectionThreshold}점 이상이면 반드시 true, ${detectionThreshold}점 미만이면 반드시 false로 지정하십시오.
   - category: "선동성 게시글" | "선동 및 여론 조작" | "통계 왜곡" | "가짜뉴스 / 허위사실" | "과장 및 맥락 왜곡" | "정상" 중 택1
   - summary: 판정의 핵심 이유를 1문장으로 요약 (예: "카드뉴스 이미지 속 자극적 허위 수치로 특정 집단에 대한 적대감을 부추기는 선동글")
   - details: 추출된 이미지 텍스트와 본문에서 어떤 부분이 왜곡되었거나 선동적인지, 관련 뉴스와 비교한 실제 사실 관계는 무엇인지를 일반인이 이해하기 쉽게 2~3문장으로 구체적으로 설명
   - checkedPoints: 실제로 검증한 핵심 진술, 선동 표현 또는 확인된 문제 요소 1~3개 배열

[정상 판정 시 작성 규칙]
- "정상"으로 판정하더라도 "주장이 없다"는 식으로 쓰지 말고, 어떤 진술/이미지를 어떻게 확인했고 왜 문제가 없다고 판단했는지를 summary와 details에 구체적으로 적으십시오.

반드시 아래 JSON 형식으로만 응답하십시오. JSON 외의 설명, 마크다운, 코드블록은 출력하지 마십시오:
{
  "results": [
    {
      "id": "게시글 ID",
      "extractedImageText": "[이미지 1] ... \\n[이미지 2] ...",
      "isFakeOrMisleading": true,
      "category": "선동성 게시글",
      "riskScore": 85,
      "summary": "핵심 문제 요약",
      "details": "구체적인 팩트체크 및 선동성 분석 설명",
      "checkedPoints": ["선동 문구 1", "문제 진술 2"]
    }
  ]
}
`.trim();

  const userContent: ContentPart[] = [];
  userContent.push({
    type: 'text',
    text: `다음 ${postsWithImages.length}개의 SNS 게시글 목록을 분석해주세요.\n각 게시글의 본문과 첨부된 모든 이미지들을 검토하여, 이미지 속 모든 텍스트(문구, 수치, 자막, 헤드라인 등)를 정확하게 추출(OCR)해 읽고, 선동성 글/허위사실/통계왜곡 여부를 철저하게 팩트체크해주세요.\n${newsPromptBlock}`,
  });

  postsWithImages.forEach((p, postIdx) => {
    userContent.push({
      type: "text",
      text: `\n----------------------------------------\n[게시글 #${postIdx + 1} / ID: ${p.id}]\n- 플랫폼: ${p.platform}\n- 작성자: ${p.author || "알 수 없음"}\n- 본문 내용: ${p.content || "(본문 텍스트 없음 - 아래 첨부 이미지의 텍스트를 읽고 분석할 것)"}\n- 미디어 정보: ${p.mediaDescription || "없음"}\n- 첨부된 이미지 수: ${p.imagesBase64.length}장\n`,
    });

    if (p.imagesBase64.length > 0) {
      p.imagesBase64.forEach((urlOrBase64, imgIdx) => {
        userContent.push({
          type: "text",
          text: `▲ [게시글 ID: ${p.id}]의 이미지 #${imgIdx + 1}:`,
        });
        userContent.push({
          type: "image_url",
          image_url: {
            url: urlOrBase64,
            detail: "high",
          },
        });
      });
    }
  });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: userContent as any,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI 모델로부터 응답을 받지 못했습니다.");
  }

  try {
    const parsed = JSON.parse(content);
    const results: AnalysisResult[] = Array.isArray(parsed.results) ? parsed.results : [];
    return results;
  } catch (err) {
    console.error("[Detectium] OpenAI JSON 응답 파싱 실패:", content, err);
    throw new Error("OpenAI 응답 파싱에 실패했습니다.");
  }
}
