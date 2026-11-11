import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import z from "zod";
import type { PostData, AnalysisResult } from "./types";

async function downloadBase64Image(dataUrl: string, filename: string) {
  // await chrome.downloads.download({
  //   url: dataUrl,
  //   filename,
  //   saveAs: false,
  // });
}

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

    // OffscreenCanvas 지원 시 브라우저 환경에서 이미지 다운스케일
    if (typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined") {
      try {
        const bitmap = await createImageBitmap(blob);
        let { width, height } = bitmap;

        // 다운스케일
        const canvas = new OffscreenCanvas(width / 2, height / 2);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, width / 2, height / 2);
          const resizedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.2 });
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

type AnalysisImage = {
  label: string;
  dataUrl: string;
};

export async function analyzePostsWithOpenAI(
  posts: PostData[],
  apiKey?: string
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
    const hasImages = Boolean((p.imageUrls && p.imageUrls.length > 0) || p.videoFrames?.length);

    if (p.platform === "instagram" && !trimmedContent && !p.videoFrames?.length) {
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

  const postsWithImages = await Promise.all(
    validPosts.map(async (p) => {
      const analysisImages: AnalysisImage[] = [];
      if (p.imageUrls?.length) {
        // 게시글당 최대 5장의 이미지 변환 (대부분의 카드뉴스는 3~5장 내외)
        const targets = p.imageUrls.slice(0, 5);
        const converted = await Promise.all(
          targets.map(async (url, index) => {
            const base64 = await fetchImageAsBase64(url);
            if (base64) {
              await downloadBase64Image(base64, `converted-${index + 1}.jpg`);
            }
            
            return {
              label: `이미지 #${index + 1}`,
              dataUrl: base64 || url,
            };
          })
        );
        analysisImages.push(...converted);
      }

      p.videoFrames?.slice(0, 3).forEach((frame) => {
        const timestamp = Math.floor(frame.timestampSeconds);
        const minutes = Math.floor(timestamp / 60);
        const seconds = timestamp % 60;
        analysisImages.push({
          label: `동영상 프레임 ${minutes}:${String(seconds).padStart(2, "0")}`,
          dataUrl: frame.dataUrl,
        });
      });

      return { ...p, analysisImages };
    })
  );

  const systemPrompt = `
현재 시각: ${Date.now().toString()}

당신은 SNS 게시글의 신뢰성(사실여부, 왜곡성 등)을 전문적으로 검증하는 대한민국 최고의 분석가 '커트니'입니다.
당신은 입력되는 게시글마다 검증하여 riskScore을 책정합니다.
riskScore는 0부터 100 사이의 정수이며, 거짓/왜곡성이 강할수록 100에 가까워집니다.
**게시글을 검증할 때에는 무조건 다음 원칙을 따르세요.**

1. 입력받은 자료를 추출하세요.
- 첨부된 이미지 / 동영상 프레임에서 확인 가능한 **모든** 텍스트를 추출(OCR)하십시오.
- 추출한 텍스트는 결과의 "extractedImageText" 필드에 이미지/프레임 출처가 구분되도록 기록하십시오. 영상 프레임은 해당 시각도 포함하십시오.
- 분석에 전달된 영상 프레임은 영상 전체가 아니라 일부 시점의 샘플이므로, 보지 못한 장면이나 영상 맥락까지 확인한 것처럼 단정하지 마십시오.
- 이미지가 없거나 텍스트가 전혀 없는 경우에만 "이미지 내 텍스트 없음"으로 기록하십시오.


2. 일상 게시글 / 순수 재미성 게시글인 경우 검증을 넘어가세요. **다만, 수치 자료가 포함되어있는 경우는 정보성 게시글로 간주합니다.**

3. details에는 [기준]에 **위배되는 것만** 적으세요.
- 게시글 이미지와 내용이 일치한다 등 위배되지 않는 내용은 **절대로** 적지 마세요.
- 사용자에게 보여지는 설명이기 때문에 정돈되게 서술해야 합니다.
  서술시에는 어투를 -다, -입니다, -하기에, -이므로, 체를 사용하세요.
- 다만, 단어 하나에 꽂히지 말고 그 단어가 쓰인 문맥, 글 전체 흐름을 보고 판단하세요.

[기준](details뿐만 아니라 riskScore를 책정하는데 사용됩니다.)
- 이미지와 게시글이 불일치 하는 경우(총 +35)
  - 이미지 속 내용과 게시글 캡션의 설명이 전혀 다른 경우: +15
  - 이미지 속에서 설명한 내용이 캡션에 교묘하게 바뀌어있는 경우: +20
- 사실 확인이 제대로 되지 않은 정보를 확실한 정보마냥 설명한 경우(총 +40)
  - 명백히 사실과 다르거나 조작된 주장: +8
  - 음모론, 확인되지 않은 악의적 루머의 기정사실화: +8
  - 맥락을 악의적으로 잘라내어 오해를 유발하는 글: +8
  - 오래된 정보를 최신 사실처럼 제시하거나, 과거 사건의 사진/영상을 현재 사건처럼 사용하는 경우: +8
  - 출처 없는 "카더라" 정보, 전문가·기관 사칭, 존재하지 않는 연구/기관 인용: +8
- 통계자료를 가지고 왜곡하여 결론을 도출한 경우(총 +20):
  - 상관관계를 인과관계로 비약하거나 억지 주장: +5
  - 표본 편향 및 체리피킹 (유리한 수치나 기간만 발췌): +5
  - 왜곡된 그래프/수치 인용, 출처가 불분명하거나 조작된 통계: +5
  - 단위 왜곡 또는 전체 맥락을 은폐한 퍼센트 과장: +5

4. 이를 바탕으로 riskScore를 책정하세요.

반드시 아래 JSON 형식으로만 응답하십시오. JSON 외의 설명, 마크다운, 코드블록은 출력하지 마십시오:
{
  "results": [
    {
      "id": "게시글 ID",
      "extractedImageText": "[이미지 1] ... \\n[이미지 2] ...",
      "details": "구체적인 신뢰성 분석 결과 설명",
      "riskScore": 85,
      "checkedPoints": ["문제가 되는 문구 1", "문제가 되는 문구2"]
    }
  ]
}
`.trim();

  const userContent: ContentPart[] = [];
  userContent.push({
    type: "text",
    text: `다음 ${postsWithImages.length}개의 SNS 게시글 목록을 분석해주세요.\n각 게시글의 본문, 첨부 이미지, 샘플링된 영상 프레임을 검토하여 화면 속 텍스트(문구, 수치, 자막, 헤드라인 등)를 읽고 선동성 글/허위사실/통계왜곡 여부를 팩트체크해주세요.`,
  });

  postsWithImages.forEach((p, postIdx) => {
    userContent.push({
      type: "text",
      text: `\n----------------------------------------\n[게시글 #${postIdx + 1} / ID: ${p.id}]\n- 플랫폼: ${p.platform}\n- 작성자: ${p.author || "알 수 없음"}\n- 본문 내용: ${p.content || "(본문 텍스트 없음 - 아래 첨부 이미지/영상 프레임의 텍스트를 읽고 분석할 것)"}\n- 미디어 정보: ${p.mediaDescription || "없음"}\n- 첨부 이미지 및 영상 프레임 수: ${p.analysisImages.length}개\n`,
    });

    if (p.analysisImages.length > 0) {
      p.analysisImages.forEach((image) => {
        userContent.push({
          type: "text",
          text: `▲ [게시글 ID: ${p.id}]의 ${image.label}:`,
        });
        userContent.push({
          type: "image_url",
          image_url: {
            url: image.dataUrl,
            detail: "high",
          },
        });
      });
    }
  });

  const ResponseFormat = z.object({
    id: z.string(),
    extractedImageText: z.string(),
    details: z.string(),
    riskScore: z.int(),
    checkedPoints: z.array(z.string()),
  });

  const response = await client.responses.create({
    model: "gpt-4o-mini",
    text: {
      format: zodTextFormat(ResponseFormat, "results"),
    },
    temperature: 0.1,
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: userContent as any,
      },
    ],
    tools: [
      { type: "web_search", },
    ],
  });

  const content = response.output_text;
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
