import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const app = new Hono();

// CORS 활성화 (브라우저 익스텐션에서 REST API 호출 가능하도록)
app.use("*", cors());

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.warn("[Detectium Server] 경고: ANTHROPIC_API_KEY가 .env에 설정되지 않았습니다.");
}

const client = new Anthropic({
  apiKey: apiKey || "",
});

const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-5-5";

// Structured Outputs 스키마
const AnalysisSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      extractedImageText: z.string(),
      description: z.string(),
      analysisContent: z.object({
        violatedPoints: z.array(z.string()),
      }),
      isCredible: z.boolean(),
      links: z.array(z.string()),
    })
  ),
});

export interface PostInput {
  id: string;
  platform?: "x" | "instagram" | "youtube" | "generic";
  content?: string;
  imageUrls?: string[];
  analysisImages?: Array<{
    label: string;
    dataUrl: string;
  }>;
}

// ArrayBuffer -> Base64 안전 변환 (서버 사이드 폴백용)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

// 서버에서 이미지 URL을 Base64 Data URL로 변환하는 폴백 함수
async function fetchImageAsBase64(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const blob = await res.blob();
    const mime = blob.type || "image/jpeg";
    const buffer = await blob.arrayBuffer();
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } catch (err) {
    console.warn("[Detectium Server] 이미지 변환 실패:", url, err);
    return null;
  }
}

// Data URL을 Claude API image block source 형식으로 분해하는 헬퍼 함수
function parseDataUrl(dataUrl: string): {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
} | null {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/s);
  if (match) {
    const rawType = match[1].toLowerCase();
    let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
    if (rawType === "image/png") mediaType = "image/png";
    else if (rawType === "image/gif") mediaType = "image/gif";
    else if (rawType === "image/webp") mediaType = "image/webp";
    else if (rawType === "image/jpeg" || rawType === "image/jpg") mediaType = "image/jpeg";
    return {
      mediaType,
      data: match[2].trim(),
    };
  }
  if (/^[A-Za-z0-9+/=]+$/.test(dataUrl.trim())) {
    return {
      mediaType: "image/jpeg",
      data: dataUrl.trim(),
    };
  }
  return null;
}

// 헬스체크
app.get("/", (c) => {
  return c.json({ status: "ok", message: "Detectium Analysis Server is running" });
});

