// lib/sentiment.js
// 키워드 기반 뉴스 감성분석. 외부 API 키 없이 동작.
// 부정어("not", "no" 등)를 감지해서 반전 처리하고, 최신 뉴스일수록 가중치를 더 줌.
// Claude API가 설정돼 있으면 sentimentClaude.js가 이 함수 대신 우선 사용됨.

const POSITIVE_WORDS = [
  'surge', 'soar', 'rally', 'beat', 'beats', 'upgrade', 'upgraded', 'record high',
  'growth', 'grow', 'growing', 'grows', 'profit', 'gain', 'gains', 'jump', 'jumps', 'strong',
  'outperform', 'bullish', 'buy rating', 'raise', 'raised', 'exceed', 'exceeds', 'breakthrough',
  'expansion', 'partnership', 'approval', 'approved', 'positive',
  '급등', '호실적', '상향', '상승', '호재', '개선', '흑자', '수주', '승인', '신고가', '성장',
];

const NEGATIVE_WORDS = [
  'plunge', 'plummet', 'crash', 'miss', 'misses', 'downgrade', 'downgraded',
  'loss', 'losses', 'declin', 'drop', 'drops', 'weak', 'underperform',
  'bearish', 'sell rating', 'cut', 'lawsuit', 'investigation', 'recall',
  'bankruptcy', 'layoff', 'layoffs', 'warn', 'fraud', 'scandal', 'negative',
  '급락', '적자', '하향', '하락', '악재', '부진', '소송', '리콜', '조사', '신저가', '감소',
];

// 이 단어들 뒤(최대 3단어 이내)에 감성어가 오면 부호를 반전 ("not growing" -> 부정으로 처리)
const NEGATORS = ['not', "n't", 'no', 'never', 'without', '안', '못', '없이'];

function scoreHeadline(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  let score = 0;

  function hasNegatorNearby(index) {
    const windowStart = Math.max(0, index - 3);
    return words.slice(windowStart, index).some((w) => NEGATORS.includes(w));
  }

  words.forEach((word, i) => {
    const isPos = POSITIVE_WORDS.some((w) => word.includes(w.toLowerCase()));
    const isNeg = NEGATIVE_WORDS.some((w) => word.includes(w.toLowerCase()));
    if (isPos) score += hasNegatorNearby(i) ? -1 : 1;
    else if (isNeg) score += hasNegatorNearby(i) ? 1 : -1;
  });

  // 공백 포함 복합 표현(예: 'record high', 'buy rating')은 단어 단위 검사로 못 잡으니
  // 원문 전체에서 한 번 더 검사 (부정어 반전은 근사치로 생략)
  for (const w of POSITIVE_WORDS) {
    if (w.includes(' ') && lower.includes(w)) score += 1;
  }
  for (const w of NEGATIVE_WORDS) {
    if (w.includes(' ') && lower.includes(w)) score -= 1;
  }

  return score;
}

function recencyWeight(publishedAt) {
  if (!publishedAt) return 0.6; // 날짜 모르면 중간 가중치
  const daysAgo = (Date.now() - new Date(publishedAt).getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0.3, 1 - daysAgo / 10); // 오늘=1.0, 10일 전=0.3(하한)
}

// headlines: { title, source, publishedAt }[] (getHeadlines()의 반환 형식)
// 반환: -100 ~ 100 점수 + 헤드라인별 상세 분석
function sentimentScore(headlines) {
  if (!headlines || headlines.length === 0) {
    return { score: 0, matched: 0, total: 0, detail: '뉴스 없음', headlines: [], source: 'keyword' };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let matched = 0;
  const breakdown = [];

  for (const h of headlines) {
    const raw = scoreHeadline(h.title);
    const weight = recencyWeight(h.publishedAt);
    weightedSum += raw * weight;
    weightTotal += weight;
    if (raw !== 0) matched++;
    breakdown.push({
      title: h.title,
      source: h.source,
      publishedAt: h.publishedAt,
      sentiment: raw > 0 ? 'positive' : raw < 0 ? 'negative' : 'neutral',
    });
  }

  const avg = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const score = Math.max(-100, Math.min(100, avg * 40));

  return {
    score,
    matched,
    total: headlines.length,
    detail: `${headlines.length}개 뉴스 중 ${matched}개에서 감성 키워드 감지 (최신 뉴스 가중치 적용)`,
    headlines: breakdown,
    source: 'keyword',
  };
}

module.exports = { sentimentScore, scoreHeadline };
