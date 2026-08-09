// lib/signalEngine.js
const { technicalScore } = require('./indicators');
const { sentimentScore } = require('./sentiment');
const { scoreWithClaude } = require('./sentimentClaude');
const { computeUpProbability } = require('./backtest');
const { getQuoteAndHistory, getHeadlines } = require('./dataSources');

const TECH_WEIGHT = 0.65; // 기술적 지표 비중
const NEWS_WEIGHT = 0.35; // 뉴스 감성 비중

function classify(score) {
  if (score >= 40) return { label: '매수 우세', color: 'buy' };
  if (score <= -40) return { label: '매도 우세', color: 'sell' };
  return { label: '중립', color: 'hold' };
}

async function buildSignal(ticker, label) {
  // 3년치를 받아서 기술점수(최근 구간)와 상승확률 통계(전체 구간)를 함께 계산.
  // 5년으로 더 늘리면 표본은 늘지만 서버리스 함수 실행시간 제한에 걸릴 위험이 커져서 3년으로 절충.
  const quote = await getQuoteAndHistory(ticker, '3y');
  const headlines = await getHeadlines(ticker, 10, label);

  const tech = technicalScore(quote.closes);
  const claudeResult = await scoreWithClaude(headlines, ticker, label);
  const news = claudeResult || sentimentScore(headlines);

  const combined = tech.score * TECH_WEIGHT + news.score * NEWS_WEIGHT;
  const classification = classify(combined);
  const upProb = computeUpProbability(quote.closes, tech.score);

  return {
    ticker,
    label: label || ticker,
    currentPrice: quote.currentPrice,
    previousClose: quote.previousClose,
    currency: quote.currency,
    changePct: quote.previousClose
      ? (((quote.currentPrice - quote.previousClose) / quote.previousClose) * 100).toFixed(2)
      : null,
    combinedScore: Math.round(combined),
    classification: classification.label,
    signalColor: classification.color,
    technical: { score: Math.round(tech.score), detail: tech.detail },
    news: { score: Math.round(news.score), detail: news.detail, headlines: news.headlines || [], source: news.source },
    upProbability: upProb,
    updatedAt: new Date().toISOString(),
    disclaimer: '이 신호는 참고용 분석 결과이며 투자 조언이 아닙니다. 최종 매매 판단과 실행은 본인 책임입니다.',
  };
}

async function buildSignals(watchlist) {
  const results = await Promise.allSettled(
    watchlist.map((w) => buildSignal(w.ticker, w.label))
  );
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      ticker: watchlist[i].ticker,
      label: watchlist[i].label,
      error: r.reason?.message || '데이터를 가져오지 못했습니다',
    };
  });
}

// 유니버스 전체를 스캔해서 점수 높은 순으로 정렬 + 시장 breadth 통계 제공
async function scanUniverse(universe) {
  const signals = await buildSignals(universe);
  const valid = signals.filter((s) => !s.error);

  const sorted = [...valid].sort((a, b) => b.combinedScore - a.combinedScore);
  const buyCount = valid.filter((s) => s.signalColor === 'buy').length;
  const sellCount = valid.filter((s) => s.signalColor === 'sell').length;
  const breadth = valid.length > 0 ? Math.round((buyCount / valid.length) * 100) : null;

  return {
    ranked: sorted,
    errors: signals.filter((s) => s.error),
    breadth: {
      buyPct: breadth,
      buyCount,
      sellCount,
      holdCount: valid.length - buyCount - sellCount,
      total: valid.length,
    },
  };
}

module.exports = { buildSignal, buildSignals, scanUniverse };
