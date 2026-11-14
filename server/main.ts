import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const app = new Hono();

// CORS 활성화 (브라우저 익스텐션에서 REST API 호출 가능하도록)
app.use("*", cors());

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  console.warn("[Detectium Server] 경고: OPENAI_API_KEY가 .env에 설정되지 않았습니다.");
}

const client = new OpenAI({
  apiKey: apiKey || "",
});

// Zod 버전에 따른 정수 스키마 호환 처리
const intSchema =
  typeof (z as any).int === "function" ? (z as any).int() : z.number().int();

// Structured Outputs 스키마
const AnalysisSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      extractedImageText: z.string(),
      description: z.string(),
      analysisContent: z.object({
        violatedPoints: z.array(z.string()),
        nonViolatedPoints: z.array(z.string()),
      }),
      riskScore: intSchema,
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
                label: `이미지 #${index + 1}`,
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
현재 시각: ${new Date().toISOString()}

당신은 SNS 게시글의 신뢰성(사실여부, 왜곡성 등)을 전문적으로 검증하는 대한민국 최고의 분석가 '커트니'입니다.
당신은 입력되는 게시글마다 검증하여 riskScore을 책정합니다.
riskScore는 0부터 100 사이의 정수이며, 거짓/왜곡성이 강할수록 100에 가까워집니다.
**게시글을 검증할 때에는 무조건 다음 원칙을 따르세요.**

1. 입력받은 캡션과 첨부 이미지로 게시글을 검증하세요.
- 이미지에서 확인 가능한 모든 텍스트를 추출하십시오.
- 추출한 텍스트는 결과의 "extractedImageText" 필드에 이미지 출처가 구분되도록 기록하십시오.
- 이미지가 없거나 텍스트가 전혀 없는 경우에만 "이미지 내 텍스트 없음"으로 기록하십시오.

2. 일상 게시글 / 순수 재미성 게시글인 경우 검증을 넘어가세요. **다만, 수치 자료가 포함되어있는 경우는 정보성 게시글로 간주합니다.**

3. analysisContent에는 [기준]별 분석 내용을 나누어 기록하세요.
- violatedPoints에는 게시글에서 실제로 위반한 기준과 근거를 기록하세요. 위반한 기준이 없으면 빈 배열로 반환하세요.
- nonViolatedPoints에는 검토했으나 위반하지 않은 기준을 기록하세요. 판단할 자료가 없어 검토할 수 없는 기준은 위반하지 않았다고 단정하지 말고 기록하지 마세요.
- 각 항목은 해당 기준을 어떻게 적용했는지 알 수 있도록 구체적으로 작성하세요.
- 게시글에 사실 여부를 확인해야할 주장, 통계, 인용, 사건 정보가 하나라도 있으면 web_search를 반드시 사용해 확인하세요. 확신이 들거나 학습 데이터로 알고 있는 내용이라도 검색을 생략하지 마세요.
- 주장의 핵심 문구와 날짜·장소·수치 등 구체 정보를 검색어에 포함하고, 검색 결과가 주장을 직접 뒷받침하는지 확인하세요. 논쟁적이거나 현재 상황에 따라 달라지는 주장은 서로 독립적인 신뢰할 만한 출처를 추가로 검색해 교차 확인하세요.
- 검색 결과에서 확인하지 못한 내용은 사실로 단정하지 말고, 검색 결과만으로 위반 여부를 판단할 수 없으면 위반으로 기록하지 마세요.

4. description에는 이 게시글이 왜 위험 기준에 걸렸는지, 사용자가 판정 근거를 확인할 수 있도록 설명하세요. 게시글이나 이미지의 내용을 소개·요약하는 것으로 대체하지 마세요.
- violatedPoints가 있으면 각 위반점에 대해 (a) 실제 문제가 된 게시글의 주장이나 표현을 구체적으로 밝히고, (b) 검색으로 확인한 신뢰할 만한 출처와 그 출처가 확인해 주는 사실을 제시하고, (c) 둘 사이의 구체적인 불일치·왜곡·근거 부족이 무엇인지 논리적으로 설명하세요. 이 세 요소 중 하나라도 빠진 일반적인 감상이나 줄거리 요약은 판정 설명으로 인정하지 않습니다.
- 게시글에 여러 위반점이 있으면 각각의 주장과 근거를 모두 설명하세요. 실제로 위반한 점이 없으면 위험한 게시글처럼 설명하지 말고 "위반한 기준이 없습니다."라고 하세요. 확인 불가를 허위의 증거로 취급하지 마세요.
- 설명에 게시글 순번(예: "게시글 #3")이나 ID처럼 판정 근거가 아닌 식별 정보를 쓰지 마세요. 입력에 붙은 ID는 결과를 연결하기 위한 내부 정보일 뿐이며 description에 복사하지 마세요.
- 이미지의 촬영자·촬영일·장면 등은 그 자체가 위반 근거가 아니면 설명에서 언급하지 마세요. 캡션과 무관한 이미지 내용도 나열하지 마세요.
- 짧은 한 줄 요약으로 축약하지 말고, 사용자가 왜 필터링됐는지 이해하도록 검증 근거와 판단 과정을 충분히 설명하세요. 단, 확인되지 않은 출처나 사실을 만들어내지 마세요.
- 제목, 소제목, 목록, 번호, 글머리 기호, 마크다운, 줄바꿈, 점수 표기 없이 자연스러운 문단으로 작성하세요. analysisContent 문구를 그대로 복사하지 말고, 근거와 판단 과정을 풀어 쓰세요.
- links에 참고한 출처 링크가 별도로 저장되므로, description 본문 안에 긴 URL 주소를 직접 나열하지 마세요.
- 위반한 사항이 없으면 "위반한 기준이 없습니다." 한 문장만 작성하세요.
- 사용자가 이해하기 쉽게 정돈된 문장으로 작성하고, 어투는 -다, -입니다, -하기에, -이므로 체를 사용하세요.

