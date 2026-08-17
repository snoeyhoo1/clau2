// lib/signalLog.js
//
// AI Signal Tracking V2
//
// 역할:
// 1. 강한 AI 신호 발생 시 스냅샷 저장
// 2. 5/10/20일 후 실제 가격으로 사후 평가
// 3. BUY / SELL 방향을 고려한 정확한 수익률 계산
// 4. AI score / confidence별 성과 집계
// 5. Signal Tracking Dashboard용 통계 제공
//
// 자동매매와 무관:
// 이 모듈은 기록 + 검증만 수행하며
// 주문을 발생시키지 않는다.

'use strict';

const { kv } =
  require('@vercel/kv');

const {
  getSimpleQuote,
} = require('./dataSources');

const PENDING_KEY =
  'siglog:pending';

const EVALUATED_KEY =
  'siglog:evaluated';

const MAX_PENDING = 500;
const MAX_EVALUATED = 1000;

const HORIZONS_DAYS = [
  {
    horizon: 5,
    calendarDays: 7,
  },
  {
    horizon: 10,
    calendarDays: 14,
  },
  {
    horizon: 20,
    calendarDays: 28,
  },
];

const MAX_EVALUATIONS_PER_RUN = 15;

/* ============================================================
 * Utilities
 * ============================================================ */

function makeId(
  ticker
) {
  return (
    `${ticker}:` +
    `${Date.now()}:` +
    `${Math.random()
      .toString(36)
      .slice(2, 8)}`
  );
}

