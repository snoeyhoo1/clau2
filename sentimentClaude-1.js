// lib/sentimentClaude.js
// ANTHROPIC_API_KEY 환경변수가 설정된 경우, 키워드 매칭 대신 Claude로
// 뉴스 헤드라인의 맥락(반어법, 업종 뉘앙스)뿐 아니라 "이 헤드라인이 실제로
// 이 종목과 관련 있는지"까지 판단해서 무관한 뉴스를 걸러내고 점수를 매김.
// 키가 없거나 호출 실패 시 null을 반환 -> signalEngine에서 키워드 방식으로 폴백.

async function scoreWithClaude(headlines, ticker, companyLabel) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !headlines || headlines.length === 0) return null;

  const label = companyLabel || ticker;
  const headlineList = headlines
    .map((h, i) => `${i + 1}. [${h.publishedAt ? new Date(h.publishedAt).toISOString().slice(0, 10) : '날짜불명'}] ${h.title}`)
    .join('\n');

  const prompt = `너는 주식 뉴스 분석가다. 아래는 "${label}"(티커: ${ticker}) 관련으로 수집된
뉴스 헤드라인 목록이다. 하지만 검색 기반 수집이라 실제로는 무관한 뉴스가 섞여 있을 수 있다.

각 헤드라인에 대해:
1. relevant: 이 종목의 주가에 실제 영향을 줄 만한 내용인가 (true/false).
   회사명이 우연히 언급됐을 뿐 실질적 관련이 없으면 false.
2. sentiment: 관련 있는 경우, 주가에 미칠 영향을 -2(매우 부정) ~ +2(매우 긍정) 정수로 평가.
   관련 없으면 0.
3. reason: 15자 이내 한국어 한 줄 이유.

그리고 마지막에 relevant=true인 헤드라인들만 종합해서 overallScore를
-100(매우 부정적) ~ +100(매우 긍정적) 정수로 산출하라. 최신 뉴스에 더 큰 비중을 둬라.

헤드라인 목록:
${headlineList}

오직 아래 JSON 형식으로만 답하라. 다른 텍스트나 코드블록 표시는 절대 포함하지 마라:
{"items": [{"index": 1, "relevant": true, "sentiment": 1, "reason": "..."}], "overallScore": <정수>}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API 오류 (${res.status})`);
    const data = await res.json();
    const text = data.content?.find((b) => b.type === 'text')?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const relevantCount = items.filter((i) => i.relevant).length;

    const breakdown = items.map((item) => {
      const original = headlines[item.index - 1];
      return {
        title: original?.title || '',
        source: original?.source,
        publishedAt: original?.publishedAt,
        relevant: !!item.relevant,
        sentiment: item.sentiment > 0 ? 'positive' : item.sentiment < 0 ? 'negative' : 'neutral',
        reason: item.reason || '',
      };
    });

    return {
      score: Math.max(-100, Math.min(100, parsed.overallScore ?? 0)),
      detail: `Claude 분석: 전체 ${headlines.length}개 중 관련 뉴스 ${relevantCount}개 반영`,
      headlines: breakdown,
      source: 'claude',
    };
  } catch (err) {
    console.error('Claude 감성분석 실패, 키워드 방식으로 폴백:', err.message);
    return null;
  }
}

module.exports = { scoreWithClaude };