// 분석 API: /api/analyze
app.post("/api/analyze", async (c) => {
  try {
    const body = await c.req.json();
    const posts: PostInput[] = Array.isArray(body) ? body : body.posts || [];

    if (!posts || posts.length === 0) {
      return c.json({ success: true, results: [] });
    }

    // 캡션과 첨부 이미지가 모두 없는 게시글은 제외
    const validPosts = posts.filter((p) => {
      const trimmedContent = (p.content || "").trim();
      const hasImages =
        Boolean(p.analysisImages?.length) || Boolean(p.imageUrls?.length);
      return trimmedContent.length > 0 || hasImages;
    });

    if (validPosts.length === 0) {
      return c.json({ success: true, results: [] });
    }

    const postsWithImages = await Promise.all(
      validPosts.map(async (p) => {
        const analysisImages: Array<{ label: string; dataUrl: string }> = [];

        // 1. 클라이언트(익스텐션)에서 이미 Data URL로 변환된 analysisImages가 있으면 최우선 사용
        if (p.analysisImages && p.analysisImages.length > 0) {
          analysisImages.push(...p.analysisImages.slice(0, 5));
        } else if (p.imageUrls && p.imageUrls.length > 0) {
          // 2. imageUrls만 전달된 경우 서버에서 변환
          const targets = p.imageUrls.slice(0, 5);
          const converted = await Promise.all(
            targets.map(async (url, index) => {
              const base64 = await fetchImageAsBase64(url);
              return {
                label: `${index + 1}번째 이미지`,
                dataUrl: base64 || url,
              };
            })
          );
          analysisImages.push(...converted);
        }

        return {
          id: p.id,
          content: p.content || "",
          analysisImages,
        };
      })
    );

    const instructions = `
현재 시각은 ${new Date().toISOString()}입니다. 당신의 학습 데이터는 오래되었을 수 있으므로, 사실 여부는 반드시 웹 검색 결과를 근거로 판단하세요.
검색 결과와 당신의 기억이 충돌하면 검색 결과를 따르세요. "학습 데이터 기준 시점" 때문에 확인할 수 없다는 식의 답변은 하지 마세요.
검색으로도 확인되지 않을 때만 "확인 불가"로 판단하세요.

당신은 SNS 게시글의 신뢰성(사실여부, 왜곡성 등)을 전문적으로 검증하는 대한민국 최고의 분석가 '커트니'입니다.
당신은 입력되는 게시글마다 검증하여 isCredible을 책정합니다.
**게시글을 검증할 때에는 무조건 다음 원칙을 따르세요.**

1. 입력받은 캡션과 첨부 이미지로 게시글을 검증하세요.
- 이미지에서 확인 가능한 모든 텍스트를 추출하십시오.
- 추출한 텍스트는 결과의 "extractedImageText" 필드에 이미지 출처가 구분되도록 기록하십시오.
- 이미지가 없거나 텍스트가 전혀 없는 경우에만 "이미지 내 텍스트 없음"으로 기록하십시오.

2. 일상 게시글 / 순수 재미성 게시글인 경우 검증을 넘어가세요. **다만, 수치 자료가 포함되어있는 경우는 정보성 게시글로 간주합니다.**

3. 아래 [기준]을 바탕으로 isCredible를 책정하세요. [기준]에서 하나라도 만족하는 순간 violatedPoints에 기록하고 isCredible을 false로 바꾸고 즉시 다음 단계로 넘어가세요.

[기준]
- 이미지와 게시글이 불일치 하는 경우
  - 이미지 속 내용과 게시글 캡션의 설명이 전혀 다른 경우
- 사실 확인이 제대로 되지 않은 정보를 확실한 정보마냥 설명한 경우
  - 명백히 사실과 다르거나 조작된 주장
  - 음모론, 확인되지 않은 악의적 루머의 기정사실화
  - 맥락을 악의적으로 잘라내어 오해를 유발하는 글
  - 오래된 정보를 최신 사실처럼 제시하거나, 과거 사건의 사진을 현재 사건처럼 사용하는 경우
  - 출처 없는 "카더라" 정보, 전문가·기관 사칭, 존재하지 않는 연구/기관 인용
  - 게시글에 나온 의견이 일반화되기 어렵다고 판단될 경우
- 통계자료를 가지고 왜곡하여 결론을 도출한 경우
  - 상관관계를 인과관계로 비약하거나 억지 주장
  - 표본 편향 및 체리피킹 (유리한 수치나 기간만 발췌)
  - 왜곡된 그래프/수치 인용, 출처가 불분명하거나 조작된 통계
  - 단위 왜곡 또는 전체 맥락을 은폐한 퍼센트 과장

4. description에는 이 게시글이 왜 위험 기준에 걸렸는지, 사용자가 판정 근거를 확인할 수 있도록 설명하세요. 게시글이나 이미지의 내용을 소개·요약하는 것으로 대체하지 마세요.
- violatedPoints가 있으면 검색으로 확인한 신뢰할 만한 출처와 그 출처가 확인해 주는 사실을 제시하고, 둘 사이의 구체적인 불일치·왜곡·근거 부족이 무엇인지 논리적으로 설명하세요.
- 게시글의 위반점에 대해 200자 이하로 주장과 근거를 논리적으로 간략하게 요약하세요. 위반점이 없으면 빈 문자열 ""로 놔두세요.
- 이미지의 촬영자·촬영일·장면 등은 그 자체가 위반 근거가 아니면 설명에서 언급하지 마세요. 캡션과 무관한 이미지 내용도 나열하지 마세요.
- 게시글이 왜 필터링됐는지 violatedPoints에 걸린 기준만 검증 근거와 판단 과정을 충분히 설명하세요. 단, 확인되지 않은 출처나 사실을 만들어내지 마세요.
- 제목, 소제목, 목록, 번호, 글머리 기호, 마크다운, 줄바꿈 없이 자연스러운 문단으로 작성하세요.
- 설명에 구분 순번(예: 이미지 3)이나 ID처럼 판정 근거가 아닌 식별 정보를 쓰지 마세요.
- links에 참고한 출처 링크가 별도로 저장되므로, description 본문 안에 긴 URL 주소를 직접 나열하지 마세요.
- 위반한 사항이 없으면 빈 문자열 ""로 놔두세요.
- 사용자가 이해하기 쉽게 정돈된 문장으로 작성하고, 어투는 -다, -입니다, -하기에, -이므로 체를 사용하세요.
- 만약 외국어로 description에 설명이 되어 있다면 한국어로 번역하세요.

5. links에는 게시글을 검증하고 팩트체크하는 과정에서 web_search 등을 통해 확인하거나 참고한 신뢰할 수 있는 출처 웹페이지의 실제 URL(링크)들을 문자열 배열로 기록하십시오.
- 각 항목은 유효한 전체 URL(예: https://...) 형식이어야 합니다.
- 위반 사항이 없거나 검색/참고한 웹 링크가 없는 경우에는 빈 배열([])로 반환하세요.
- 허위 URL이나 임의로 꾸며낸 링크를 작성하지 마세요.
6. 입력된 모든 게시글에 대해 빠짐없이 results에 하나씩 결과를 반환하세요. id는 입력된 게시글 ID를 그대로 사용하세요.
`.trim();

    const userContent: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
            data: string;
          };
        }
    > = [];

    userContent.push({
      type: "text",
      text: `다음 ${postsWithImages.length}개의 SNS 게시글 목록을 분석해주세요.\n각 게시글의 캡션과 첨부 이미지만 검토하여 허위사실/통계왜곡 여부를 팩트체크해주세요.`,
    });

    postsWithImages.forEach((p) => {
      userContent.push({
        type: "text",
        text: `\n----------------------------------------\n[ID: ${p.id}]\n- 캡션: ${p.content || "(캡션 없음)"}\n- 첨부 이미지 수: ${p.analysisImages.length}개\n`,
      });

      p.analysisImages.forEach((image) => {
        userContent.push({
          type: "text",
          text: `▲ [게시글 ID: ${p.id}]의 ${image.label}:`,
        });

        const parsedImg = parseDataUrl(image.dataUrl);
        if (parsedImg) {
          userContent.push({
            type: "image",
            source: {
              type: "base64",
              media_type: parsedImg.mediaType,
              data: parsedImg.data,
            },
          });
        }
      });
    });

    const response = await client.messages.parse({
      model,
      max_tokens: 4096,
      system: instructions,
      messages: [{ role: "user", content: userContent }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
      output_config: {
        format: zodOutputFormat(AnalysisSchema),
      },
    });

    let parsed = response.parsed_output;
    if (!parsed) {
      // Fallback: Check text content blocks for JSON
      const fullText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      if (!fullText) {
        throw new Error("Claude가 최종 분석 결과를 반환하지 않았습니다.");
      }

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Claude의 최종 분석 결과가 유효한 JSON 형식이 아닙니다.");
      }

      try {
        const rawJson = JSON.parse(jsonMatch[0]);
        parsed = AnalysisSchema.parse(rawJson);
      } catch (err: any) {
        throw new Error(`Claude 최종 분석 결과 JSON 검증 실패: ${err?.message || err}`);
      }
    }

    const citationUrls: string[] = [];
    for (const block of response.content as any[]) {
      if (block.type === "text" && Array.isArray(block.citations)) {
        for (const citation of block.citations) {
          if (citation.url && typeof citation.url === "string") {
            citationUrls.push(citation.url);
          }
        }
      }
      if (block.type === "web_search_tool_result" && Array.isArray(block.results)) {
        for (const item of block.results) {
          if (item.url && typeof item.url === "string") {
            citationUrls.push(item.url);
          }
        }
      }
    }

    const enrichedResults = parsed.results.map((res) => {
      const links = new Set(res.links || []);
      citationUrls.forEach((u) => {
        if (u.startsWith("http")) links.add(u);
      });
      const descUrls = res.description?.match(/https?:\/\/[^\s)\],]+/g) || [];
      const pointUrls =
        res.analysisContent?.violatedPoints?.flatMap(
          (p) => p.match(/https?:\/\/[^\s)\],]+/g) || []
        ) || [];
      [...descUrls, ...pointUrls].forEach((u) => {
        const cleaned = u.replace(/[.,;)]+$/, "").trim();
        if (cleaned.startsWith("http")) links.add(cleaned);
      });
      return {
        ...res,
        links: Array.from(links),
      };
    });

    return c.json({
      success: true,
      results: enrichedResults,
    });
  } catch (err: any) {
    console.error("[Detectium Server] 분석 오류:", err);
    return c.json(
      {
        success: false,
        error: err?.message || "서버 분석 처리 중 오류가 발생했습니다.",
      },
      500
    );
  }
});

const port = Number(process.env.PORT) || 3001;

serve(
  {
    fetch: app.fetch,
    port,
    hostname: "127.0.0.1",
  },
  (info) => {
    console.log(`[Detectium Server] Running on http://${info.address}:${info.port}`);
    console.log(`[Detectium Server] REST API endpoint: http://${info.address}:${info.port}/api/analyze`);
  }
);