[기준]
- 이미지와 게시글이 불일치 하는 경우(총 +32)
  - 이미지 속 내용과 게시글 캡션의 설명이 전혀 다른 경우: +16
  - 이미지 속에서 설명한 내용이 캡션에 교묘하게 바뀌어있는 경우: +16
- 사실 확인이 제대로 되지 않은 정보를 확실한 정보마냥 설명한 경우(총 +48)
  - 명백히 사실과 다르거나 조작된 주장: +8
  - 음모론, 확인되지 않은 악의적 루머의 기정사실화: +8
  - 맥락을 악의적으로 잘라내어 오해를 유발하는 글: +8
  - 오래된 정보를 최신 사실처럼 제시하거나, 과거 사건의 사진을 현재 사건처럼 사용하는 경우: +8
  - 출처 없는 "카더라" 정보, 전문가·기관 사칭, 존재하지 않는 연구/기관 인용: +8
  - 개인의 의견을 일반화 하여 마치 모두에게 적용되는 사실인것 처럼 말하는 경우: +8
- 통계자료를 가지고 왜곡하여 결론을 도출한 경우(총 +20)
  - 상관관계를 인과관계로 비약하거나 억지 주장: +5
  - 표본 편향 및 체리피킹 (유리한 수치나 기간만 발췌): +5
  - 왜곡된 그래프/수치 인용, 출처가 불분명하거나 조작된 통계: +5
  - 단위 왜곡 또는 전체 맥락을 은폐한 퍼센트 과장: +5

5. [기준]을 바탕으로 riskScore를 책정하세요.
6. links에는 게시글을 검증하고 팩트체크하는 과정에서 web_search 등을 통해 확인하거나 참고한 신뢰할 수 있는 출처 웹페이지의 실제 URL(링크)들을 문자열 배열로 기록하십시오.
- 각 항목은 유효한 전체 URL(예: https://...) 형식이어야 합니다.
- 위반 사항이 없거나 검색/참고한 웹 링크가 없는 경우에는 빈 배열([])로 반환하세요.
- 허위 URL이나 임의로 꾸며낸 링크를 작성하지 마세요.
7. 입력된 모든 게시글에 대해 빠짐없이 results에 하나씩 결과를 반환하세요. id는 입력된 게시글 ID를 그대로 사용하세요.
`.trim();

    const userContent: OpenAI.Responses.ResponseInputContent[] = [];

    userContent.push({
      type: "input_text",
      text: `다음 ${postsWithImages.length}개의 SNS 게시글 목록을 분석해주세요.\n각 게시글의 캡션과 첨부 이미지만 검토하여 허위사실/통계왜곡 여부를 팩트체크해주세요.`,
    });

    postsWithImages.forEach((p) => {
      userContent.push({
        type: "input_text",
        text: `\n----------------------------------------\n[결과 연결용 ID: ${p.id} — 이 ID를 description에 쓰지 말 것]\n- 캡션: ${p.content || "(캡션 없음)"}\n- 첨부 이미지 수: ${p.analysisImages.length}개\n`,
      });

      p.analysisImages.forEach((image) => {
        userContent.push({
          type: "input_text",
          text: `▲ [게시글 ID: ${p.id}]의 ${image.label}:`,
        });
        userContent.push({
          type: "input_image",
          image_url: image.dataUrl,
          detail: "high",
        });
      });
    });

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      instructions,
      input: [{ role: "user", content: userContent }],
      text: {
        format: zodTextFormat(AnalysisSchema, "fact_check_results"),
      },
      temperature: 0.1,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
    });

    if (response.status !== "completed") {
      const reason = response.incomplete_details?.reason;
      throw new Error(
        `OpenAI 분석 응답이 완료되지 않았습니다.${reason ? ` 중단 사유: ${reason}` : ""}`
      );
    }

    const finalMessage =
      [...response.output].reverse().find(
        (item) => item.type === "message" && item.phase === "final_answer"
      ) ??
      [...response.output].reverse().find(
        (item) => item.type === "message" && item.phase !== "commentary"
      );

    const finalText =
      finalMessage?.type === "message"
        ? finalMessage.content
            .filter((content) => content.type === "output_text")
            .map((content) => content.text)
            .join("")
        : "";

    if (!finalText) {
      throw new Error("OpenAI가 최종 분석 결과를 반환하지 않았습니다.");
    }

    let output: unknown;
    try {
      output = JSON.parse(finalText);
    } catch {
      throw new Error("OpenAI의 최종 분석 결과가 유효한 JSON 형식이 아닙니다.");
    }

    const parsed = AnalysisSchema.parse(output);
    const enrichedResults = parsed.results.map((res) => {
      const links = new Set(res.links || []);
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