function toNumber(
  value,
  fallback = 0
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function normalizeSide(
  side
) {
  const value =
    String(
      side || 'buy'
    )
      .trim()
      .toLowerCase();

  if (
    value === 'sell' ||
    value === 'short' ||
    value === '-1'
  ) {
    return 'sell';
  }

  return 'buy';
}

function readConfidence(
  record
) {
  const candidates = [
    record?.confidence,
    record?.aiConfidence,
  ];

  for (
    const value of candidates
  ) {
    const n =
      Number(value);

    if (
      Number.isFinite(n)
    ) {
      return n <= 1
        ? n * 100
        : n;
    }
  }

  return null;
}

function readScore(
  record
) {
  return toNumber(
    record?.aiScore ??
      record?.score,
    0
  );
}

/* ============================================================
 * KV
 * ============================================================ */

async function readList(
  key
) {
  try {
    const value =
      await kv.get(key);

    return Array.isArray(value)
      ? value
      : [];
  } catch (err) {
    console.error(
      '[signalLog/readList]',
      key,
      err
    );

    return [];
  }
}

async function writeList(
  key,
  list,
  maxLength
) {
  const trimmed =
    list.length > maxLength
      ? list.slice(
          list.length -
            maxLength
        )
      : list;

  try {
    await kv.set(
      key,
      trimmed
    );
  } catch (err) {
    console.error(
      '[signalLog/writeList]',
      key,
      err
    );
  }
}

/* ============================================================
 * Record Signal
 * ============================================================ */

async function recordSignal({
  ticker,
  label,
  market,
  side = 'buy',
  score,
  aiScore,
  confidence,
  entryPrice,
  decision,
  regime,
}) {
  if (
    !ticker ||
    !entryPrice
  ) {
    return null;
  }

  const normalizedTicker =
    String(ticker)
      .trim()
      .toUpperCase();

  const normalizedSide =
    normalizeSide(side);

  const pending =
    await readList(
      PENDING_KEY
    );

  const record = {
    id:
      makeId(
        normalizedTicker
      ),

    ticker:
      normalizedTicker,

    label:
      label ||
      normalizedTicker,

    market:
      market || null,

    side:
      normalizedSide,

    score:
      toNumber(score),

    aiScore:
      toNumber(aiScore),

    confidence:
      readConfidence({
        confidence,
      }),

    decision:
      decision || null,

    regime:
      regime || null,

    entryPrice:
      toNumber(
        entryPrice
      ),

    loggedAt:
      new Date()
        .toISOString(),

    evaluations: {},
  };

  pending.push(
    record
  );

  await writeList(
    PENDING_KEY,
    pending,
    MAX_PENDING
  );

  return record;
}

/* ============================================================
 * Direction-aware Return
 * ============================================================ */

function calculateReturnPct(
  side,
  entryPrice,
  currentPrice
) {
  const entry =
    toNumber(
      entryPrice,
      NaN
    );

  const current =
    toNumber(
      currentPrice,
      NaN
    );

  if (
    !Number.isFinite(
      entry
    ) ||
    !Number.isFinite(
      current
    ) ||
    entry === 0
  ) {
    return null;
  }

  const raw =
    ((current - entry) /
      entry) *
    100;

  /*
   * BUY:
   * 가격 상승 = +
   *
   * SELL:
   * 가격 하락 = +
   */
  if (
    normalizeSide(side) ===
    'sell'
  ) {
    return -raw;
  }

  return raw;
}

/* ============================================================
 * Evaluate Pending Signals
 * ============================================================ */

async function evaluatePendingSignals() {
  const pending =
    await readList(
      PENDING_KEY
    );

  if (
    !pending.length
  ) {
    return {
      evaluated: 0,
      remaining: 0,
    };
  }

  const now =
    Date.now();

  let evaluationsUsed = 0;

  const stillPending = [];
  const newlyEvaluated = [];

  for (
    const record of pending
  ) {
    const loggedAt =
      new Date(
        record.loggedAt
      ).getTime();

    const elapsedDays =
      (
        now -
        loggedAt
      ) /
      86400000;

    let quote = null;
    let quoteFetched = false;

    for (
      const {
        horizon,
        calendarDays,
      } of HORIZONS_DAYS
    ) {
      const key =
        String(horizon);

      if (
        record.evaluations?.[
          key
        ]
      ) {
        continue;
      }

      if (
        elapsedDays <
        calendarDays
      ) {
        continue;
      }

      if (
        evaluationsUsed >=
        MAX_EVALUATIONS_PER_RUN
      ) {
        continue;
      }

      if (
        !quoteFetched
      ) {
        try {
          quote =
            await getSimpleQuote(
              record.ticker
            );
        } catch (err) {
          console.error(
            '[signalLog/evaluate]',
            record.ticker,
            err?.message
          );
        }

        quoteFetched =
          true;

        evaluationsUsed++;
      }

      if (
        quote?.currentPrice &&
        record.entryPrice
      ) {
        const returnPct =
          calculateReturnPct(
            record.side,
            record.entryPrice,
            quote.currentPrice
          );

        if (
          returnPct !==
          null
        ) {
          record.evaluations[
            key
          ] = {
            horizon,

            evaluatedAt:
              new Date()
                .toISOString(),

            price:
              toNumber(
                quote.currentPrice
              ),

            returnPct:
              Number(
                returnPct.toFixed(
                  2
                )
              ),

            up:
              returnPct > 0,

            correct:
              returnPct > 0,

            side:
              normalizeSide(
                record.side
              ),
          };
        }
      }
    }

    const allHorizonsDone =
      HORIZONS_DAYS.every(
        ({
          horizon,
        }) =>
          record.evaluations?.[
            String(horizon)
          ]
      );

    if (
      allHorizonsDone
    ) {
      newlyEvaluated.push(
        record
      );
    } else {
      stillPending.push(
        record
      );
    }
  }

  await writeList(
    PENDING_KEY,
    stillPending,
    MAX_PENDING
  );

  if (
    newlyEvaluated.length
  ) {
    const evaluated =
      await readList(
        EVALUATED_KEY
      );

    await writeList(
      EVALUATED_KEY,
      [
        ...evaluated,
        ...newlyEvaluated,
      ],
      MAX_EVALUATED
    );
  }

  return {
    evaluated:
      newlyEvaluated.length,

    remaining:
      stillPending.length,
  };
}

/* ============================================================
 * Basic Statistics
 * ============================================================ */

function calculateStats(
  outcomes
) {
  if (
    !outcomes.length
  ) {
    return {
      sampleSize: 0,
      winRate: null,
      avgReturnPct: null,
      bestReturnPct: null,
      worstReturnPct: null,
    };
  }

  const returns =
    outcomes
      .map(
        item =>
          Number(
            item.returnPct
          )
      )
      .filter(
        Number.isFinite
      );

  if (
    !returns.length
  ) {
    return {
      sampleSize:
        outcomes.length,

      winRate: null,

      avgReturnPct: null,

      bestReturnPct: null,

      worstReturnPct: null,
    };
  }

  const wins =
    returns.filter(
      value =>
        value > 0
    ).length;

  const sum =
    returns.reduce(
      (
        total,
        value
      ) =>
        total + value,
      0
    );

  return {
    sampleSize:
      outcomes.length,

    winRate:
      Number(
        (
          (wins /
            outcomes.length) *
          100
        ).toFixed(1)
      ),

    avgReturnPct:
      Number(
        (
          sum /
          returns.length
        ).toFixed(2)
      ),

    bestReturnPct:
      Number(
        Math.max(
          ...returns
        ).toFixed(2)
      ),

    worstReturnPct:
      Number(
        Math.min(
          ...returns
        ).toFixed(2)
      ),
  };
}

/* ============================================================
 * Horizon Statistics
 * ============================================================ */

function buildHorizonStats(
  evaluated
) {
  const summary = {};

  for (
    const {
      horizon,
    } of HORIZONS_DAYS
  ) {
    const key =
      String(horizon);

    const outcomes =
      evaluated
        .map(
          record =>
            record.evaluations?.[
              key
            ]
        )
        .filter(Boolean);

    summary[key] =
      calculateStats(
        outcomes
      );
  }

  return summary;
}

/* ============================================================
 * Side Statistics
 * ============================================================ */

function buildSideStats(
  evaluated
) {
  const result = {
    buy: {},
    sell: {},
  };

  for (
    const {
      horizon,
    } of HORIZONS_DAYS
  ) {
    const key =
      String(horizon);

    for (
      const side of [
        'buy',
        'sell',
      ]
    ) {
      const outcomes =
        evaluated
          .filter(
            record =>
              normalizeSide(
                record.side
              ) === side
          )
          .map(
            record =>
              record
                .evaluations?.[
                key
              ]
          )
          .filter(Boolean);

      result[side][key] =
        calculateStats(
          outcomes
        );
    }
  }

  return result;
}

/* ============================================================
 * Confidence Buckets
 * ============================================================ */

function getConfidenceBucket(
  confidence
) {
  const value =
    toNumber(
      confidence,
      NaN
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return 'UNKNOWN';
  }

  if (
    value >= 80
  ) {
    return '80-100';
  }

  if (
    value >= 60
  ) {
    return '60-79';
  }

  if (
    value >= 40
  ) {
    return '40-59';
  }

  return '0-39';
}

function buildConfidenceStats(
  evaluated
) {
  const buckets = {
    '80-100': [],
    '60-79': [],
    '40-59': [],
    '0-39': [],
    UNKNOWN: [],
  };

  for (
    const record of evaluated
  ) {
    const bucket =
      getConfidenceBucket(
        record.confidence
      );

    for (
      const {
        horizon,
      } of HORIZONS_DAYS
    ) {
      const outcome =
        record.evaluations?.[
          String(horizon)
        ];

      if (
        !outcome
      ) {
        continue;
      }

      buckets[
        bucket
      ].push({
        ...outcome,
        horizon,
      });
    }
  }

  const result = {};

  for (
    const [
      bucket,
      outcomes,
    ] of Object.entries(
      buckets
    )
  ) {
    result[bucket] =
      calculateStats(
        outcomes
      );
  }

  return result;
}

/* ============================================================
 * AI Score Buckets
 * ============================================================ */

function getScoreBucket(
  score
) {
  const value =
    toNumber(score);

  const absolute =
    Math.abs(value);

  if (
    absolute >= 80
  ) {
    return '80-100';
  }

  if (
    absolute >= 60
  ) {
    return '60-79';
  }

  if (
    absolute >= 40
  ) {
    return '40-59';
  }

  return '0-39';
}

function buildScoreStats(
  evaluated
) {
  const buckets = {
    '80-100': [],
    '60-79': [],
    '40-59': [],
    '0-39': [],
  };

  for (
    const record of evaluated
  ) {
    const bucket =
      getScoreBucket(
        readScore(
          record
        )
      );

    for (
      const {
        horizon,
      } of HORIZONS_DAYS
    ) {
      const outcome =
        record.evaluations?.[
          String(horizon)
        ];

      if (
        outcome
      ) {
        buckets[
          bucket
        ].push({
          ...outcome,
          horizon,
        });
      }
    }
  }

  const result = {};

  for (
    const [
      bucket,
      outcomes,
    ] of Object.entries(
      buckets
    )
  ) {
    result[bucket] =
      calculateStats(
        outcomes
      );
  }

  return result;
}

/* ============================================================
 * Recent Signals
 * ============================================================ */

function buildRecentSignals(
  evaluated,
  limit = 20
) {
  return evaluated
    .slice()
    .sort(
      (a, b) =>
        new Date(
          b.loggedAt
        ).getTime() -
        new Date(
          a.loggedAt
        ).getTime()
    )
    .slice(
      0,
      limit
    )
    .map(
      record => ({
        id:
          record.id,

        ticker:
          record.ticker,

        label:
          record.label,

        market:
          record.market,

        side:
          normalizeSide(
            record.side
          ),

        score:
          readScore(
            record
          ),

        confidence:
          readConfidence(
            record
          ),

        decision:
          record.decision ||
          null,

        regime:
          record.regime ||
          null,

        entryPrice:
          record.entryPrice,

        loggedAt:
          record.loggedAt,

        evaluations:
          record.evaluations ||
          {},
      })
    );
}

/* ============================================================
 * Accuracy
 * ============================================================ */

function buildOverallAccuracy(
  evaluated
) {
  const allOutcomes = [];

  for (
    const record of evaluated
  ) {
    for (
      const {
        horizon,
      } of HORIZONS_DAYS
    ) {
      const outcome =
        record.evaluations?.[
          String(horizon)
        ];

      if (
        outcome
      ) {
        allOutcomes.push(
          outcome
        );
      }
    }
  }

  return calculateStats(
    allOutcomes
  );
}

/* ============================================================
 * Main Track Record
 * ============================================================ */

async function getSignalTrackRecord() {
  const evaluated =
    await readList(
      EVALUATED_KEY
    );

  const byHorizon =
    buildHorizonStats(
      evaluated
    );

  const bySide =
    buildSideStats(
      evaluated
    );

  const byConfidence =
    buildConfidenceStats(
      evaluated
    );

  const byScore =
    buildScoreStats(
      evaluated
    );

  const overall =
    buildOverallAccuracy(
      evaluated
    );

  const recentSignals =
    buildRecentSignals(
      evaluated
    );

  return {
    totalEvaluated:
      evaluated.length,

    overall,

    byHorizon,

    bySide,

    byConfidence,

    byScore,

    recentSignals,

    generatedAt:
      new Date()
        .toISOString(),
  };
}

/* ============================================================
 * Exports
 * ============================================================ */

module.exports = {
  recordSignal,

  evaluatePendingSignals,

  getSignalTrackRecord,

  calculateReturnPct,
};
