// lib/sentimentClaude.js
//
// Claude 기반 뉴스 감성 분석
//
// 개선 사항
// - 헤드라인 수 제한으로 프롬프트 크기 감소
// - Claude 요청 timeout 추가
// - 짧은 시간 동안 동일 종목의 중복 분석 방지
// - JSON 파싱 실패를 안전하게 fallback
// - 기존 signalEngine.js 반환 형식 유지
//
// ANTHROPIC_API_KEY가 없거나 Claude 호출에 실패하면
// signalEngine.js에서 rule-based sentiment로 fallback한다.

const CLAUDE_TIMEOUT_MS =
  12 * 1000;

const NEWS_LIMIT =
  10;

const CACHE_TTL_MS =
  5 * 60 * 1000;

const analysisCache =
  new Map();

const inFlight =
  new Map();

function normalizeTicker(
  ticker
) {
  return String(
    ticker || ''
  )
    .trim()
    .toUpperCase();
}

function normalizeLabel(
  label,
  ticker
) {
  return String(
    label || ticker || ''
  )
    .trim();
}

function cacheKey(
  ticker,
  label,
  headlines
) {
  const headlineKey =
    headlines
      .slice(0, NEWS_LIMIT)
      .map(
        item =>
          [
            item?.title || '',
            item?.publishedAt || '',
          ].join('|')
      )
      .join('||');

  return [
    normalizeTicker(ticker),
    normalizeLabel(
      label,
      ticker
    ),
    headlineKey,
  ].join(':::');
}

function getCached(
  key
) {
  const entry =
    analysisCache.get(
      key
    );

  if (!entry) {
    return null;
  }

  if (
    Date.now() -
      entry.time >=
    CACHE_TTL_MS
  ) {
    analysisCache.delete(
      key
    );

    return null;
  }

  return entry.value;
}

function setCached(
  key,
  value
) {
  analysisCache.set(
    key,
    {
      time: Date.now(),
      value,
    }
  );

  return value;
}

function buildHeadlineList(
  headlines
) {
  return headlines
    .slice(0, NEWS_LIMIT)
    .map(
      (h, i) => {
        const date =
          h?.publishedAt
            ? new Date(
                h.publishedAt
              )
                .toISOString()
                .slice(0, 10)
            : '날짜불명';

        const title =
          String(
            h?.title || ''
          )
            .replace(
              /\s+/g,
              ' '
            )
            .trim();

        return (
          `${i + 1}. ` +
          `[${date}] ` +
          title
        );
      }
    )
    .join('\n');
}

function buildPrompt(
  headlines,
  ticker,
  label
) {
  const headlineList =
    buildHeadlineList(
      headlines
    );

  return `너는 주식 뉴스 분석가다.

대상:
- 종목: ${label}
- 티커: ${ticker}

아래 뉴스 헤드라인은 검색 기반으로 수집되어
무관한 뉴스가 일부 포함될 수 있다.

각 헤드라인에 대해:
1. relevant: 이 종목의 주가에 실제 영향을 줄 만한 내용이면 true, 아니면 false.
2. sentiment: 관련 뉴스라면 -2 ~ +2 정수.
3. reason: 15자 이내의 짧은 한국어 이유.

마지막에는 relevant=true인 뉴스만 고려하여
overallScore를 -100 ~ +100 정수로 계산한다.
최신 뉴스에 더 큰 비중을 둔다.

뉴스:
${headlineList}

반드시 아래 JSON 하나만 반환하라.
마크다운 코드블록이나 설명을 붙이지 마라.

{"items":[{"index":1,"relevant":true,"sentiment":1,"reason":"이유"}],"overallScore":0}`;
}

function createTimeoutSignal(
  timeoutMs
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      timeoutMs
    );

  return {
    controller,
    timer,
  };
}

function clampScore(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 0;
  }

  return Math.max(
    -100,
    Math.min(
      100,
      Math.round(number)
    )
  );
}

function cleanJsonText(
  text
) {
  return String(
    text || ''
  )
    .replace(
      /```json/gi,
      ''
    )
    .replace(
      /```/g,
      ''
    )
    .trim();
}

