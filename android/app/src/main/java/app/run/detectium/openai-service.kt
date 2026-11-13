package app.run.detectium

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

internal data class SocialPost(
  val id: String,
  val platform: String,
  val content: String,
  val imageUrls: List<String>
)

internal data class SocialAnalysisResult(
  val id: String,
  val platform: String,
  val riskScore: Int,
  val description: String
)

internal class OpenAiService(private val apiKey: String) {
  fun analyzePosts(posts: List<SocialPost>): List<SocialAnalysisResult> {
    val key = apiKey.trim()
    if (key.isEmpty()) {
      throw IllegalStateException("OpenAI API 키를 저장한 뒤 게시글을 검사해주세요.")
    }

    val validPosts = posts.filter { it.content.isNotBlank() || it.imageUrls.isNotEmpty() }
    if (validPosts.isEmpty()) return emptyList()

    val connection = URL(RESPONSES_URL).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 20_000
      connection.readTimeout = 150_000
      connection.doOutput = true
      connection.setRequestProperty("Authorization", "Bearer $key")
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty("Accept", "application/json")
      connection.outputStream.use { output ->
        output.write(buildRequest(validPosts).toString().toByteArray(Charsets.UTF_8))
      }

      val responseCode = connection.responseCode
      val responseBody = (if (responseCode in 200..299) connection.inputStream else connection.errorStream)
        ?.bufferedReader(Charsets.UTF_8)
        ?.use { it.readText() }
        .orEmpty()
      if (responseCode !in 200..299) {
        val detail = runCatching {
          JSONObject(responseBody).optJSONObject("error")?.optString("message")
        }.getOrNull().orEmpty()
        throw IllegalStateException(
          if (detail.isNotBlank()) "OpenAI 오류 ($responseCode): $detail"
          else "OpenAI 요청에 실패했습니다. HTTP $responseCode"
        )
      }

      return parseResponse(responseBody).map { result ->
        result.copy(platform = validPosts.firstOrNull { it.id == result.id }?.platform.orEmpty())
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun buildRequest(posts: List<SocialPost>): JSONObject {
    val content = JSONArray().put(
      JSONObject()
        .put("type", "input_text")
        .put(
          "text",
          "다음 ${posts.size}개의 SNS 게시글 목록을 분석해주세요.\n" +
            "각 게시글의 캡션과 첨부 이미지만 검토하여 허위사실/통계왜곡 여부를 팩트체크해주세요."
        )
    )

    posts.forEach { post ->
      content.put(
        JSONObject()
          .put("type", "input_text")
          .put(
            "text",
            "\n----------------------------------------\n" +
              "[결과 연결용 ID: ${post.id} — 이 ID를 description에 쓰지 말 것]\n" +
              "- 캡션: ${post.content.ifBlank { "(캡션 없음)" }}\n" +
              "- 첨부 이미지 수: ${post.imageUrls.size.coerceAtMost(5)}개\n"
          )
      )
      post.imageUrls.take(5).forEachIndexed { index, imageUrl ->
        content.put(
          JSONObject()
            .put("type", "input_text")
            .put("text", "▲ [게시글 ID: ${post.id}]의 이미지 #${index + 1}:")
        )
        content.put(
          JSONObject()
            .put("type", "input_image")
            .put("image_url", imageUrl)
            .put("detail", "high")
        )
      }
    }

    val input = JSONArray().put(
      JSONObject()
        .put("role", "user")
        .put("content", content)
    )
    return JSONObject()
      .put("model", "gpt-4o-mini")
      .put("instructions", "현재 시각: ${java.time.Instant.now()}\n\n$INSTRUCTIONS")
      .put("input", input)
      .put("text", JSONObject().put("format", analysisFormat()))
      .put("temperature", 0.1)
      .put("tools", JSONArray().put(JSONObject().put("type", "web_search")))
      .put("tool_choice", "required")
  }

  private fun analysisFormat(): JSONObject {
    val analysisContent = JSONObject()
      .put(
        "type",
        "object"
      )
      .put(
        "properties",
        JSONObject()
          .put("violatedPoints", stringArraySchema())
          .put("nonViolatedPoints", stringArraySchema())
      )
      .put("required", JSONArray().put("violatedPoints").put("nonViolatedPoints"))
      .put("additionalProperties", false)

    val result = JSONObject()
      .put("type", "object")
      .put(
        "properties",
        JSONObject()
          .put("id", JSONObject().put("type", "string"))
          .put("extractedImageText", JSONObject().put("type", "string"))
          .put("description", JSONObject().put("type", "string"))
          .put("analysisContent", analysisContent)
          .put("riskScore", JSONObject().put("type", "integer"))
      )
      .put(
        "required",
        JSONArray()
          .put("id")
          .put("extractedImageText")
          .put("description")
          .put("analysisContent")
          .put("riskScore")
      )
      .put("additionalProperties", false)

    return JSONObject()
      .put("type", "json_schema")
      .put("name", "fact_check_results")
      .put("strict", true)
      .put(
        "schema",
        JSONObject()
          .put("type", "object")
          .put("properties", JSONObject().put("results", arraySchema(result)))
          .put("required", JSONArray().put("results"))
          .put("additionalProperties", false)
      )
  }

  private fun stringArraySchema(): JSONObject =
    JSONObject()
      .put("type", "array")
      .put("items", JSONObject().put("type", "string"))

  private fun arraySchema(itemSchema: JSONObject): JSONObject =
    JSONObject()
      .put("type", "array")
      .put("items", itemSchema)

  private fun parseResponse(body: String): List<SocialAnalysisResult> {
    val response = JSONObject(body)
    if (response.optString("status") != "completed") {
      val reason = response.optJSONObject("incomplete_details")?.optString("reason").orEmpty()
      throw IllegalStateException(
        if (reason.isNotBlank()) "OpenAI 분석 응답이 완료되지 않았습니다. 중단 사유: $reason"
        else "OpenAI 분석 응답이 완료되지 않았습니다."
      )
    }

    val output = response.optJSONArray("output") ?: JSONArray()
    var finalText = ""
    for (index in output.length() - 1 downTo 0) {
      val item = output.optJSONObject(index) ?: continue
      if (item.optString("type") != "message") continue
      if (item.optString("phase") == "commentary") continue
      val parts = item.optJSONArray("content") ?: continue
      val text = buildString {
        for (partIndex in 0 until parts.length()) {
          val part = parts.optJSONObject(partIndex) ?: continue
          if (part.optString("type") == "output_text") {
            append(part.optString("text"))
          }
        }
      }
      if (text.isNotBlank()) {
        finalText = text
        if (item.optString("phase") == "final_answer") break
      }
    }
    if (finalText.isBlank()) {
      throw IllegalStateException("OpenAI가 최종 분석 결과를 반환하지 않았습니다.")
    }

    val results = JSONObject(finalText).optJSONArray("results")
      ?: throw IllegalStateException("OpenAI 분석 결과에 results 배열이 없습니다.")
    return (0 until results.length()).map { index ->
      val result = results.optJSONObject(index)
        ?: throw IllegalStateException("OpenAI 분석 결과 형식이 올바르지 않습니다.")
      val id = result.optString("id")
      val score = result.optInt("riskScore", -1)
      if (id.isBlank() || score !in 0..100) {
        throw IllegalStateException("OpenAI 분석 결과에 유효하지 않은 ID 또는 위험도가 있습니다.")
      }
      SocialAnalysisResult(
        id = id,
        platform = "",
        riskScore = score,
        description = result.optString("description")
      )
    }
  }

  companion object {
    private const val RESPONSES_URL = "https://api.openai.com/v1/responses"

    private val INSTRUCTIONS = """
      당신은 SNS 게시글의 신뢰성(사실여부, 왜곡성 등)을 전문적으로 검증하는 대한민국 최고의 분석가 '커트니'입니다.
      당신은 입력되는 게시글마다 검증하여 riskScore을 책정합니다.
      riskScore는 0부터 100 사이의 정수이며, 거짓/왜곡성이 강할수록 100에 가까워집니다.
      **게시글을 검증할 때에는 무조건 다음 원칙을 따르세요.**

      1. 입력받은 캡션과 첨부 이미지로 게시글을 검증하세요.
      - 이미지에서 확인 가능한 모든 텍스트를 추출(OCR)하십시오.
      - 추출한 텍스트는 결과의 "extractedImageText" 필드에 이미지 출처가 구분되도록 기록하십시오.
      - 이미지가 없거나 텍스트가 전혀 없는 경우에만 "이미지 내 텍스트 없음"으로 기록하십시오.

      2. 일상 게시글 / 순수 재미성 게시글인 경우 검증을 넘어가세요. 다만, 수치 자료가 포함되어있는 경우는 정보성 게시글로 간주합니다.

      3. analysisContent에는 기준별 분석 내용을 나누어 기록하세요.
      - violatedPoints에는 게시글에서 실제로 위반한 기준과 근거를 기록하세요. 위반한 기준이 없으면 빈 배열로 반환하세요.
      - nonViolatedPoints에는 검토했으나 위반하지 않은 기준을 기록하세요. 판단할 자료가 없어 검토할 수 없는 기준은 위반하지 않았다고 단정하지 말고 기록하지 마세요.
      - 각 항목은 해당 기준을 어떻게 적용했는지 알 수 있도록 구체적으로 작성하세요.
      - 게시글에 사실 여부를 확인해야 할 주장, 통계, 인용, 사건 정보가 하나라도 있으면 web_search를 반드시 사용해 확인하세요. 확신이 들거나 학습 데이터로 알고 있는 내용이라도 검색을 생략하지 마세요.
      - 주장의 핵심 문구와 날짜·장소·수치 등 구체 정보를 검색어에 포함하고, 검색 결과가 주장을 직접 뒷받침하는지 확인하세요. 논쟁적이거나 현재 상황에 따라 달라지는 주장은 서로 독립적인 신뢰할 만한 출처를 추가로 검색해 교차 확인하세요.
      - 검색 결과에서 확인하지 못한 내용은 사실로 단정하지 말고, 검색 결과만으로 위반 여부를 판단할 수 없으면 위반으로 기록하지 마세요.

      4. description에는 이 게시글이 왜 위험 기준에 걸렸는지, 사용자가 판정 근거를 확인할 수 있도록 설명하세요. 게시글이나 이미지의 내용을 소개·요약하는 것으로 대체하지 마세요.
      - violatedPoints가 있으면 각 위반점에 대해 (a) 실제 문제가 된 게시글의 주장이나 표현을 구체적으로 밝히고, (b) 검색으로 확인한 신뢰할 만한 출처와 그 출처가 확인해 주는 사실을 제시하고, (c) 둘 사이의 구체적인 불일치·왜곡·근거 부족이 무엇인지 논리적으로 설명하세요. 이 세 요소 중 하나라도 빠진 일반적인 감상이나 줄거리 요약은 판정 설명으로 인정하지 않습니다.
      - 게시글에 여러 위반점이 있으면 각각의 주장과 근거를 모두 설명하세요. 실제로 위반한 점이 없으면 위험한 게시글처럼 설명하지 말고 "위반한 기준이 없습니다."라고 하세요. 확인 불가를 허위의 증거로 취급하지 마세요.
      - 설명에 게시글 순번이나 ID처럼 판정 근거가 아닌 식별 정보를 쓰지 마세요. 입력에 붙은 ID는 결과를 연결하기 위한 내부 정보일 뿐이며 description에 복사하지 마세요.
      - 이미지의 촬영자·촬영일·장면 등은 그 자체가 위반 근거가 아니면 설명에서 언급하지 마세요. 캡션과 무관한 이미지 내용도 나열하지 마세요.
      - 짧은 한 줄 요약으로 축약하지 말고, 사용자가 왜 필터링됐는지 이해하도록 검증 근거와 판단 과정을 충분히 설명하세요. 단, 확인되지 않은 출처나 사실을 만들어내지 마세요.
      - 제목, 소제목, 목록, 번호, 글머리 기호, 마크다운, 줄바꿈, 점수 표기 없이 자연스러운 문단으로 작성하세요. analysisContent 문구를 그대로 복사하지 말고, 근거와 판단 과정을 풀어 쓰세요.
      - 위반한 사항이 없으면 "위반한 기준이 없습니다." 한 문장만 작성하세요.
      - 사용자가 이해하기 쉽게 정돈된 문장으로 작성하고, 어투는 -다, -입니다, -하기에, -이므로 체를 사용하세요.

      [기준]
      - 이미지와 게시글이 불일치 하는 경우(총 +35)
        - 이미지 속 내용과 게시글 캡션의 설명이 전혀 다른 경우: +15
        - 이미지 속에서 설명한 내용이 캡션에 교묘하게 바뀌어있는 경우: +20
      - 사실 확인이 제대로 되지 않은 정보를 확실한 정보마냥 설명한 경우(총 +40)
        - 명백히 사실과 다르거나 조작된 주장: +8
        - 음모론, 확인되지 않은 악의적 루머의 기정사실화: +8
        - 맥락을 악의적으로 잘라내어 오해를 유발하는 글: +8
        - 오래된 정보를 최신 사실처럼 제시하거나, 과거 사건의 사진을 현재 사건처럼 사용하는 경우: +8
        - 출처 없는 "카더라" 정보, 전문가·기관 사칭, 존재하지 않는 연구/기관 인용: +8
      - 통계자료를 가지고 왜곡하여 결론을 도출한 경우(총 +20)
        - 상관관계를 인과관계로 비약하거나 억지 주장: +5
        - 표본 편향 및 체리피킹 (유리한 수치나 기간만 발췌): +5
        - 왜곡된 그래프/수치 인용, 출처가 불분명하거나 조작된 통계: +5
        - 단위 왜곡 또는 전체 맥락을 은폐한 퍼센트 과장: +5

      5. 기준을 바탕으로 riskScore를 책정하세요.
      6. 입력된 모든 게시글에 대해 빠짐없이 results에 하나씩 결과를 반환하세요. id는 입력된 게시글 ID를 그대로 사용하세요.
    """.trimIndent()

    fun parsePosts(json: String): List<SocialPost> {
      require(json.length <= 1_000_000) { "게시글 데이터가 너무 큽니다." }
      val array = JSONArray(json)
      require(array.length() <= 10) { "한 번에 검사할 수 있는 게시글은 최대 10개입니다." }
      return (0 until array.length()).map { index ->
        val post = array.optJSONObject(index)
          ?: throw IllegalArgumentException("게시글 데이터 형식이 올바르지 않습니다.")
        val id = post.optString("id")
        val platform = post.optString("platform")
        require(id.isNotBlank() && platform in setOf("x", "instagram")) {
          "지원하지 않는 게시글 데이터입니다."
        }
        val imageArray = post.optJSONArray("imageUrls") ?: JSONArray()
        val images = (0 until imageArray.length())
          .map { imageArray.optString(it) }
          .filter { it.startsWith("https://") }
          .distinct()
          .take(5)
        SocialPost(
          id = id,
          platform = platform,
          content = post.optString("content").take(20_000),
          imageUrls = images
        )
      }
    }
  }
}
