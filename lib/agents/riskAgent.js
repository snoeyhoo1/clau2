/*
 * lib/agents/riskAgent.js
 *
 * Risk / Position Safety Agent
 */

function clamp(
  value,
  min = -100,
  max = 100
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.max(
    min,
    Math.min(max, n)
  );
}


function num(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n
    : null;
}


function riskAgent({
  bars = [],
  signal = 0,
  account = {},
  position = {},
  market = {},
  regime = 'UNKNOWN',
} = {}) {

  const lastBar =
    bars.at(-1) || {};

  const close =
    num(
      lastBar.close
    );

  const atr =
    num(
      lastBar.atr
    ) ||
    num(
      position.atr
    );


  /*
   * bars에 ATR이 없으면
   * 최근 range 기반으로 대략 계산.
   */
  let atrValue = atr;

  if (
    atrValue === null &&
    bars.length >= 15
  ) {
    const recent =
      bars.slice(-14);

    const ranges =
      recent
        .map(
          b =>
            num(b.high) !== null &&
            num(b.low) !== null
              ? Math.abs(
                  Number(b.high) -
                  Number(b.low)
                )
              : null
        )
        .filter(
          Number.isFinite
        );

    if (ranges.length) {
      atrValue =
        ranges.reduce(
          (a, b) => a + b,
          0
        ) /
        ranges.length;
    }
  }


  let score = 0;

  let blocked =
    false;

  const reasons = [];

  /*
   * ----------------------------------------------------------
   * 1. Extreme volatility
   * ----------------------------------------------------------
   */

  const vix =
    num(
      market.vix
    );

  if (
    Number.isFinite(vix)
  ) {
    if (vix >= 35) {
      score -= 60;
      blocked = true;

      reasons.push(
        'VIX 극단적 고변동'
      );
    } else if (
      vix >= 28
    ) {
      score -= 30;

      reasons.push(
        'VIX 고변동'
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * 2. ATR risk
   * ----------------------------------------------------------
   */

  let atrPct = null;

  if (
    close !== null &&
    atrValue !== null &&
    close > 0
  ) {
    atrPct =
      atrValue /
      close *
      100;

    if (atrPct >= 7) {
      score -= 70;
      blocked = true;

      reasons.push(
        '극단적 ATR'
      );
    } else if (
      atrPct >= 5
    ) {
      score -= 40;

      reasons.push(
        '높은 ATR'
      );
    } else if (
      atrPct <= 0.25
    ) {
      score -= 15;

      reasons.push(
        '거래 기회 부족'
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * 3. Position size
   * ----------------------------------------------------------
   */

  const equity =
    num(
      account.equity ??
      account.totalValue ??
      account.cash
    );

  const positionValue =
    num(
      position.marketValue ??
      position.value
    );

  let positionPct = null;

  if (
    equity !== null &&
    equity > 0 &&
    positionValue !== null
  ) {
    positionPct =
      positionValue /
      equity *
      100;

    /*
     * 단일 종목 과도한 집중.
     */
    if (
      positionPct >= 30
    ) {
      score -= 60;

      if (signal === 1) {
        blocked = true;
      }

      reasons.push(
        '단일 종목 비중 과다'
      );
    } else if (
      positionPct >= 20
    ) {
      score -= 25;

      reasons.push(
        '포지션 비중 높음'
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * 4. Existing position drawdown
   * ----------------------------------------------------------
   */

  const pnlPct =
    num(
      position.profitLossPct ??
      position.pnlPct
    );

  if (
    pnlPct !== null
  ) {
    if (
      pnlPct <= -8
    ) {
      score -= 60;

      reasons.push(
        '큰 손실 포지션'
      );

      /*
       * 이미 보유 중이라면
       * 추가매수를 막는다.
       */
      if (signal === 1) {
        blocked = true;
      }
    } else if (
      pnlPct <= -5
    ) {
      score -= 30;

      reasons.push(
        '손실 확대'
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * 5. Market regime
   * ----------------------------------------------------------
   */

  if (
    regime ===
    'BEAR' ||
    regime ===
    'BEAR_TREND'
  ) {
    if (signal === 1) {
      score -= 45;

      reasons.push(
        '약세 시장에서 신규 LONG'
      );
    }
  }

  if (
    regime ===
    'HIGH_VOL'
  ) {
    if (signal === 1) {
      score -= 30;

      reasons.push(
        '고변동 시장'
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * 6. Overnight / gap risk
   * ----------------------------------------------------------
   */

  if (
    bars.length >= 2
  ) {
    const prev =
      num(
        bars.at(-2).close
      );

    const open =
      num(
        bars.at(-1).open
      );

    if (
      prev !== null &&
      open !== null &&
      prev > 0
    ) {
      const gap =
        (
          open -
          prev
        ) /
        prev *
        100;

      if (
        Math.abs(gap) >= 8
      ) {
        score -= 50;

        if (
          signal === 1
        ) {
          blocked = true;
        }

        reasons.push(
          '극단적 갭'
        );
      }
    }
  }


  /*
   * ----------------------------------------------------------
   * 7. No data = no confidence
   * ----------------------------------------------------------
   */

  if (
    bars.length < 30
  ) {
    score -= 30;
    blocked = true;

    reasons.push(
      '위험 분석 데이터 부족'
    );
  }


  /*
   * 최종.
   */

  score =
    clamp(score);

  return {
    name: 'RISK',

    score,

    confidence:
      blocked
        ? 0.95
        : 0.8,

    blocked,

    evidence: {
      atrPct,
      vix,
      positionPct,
      pnlPct,
      regime,
      reasons,
    },
  };
}


module.exports = {
  riskAgent,
};