function buildBreakdown(
  items,
  headlines
) {
  if (
    !Array.isArray(items)
  ) {
    return [];
  }

  return items
    .map(item => {
      const index =
        Number(
          item?.index
        );

      if (
        !Number.isInteger(
          index
        ) ||
        index < 1 ||
        index >
          headlines.length
      ) {
        return null;
      }

      const original =
        headlines[
          index - 1
        ];

      const sentiment =
        Number(
          item?.sentiment
        );

      return {
        title:
          original?.title ||
          '',

        source:
          original?.source,

        publishedAt:
          original?.publishedAt,

        relevant:
          Boolean(
            item?.relevant
          ),

        sentiment:
          sentiment > 0
            ? 'positive'
            : sentiment < 0
              ? 'negative'
              : 'neutral',

        reason:
          String(
            item?.reason || ''
          )
            .slice(0, 15),
      };
    })
    .filter(Boolean);
}

async function requestClaude(
  headlines,
  ticker,
  label
) {
  const apiKey =
    process.env
      .ANTHROPIC_API_KEY;

  if (
    !apiKey ||
    headlines.length === 0
  ) {
    return null;
  }

  const {
    controller,
    timer,
  } =
    createTimeoutSignal(
      CLAUDE_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'x-api-key':
              apiKey,

            'anthropic-version':
              '2023-06-01',
          },

          body: JSON.stringify({
            model:
              'claude-sonnet-4-6',

            max_tokens:
              800,

            messages: [
              {
                role:
                  'user',

                content:
                  buildPrompt(
                    headlines,
                    ticker,
                    label
                  ),
              },
            ],
          }),

          signal:
            controller.signal,
        }
      );

    if (!response.ok) {
      throw new Error(
        `Claude API 오류 (${response.status})`
      );
    }

    const data =
      await response.json();

    const text =
      Array.isArray(
        data?.content
      )
        ? data.content
            .find(
              block =>
                block?.type ===
                'text'
            )
            ?.text || ''
        : '';

    const cleaned =
      cleanJsonText(
        text
      );

    if (!cleaned) {
      throw new Error(
        'Claude 응답이 비어 있습니다.'
      );
    }

    let parsed;

    try {
      parsed =
        JSON.parse(
          cleaned
        );
    } catch {
      throw new Error(
        'Claude JSON 응답 파싱 실패'
      );
    }

    const items =
      Array.isArray(
        parsed?.items
      )
        ? parsed.items
        : [];

    const breakdown =
      buildBreakdown(
        items,
        headlines
      );

    const relevantCount =
      breakdown.filter(
        item =>
          item.relevant
      ).length;

    return {
      score:
        clampScore(
          parsed?.overallScore
        ),

      detail:
        `Claude 분석: 전체 ${headlines.length}개 중 관련 뉴스 ${relevantCount}개 반영`,

      headlines:
        breakdown,

      source:
        'claude',
    };

  } finally {
    clearTimeout(
      timer
    );
  }
}

async function scoreWithClaude(
  headlines,
  ticker,
  companyLabel
) {
  const apiKey =
    process.env
      .ANTHROPIC_API_KEY;

  if (
    !apiKey ||
    !Array.isArray(
      headlines
    ) ||
    headlines.length === 0
  ) {
    return null;
  }

  const normalizedHeadlines =
    headlines
      .filter(
        item =>
          item &&
          String(
            item.title || ''
          ).trim()
      )
      .slice(
        0,
        NEWS_LIMIT
      );

  if (
    normalizedHeadlines.length ===
    0
  ) {
    return null;
  }

  const normalizedTicker =
    normalizeTicker(
      ticker
    );

  const normalizedLabel =
    normalizeLabel(
      companyLabel,
      normalizedTicker
    );

  const key =
    cacheKey(
      normalizedTicker,
      normalizedLabel,
      normalizedHeadlines
    );

  const cached =
    getCached(key);

  if (cached) {
    return cached;
  }

  const existing =
    inFlight.get(key);

  if (existing) {
    try {
      return await existing;
    } catch {
      return null;
    }
  }

  const promise =
    requestClaude(
      normalizedHeadlines,
      normalizedTicker,
      normalizedLabel
    )
      .then(result => {
        if (result) {
          setCached(
            key,
            result
          );
        }

        return result;
      })
      .catch(err => {
        console.error(
          'Claude 감성분석 실패, 키워드 방식으로 폴백:',
          err?.message ||
            err
        );

        return null;
      })
      .finally(() => {
        inFlight.delete(
          key
        );
      });

  inFlight.set(
    key,
    promise
  );

  return promise;
}

module.exports = {
  scoreWithClaude,
};
