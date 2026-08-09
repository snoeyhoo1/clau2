// lib/indicators.js
// 기술적 지표 계산 함수 모음. stooq/Finnhub에서 받은 종가 배열(closes: number[])을 입력으로 받음.
// 배열은 과거 -> 최신 순서라고 가정.

function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function ema(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = sma(closes.slice(0, period), period);
  for (let i = period; i < closes.length; i++) {
    emaVal = closes[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function emaSeries(closes, period) {
  // EMA 전체 시계열이 필요할 때 (MACD 계산용)
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let emaVal = sma(closes.slice(0, period), period);
  out.push(emaVal);
  for (let i = period; i < closes.length; i++) {
    emaVal = closes[i] * k + emaVal * (1 - k);
    out.push(emaVal);
  }
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (closes.length < slow + signalPeriod) return null;
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  // 두 시계열 길이를 slow 기준으로 맞춤
  const offset = fastSeries.length - slowSeries.length;
  const macdLine = slowSeries.map((v, i) => fastSeries[i + offset] - v);
  const signalLine = emaSeries(macdLine, signalPeriod);
  const histOffset = macdLine.length - signalLine.length;
  const histogram = signalLine.map((v, i) => macdLine[i + histOffset] - v);
  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalLine[signalLine.length - 1],
    histogram: histogram[histogram.length - 1],
  };
}

function bollingerBands(closes, period = 20, stdDevMult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mean + stdDevMult * stdDev,
    middle: mean,
    lower: mean - stdDevMult * stdDev,
  };
}

// 기술적 지표들을 종합해서 -100(강한 매도) ~ +100(강한 매수) 점수로 환산
function technicalScore(closes) {
  if (!closes || closes.length < 30) {
    return { score: 0, detail: {}, reason: '데이터 부족' };
  }

  const last = closes[closes.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, Math.min(50, closes.length - 1));
  const rsiVal = rsi(closes, 14);
  const macdVal = macd(closes);
  const bb = bollingerBands(closes, 20);

  let score = 0;
  const detail = {};

  // 이동평균 정배열/역배열
  if (sma20 && sma50) {
    if (sma20 > sma50) {
      score += 20;
      detail.ma = '골든크로스 구간 (SMA20 > SMA50)';
    } else {
      score -= 20;
      detail.ma = '데드크로스 구간 (SMA20 < SMA50)';
    }
  }

  // 현재가 vs SMA20
  if (sma20) {
    if (last > sma20) score += 10;
    else score -= 10;
  }

  // RSI
  if (rsiVal !== null) {
    detail.rsi = rsiVal.toFixed(1);
    if (rsiVal < 30) {
      score += 25; // 과매도 -> 반등 기대
      detail.rsiSignal = '과매도';
    } else if (rsiVal > 70) {
      score -= 25; // 과매수 -> 조정 경계
      detail.rsiSignal = '과매수';
    }
  }

  // MACD
  if (macdVal) {
    detail.macdHistogram = macdVal.histogram.toFixed(3);
    if (macdVal.histogram > 0) score += 15;
    else score -= 15;
  }

  // 볼린저밴드
  if (bb) {
    if (last <= bb.lower) {
      score += 15;
      detail.bbSignal = '하단밴드 근접(반등 가능)';
    } else if (last >= bb.upper) {
      score -= 15;
      detail.bbSignal = '상단밴드 근접(과열 가능)';
    }
  }

  // -100 ~ 100 범위로 클램프
  score = Math.max(-100, Math.min(100, score));

  return { score, detail };
}

module.exports = {
  sma,
  ema,
  rsi,
  macd,
  bollingerBands,
  technicalScore,
};
