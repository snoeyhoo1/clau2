// lib/backtest.js
// 과거 종가로 "기술점수 신호대로 매매했다면 어땠을지" 시뮬레이션.
// 주의: 과거 뉴스 헤드라인은 구할 수 없으므로 기술적 지표만으로 백테스트함.
// (실제 운영 시스템은 기술+뉴스 결합이라, 이 백테스트는 절반만 검증하는 것)

const { technicalScore } = require('./indicators');

function maxDrawdown(equityCurve) {
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

/**
 * closes: number[] (과거 -> 최신 순)
 * dates: string[] (closes와 같은 길이, ISO 날짜)
 * buyThreshold / sellThreshold: 진입/청산 기준 점수
 * lookback: 기술점수 계산에 필요한 최소 데이터 길이
 */
function runBacktest(closes, dates, { buyThreshold = 40, sellThreshold = -10, lookback = 30 } = {}) {
  if (closes.length < lookback + 10) {
    throw new Error('백테스트에 필요한 데이터가 부족합니다 (최소 40일 이상 필요)');
  }

  let inPosition = false;
  let entryPrice = 0;
  let cash = 1; // 정규화된 자본 (1 = 100%)
  const equityCurve = [1];
  const trades = [];

  for (let t = lookback; t < closes.length; t++) {
    const windowCloses = closes.slice(0, t + 1); // t 시점까지의 데이터만 사용 (미래 참조 방지)
    const { score } = technicalScore(windowCloses);
    const price = closes[t];

    if (!inPosition && score >= buyThreshold) {
      inPosition = true;
      entryPrice = price;
      trades.push({ type: 'BUY', date: dates[t], price });
    } else if (inPosition && score <= sellThreshold) {
      inPosition = false;
      const ret = (price - entryPrice) / entryPrice;
      cash *= 1 + ret;
      trades.push({ type: 'SELL', date: dates[t], price, returnPct: (ret * 100).toFixed(2) });
    }

    // 자본곡선 갱신 (포지션 보유 중이면 미실현 손익 반영)
    const unrealized = inPosition ? cash * (1 + (price - entryPrice) / entryPrice) : cash;
    equityCurve.push(unrealized);
  }

  // 마지막까지 포지션 보유 중이면 마지막 가격으로 청산 처리(평가)
  if (inPosition) {
    const lastPrice = closes[closes.length - 1];
    const ret = (lastPrice - entryPrice) / entryPrice;
    cash *= 1 + ret;
  }

  const strategyReturn = (cash - 1) * 100;
  const buyHoldReturn = ((closes[closes.length - 1] - closes[lookback]) / closes[lookback]) * 100;

  const completedTrades = trades.filter((t) => t.type === 'SELL');
  const wins = completedTrades.filter((t) => parseFloat(t.returnPct) > 0).length;
  const winRate = completedTrades.length > 0 ? (wins / completedTrades.length) * 100 : null;

  return {
    strategyReturnPct: strategyReturn.toFixed(2),
    buyHoldReturnPct: buyHoldReturn.toFixed(2),
    numTrades: completedTrades.length,
    winRatePct: winRate !== null ? winRate.toFixed(1) : 'N/A',
    maxDrawdownPct: (maxDrawdown(equityCurve) * 100).toFixed(2),
    trades: trades.slice(-10), // 최근 10건만 반환
    equityCurve, // 프론트에서 스파크라인 그릴 때 사용
    limitation: '이 백테스트는 기술적 지표만 반영합니다. 실제 신호는 뉴스 감성(35%)도 포함되지만 과거 헤드라인 데이터가 없어 검증할 수 없습니다.',
  };
}

/**
 * "지금과 비슷한 신호가 과거에 떴을 때, N거래일 후 실제로 올랐던 비율"을 계산.
 * 통계적으로 검증된 확률이 아니라 과거 데이터 기반 참고 지표임 — 표본 수(sampleSize)를
 * 반드시 같이 제공해서 신뢰도를 스스로 판단할 수 있게 함.
 *
 * 개선점:
 * - 여러 기간(3/5/10거래일)을 한 번에 계산해서 단기/중기 경향을 같이 보여줌
 * - 표본이 너무 적으면(minSample 미만) 허용 오차를 자동으로 넓혀 재시도 (넓혔다는 사실을 note에 명시)
 * - 상승/하락 비율뿐 아니라 평균 수익률(%)도 같이 제공 ("얼마나" 움직였는지)
 *
 * closes: number[] (과거 -> 최신)
 * currentScore: 지금 계산된 기술점수 (-100~100)
 */
function computeUpProbability(closes, currentScore, { tolerance = 15, forwardDaysList = [3, 5, 10], lookback = 30, minSample = 8 } = {}) {
  const maxForward = Math.max(...forwardDaysList);
  if (closes.length < lookback + maxForward + 10) {
    return { byHorizon: {}, note: '데이터 부족으로 계산 불가' };
  }

  // 기술점수를 한 번만 계산해서 여러 기간 계산에 재사용 (성능 최적화)
  const scoreAtT = new Array(closes.length).fill(null);
  for (let t = lookback; t < closes.length; t++) {
    scoreAtT[t] = technicalScore(closes.slice(0, t + 1)).score;
  }

  function computeForHorizon(forwardDays, tol) {
    let upCount = 0;
    let sampleCount = 0;
    let returnSum = 0;
    for (let t = lookback; t < closes.length - forwardDays; t++) {
      if (Math.abs(scoreAtT[t] - currentScore) <= tol) {
        sampleCount++;
        const fwdReturn = (closes[t + forwardDays] - closes[t]) / closes[t];
        returnSum += fwdReturn;
        if (fwdReturn > 0) upCount++;
      }
    }
    return { upCount, sampleCount, avgReturn: sampleCount > 0 ? (returnSum / sampleCount) * 100 : null };
  }

  const byHorizon = {};
  for (const forwardDays of forwardDaysList) {
    let tol = tolerance;
    let result = computeForHorizon(forwardDays, tol);
    let widened = false;

    // 표본이 너무 적으면 허용 오차를 넓혀서 한 번 더 시도 (최대 2번)
    let attempts = 0;
    while (result.sampleCount < minSample && attempts < 2) {
      tol *= 1.7;
      result = computeForHorizon(forwardDays, tol);
      widened = true;
      attempts++;
    }

    if (result.sampleCount === 0) {
      byHorizon[forwardDays] = { probability: null, sampleSize: 0, note: '유사 신호 사례 없음' };
      continue;
    }

    const probability = Math.round((result.upCount / result.sampleCount) * 100);
    const confidence = result.sampleCount >= 20 ? '표본 충분' : result.sampleCount >= minSample ? '표본 보통' : '표본 적음(참고만)';

    byHorizon[forwardDays] = {
      probability,
      sampleSize: result.sampleCount,
      avgReturnPct: result.avgReturn !== null ? result.avgReturn.toFixed(2) : null,
      confidence,
      toleranceUsed: Math.round(tol),
      widened,
      note: `과거 ${result.sampleCount}회 유사 신호 중 ${result.upCount}회 ${forwardDays}거래일 후 상승, 평균 ${result.avgReturn !== null ? result.avgReturn.toFixed(2) : '?'}%`
        + (widened ? ' (표본 부족으로 유사 기준 완화 적용)' : ''),
    };
  }

  return { byHorizon, primaryHorizon: forwardDaysList.includes(5) ? 5 : forwardDaysList[0] };
}

module.exports = { runBacktest, computeUpProbability };
