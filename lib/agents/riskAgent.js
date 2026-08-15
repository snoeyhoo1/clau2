function clamp(v, min = -100, max = 100) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

function riskAgent({
  bars = [],
  signal = null,
  account = {},
  position = {},
}) {
  if (!bars.length) {
    return {
      name: 'RISK',
      direction: 'NEUTRAL',
      score: 0,
      confidence: 0.1,
      blocked: true,
      reasons: ['가격 데이터 없음'],
    };
  }

  const last =
    Number(bars.at(-1).close);

  const prev =
    Number(
      bars.at(-2)?.close ||
      last
    );

  const gapPct =
    prev
      ? Math.abs(
          (last - prev) /
            prev *
            100
        )
      : 0;

  let score = 0;
  let blocked = false;

  const reasons = [];

  /*
   * 극단적 갭.
   */
  if (gapPct > 8) {
    score -= 60;
    blocked = true;
    reasons.push(
      '비정상적인 가격 갭'
    );
  } else if (gapPct > 5) {
    score -= 35;
    reasons.push(
      '큰 가격 갭'
    );
  }

  /*
   * 계좌 리스크.
   */
  const equity =
    Number(
      account.equity
    );

  const dailyLoss =
    Number(
      account.dailyLossPct
    );

  if (
    Number.isFinite(
      dailyLoss
    ) &&
    dailyLoss <= -3
  ) {
    score -= 60;
    blocked = true;
    reasons.push(
      '일일 손실 한도 도달'
    );
  }

  /*
   * 이미 포지션이 있다면
   * 중복 진입 방지.
   */
  if (
    position.exists &&
    signal === 1
  ) {
    score -= 30;
    reasons.push(
      '기존 포지션 존재'
    );
  }

  /*
   * 현금 부족.
   */
  if (
    Number.isFinite(equity) &&
    equity <= 0
  ) {
    score -= 100;
    blocked = true;
    reasons.push(
      '사용 가능한 자본 없음'
    );
  }

  return {
    name: 'RISK',
    direction:
      score > 20
        ? 'LONG'
        : score < -20
          ? 'SHORT'
          : 'NEUTRAL',

    score: clamp(score),

    confidence:
      blocked
        ? 0.95
        : 0.75,

    blocked,

    reasons,

    evidence: {
      gapPct,
      equity,
      dailyLossPct:
        dailyLoss,
    },
  };
}

module.exports = {
  riskAgent,
};
