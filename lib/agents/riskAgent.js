// lib/agents/riskAgent.js

function clamp(value, min = -100, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function calculateAtr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) {
    return null;
  }

  const trs = [];

  for (
    let i = bars.length - period;
    i < bars.length;
    i++
  ) {
    const current = bars[i];
    const previous = bars[i - 1];

    if (!current || !previous) continue;

    const high = num(current.high);
    const low = num(current.low);
    const previousClose = num(previous.close);

    if (
      high === null ||
      low === null ||
      previousClose === null
    ) {
      continue;
    }

    trs.push(
      Math.max(
        high - low,
        Math.abs(high - previousClose),
        Math.abs(low - previousClose)
      )
    );
  }

  if (!trs.length) return null;

  return (
    trs.reduce((a, b) => a + b, 0) /
    trs.length
  );
}

function riskAgent({
  bars = [],
  signal = 0,
  account = {},
  position = {},
  market = {},
  regime = 'UNKNOWN',
  event = {},
} = {}) {
  const last = bars.at(-1) || {};

  const close = num(last.close);

  const atr =
    num(position.atr) ??
    num(last.atr) ??
    calculateAtr(bars);

  const vix =
    num(market.vix?.currentPrice) ??
    num(market.vix?.price) ??
    num(market.vix);

  let score = 0;
  let blocked = false;

  const reasons = [];
  const warnings = [];

  if (!close || !atr) {
    return {
      name: 'RISK',
      score: -80,
      confidence: 0.95,
      blocked: true,
      evidence: {
        reasons: ['위험 계산 데이터 부족'],
        warnings: [],
      },
    };
  }

  const atrPct =
    (atr / close) * 100;

  /*
   * VIX.
   */
  if (vix !== null) {
    if (vix >= 35) {
      score -= 60;
      blocked = true;
      reasons.push('VIX 극단적 고변동');
    } else if (vix >= 28) {
      score -= 30;
      warnings.push('VIX 고변동');
    } else if (vix >= 22) {
      score -= 10;
    }
  }

  /*
   * ATR.
   */
  if (atrPct >= 7) {
    score -= 70;
    blocked = true;
    reasons.push('극단적 변동성');
  } else if (atrPct >= 5) {
    score -= 35;
    warnings.push('높은 ATR');
  } else if (atrPct <= 0.25) {
    score -= 15;
    warnings.push('변동성 부족');
  } else {
    score += 15;
  }

  /*
   * Gap.
   */
  if (bars.length >= 2) {
    const previousClose = num(
      bars.at(-2)?.close
    );

    const open = num(last.open);

    if (
      previousClose &&
      open &&
      previousClose > 0
    ) {
      const gap =
        ((open - previousClose) /
          previousClose) *
        100;

      if (Math.abs(gap) >= 8) {
        score -= 50;

        if (signal === 1) {
          blocked = true;
        }

        reasons.push(
          `극단적 갭 ${gap.toFixed(2)}%`
        );
      } else if (Math.abs(gap) >= 4) {
        score -= 15;
        warnings.push(
          `큰 갭 ${gap.toFixed(2)}%`
        );
      }
    }
  }

  /*
   * 시장 국면.
   */
  if (
    signal === 1 &&
    (
      regime === 'BEAR' ||
      regime === 'BEAR_TREND' ||
      regime === 'HIGH_VOL'
    )
  ) {
    score -= 30;
    warnings.push(
      '불리한 시장 국면'
    );
  }

  /*
   * Event veto.
   */
  if (
    event?.blocked === true
  ) {
    score -= 80;
    blocked = true;
    reasons.push(
      event.reason ||
      '이벤트 리스크'
    );
  }

  /*
   * Position concentration.
   */
  const equity =
    num(
      account.equity ??
      account.totalValue
    );

  const positionValue =
    num(
      position.marketValue ??
      position.value
    );

  let positionPct = null;

  if (
    equity &&
    equity > 0 &&
    positionValue !== null
  ) {
    positionPct =
      (positionValue / equity) *
      100;

    if (positionPct >= 35) {
      score -= 60;

      if (signal === 1) {
        blocked = true;
      }

      reasons.push(
        '단일 종목 집중 위험'
      );
    } else if (positionPct >= 25) {
      score -= 25;
      warnings.push(
        '포지션 비중 높음'
      );
    } else {
      score += 10;
    }
  }

  /*
   * Existing position loss.
   */
  const pnlPct =
    num(
      position.profitLossPct ??
      position.pnlPct
    );

  if (pnlPct !== null) {
    if (pnlPct <= -10) {
      score -= 50;

      if (signal === 1) {
        blocked = true;
      }

      reasons.push(
        '큰 손실 포지션'
      );
    } else if (pnlPct <= -5) {
      score -= 25;
      warnings.push(
        '손실 확대'
      );
    }
  }

  /*
   * 정상적인 위험 상태에서는
   * 0점이 아니라 양의 안전점수를 준다.
   */
  score = clamp(score);

  return {
    name: 'RISK',
    score,
    confidence: blocked ? 0.98 : 0.82,
    blocked,
    evidence: {
      atr,
      atrPct,
      vix,
      positionPct,
      pnlPct,
      regime,
      reasons,
      warnings,
    },
  };
}

module.exports = {
  riskAgent,
};
