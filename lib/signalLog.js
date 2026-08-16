// lib/signalLog.js
//
// "AI가 매수 신호를 냈을 때 실제로 나중에 어떻게 됐는가"를
// 스스로 검증하기 위한 로그.
//
// 지금까지는 신호를 계산해서 화면에 보여주고 버리기만 했다.
// 이 모듈은:
// 1. 강한 신호가 뜰 때마다 그 시점 스냅샷(종목/점수/가격)을 KV에 기록하고
// 2. 이후(5/10/20 거래일 근사치) 실제 가격을 다시 조회해서
//    "그 신호가 맞았는지"를 채워 넣는다.
//
// 이렇게 쌓인 데이터는:
// - computeUpProbability(과거 유사 신호 분석)의 표본을 늘려주고
// - 앙상블 가중치/confidence 계산이 실제로 맞는지 사후 검증하는
//   근거 자료가 된다.
//
// 자동매매와 무관: 여기서 하는 일은 순수하게 "기록 + 검증"이며
// 어떤 주문도 발생시키지 않는다.

const { kv } = require('@vercel/kv');

const {
  getSimpleQuote,
} = require('./dataSources');

const PENDING_KEY = 'siglog:pending';
const EVALUATED_KEY = 'siglog:evaluated';

const MAX_PENDING = 500;
const MAX_EVALUATED = 1000;

/*
 * 거래일 대신 달력일로 근사한다.
 * (주말 포함해서 대략 5거래일 ≈ 7일, 10거래일 ≈ 14일, 20거래일 ≈ 28일)
 */
const HORIZONS_DAYS = [
  { horizon: 5, calendarDays: 7 },
  { horizon: 10, calendarDays: 14 },
  { horizon: 20, calendarDays: 28 },
];

/*
 * 한 번의 cron 실행에서 너무 많은 가격 조회를 하지 않도록
 * 평가 대상 수를 제한한다.
 */
const MAX_EVALUATIONS_PER_RUN = 15;

function makeId(ticker) {
  return `${ticker}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function readList(key) {
  try {
    const value = await kv.get(key);
    return Array.isArray(value) ? value : [];
  } catch (err) {
    console.error(
      '[signalLog/readList]',
      key,
      err
    );
    return [];
  }
}

async function writeList(key, list, maxLength) {
  const trimmed =
    list.length > maxLength
      ? list.slice(list.length - maxLength)
      : list;

  try {
    await kv.set(key, trimmed);
  } catch (err) {
    console.error(
      '[signalLog/writeList]',
      key,
      err
    );
  }
}

/**
 * 강한 신호가 새로 뜬 시점의 스냅샷을 기록한다.
 * (cron/check-signals.js에서 newStrongSignals를 만들 때 호출)
 */
async function recordSignal({
  ticker,
  label,
  market,
  side = 'buy',
  score,
  aiScore,
  entryPrice,
}) {
  if (!ticker || !entryPrice) return null;

  const pending = await readList(PENDING_KEY);

  const record = {
    id: makeId(ticker),
    ticker,
    label: label || ticker,
    market: market || null,
    side,
    score: Number(score) || 0,
    aiScore: Number(aiScore) || 0,
    entryPrice: Number(entryPrice),
    loggedAt: new Date().toISOString(),
    evaluations: {},
  };

  pending.push(record);

  await writeList(
    PENDING_KEY,
    pending,
    MAX_PENDING
  );

  return record;
}

/**
 * 대기 중인 신호들 중 horizon 도래한 것들을 실제 가격으로 평가한다.
 * 모든 horizon이 평가되면 evaluated 리스트로 이동.
 */
async function evaluatePendingSignals() {
  const pending = await readList(PENDING_KEY);

  if (!pending.length) {
    return { evaluated: 0, remaining: 0 };
  }

  const now = Date.now();

  let evaluationsUsed = 0;

  const stillPending = [];
  const newlyEvaluated = [];

  for (const record of pending) {
    const loggedAt = new Date(
      record.loggedAt
    ).getTime();

    const elapsedDays =
      (now - loggedAt) / 86400000;

    let quote = null;
    let quoteFetched = false;

    for (const {
      horizon,
      calendarDays,
    } of HORIZONS_DAYS) {
      const key = String(horizon);

      if (record.evaluations[key]) {
        continue;
      }

      if (elapsedDays < calendarDays) {
        continue;
      }

      if (
        evaluationsUsed >=
        MAX_EVALUATIONS_PER_RUN
      ) {
        continue;
      }

      if (!quoteFetched) {
        try {
          quote = await getSimpleQuote(
            record.ticker
          );
        } catch (err) {
          console.error(
            '[signalLog/evaluate]',
            record.ticker,
            err?.message
          );
        }

        quoteFetched = true;
        evaluationsUsed++;
      }

      if (
        quote?.currentPrice &&
        record.entryPrice
      ) {
        const returnPct =
          ((quote.currentPrice -
            record.entryPrice) /
            record.entryPrice) *
          100;

        record.evaluations[key] = {
          horizon,
          evaluatedAt:
            new Date().toISOString(),
          price: quote.currentPrice,
          returnPct: Number(
            returnPct.toFixed(2)
          ),
          up: returnPct > 0,
        };
      }
    }

    const allHorizonsDone =
      HORIZONS_DAYS.every(
        ({ horizon }) =>
          record.evaluations[
            String(horizon)
          ]
      );

    if (allHorizonsDone) {
      newlyEvaluated.push(record);
    } else {
      stillPending.push(record);
    }
  }

  await writeList(
    PENDING_KEY,
    stillPending,
    MAX_PENDING
  );

  if (newlyEvaluated.length) {
    const evaluated = await readList(
      EVALUATED_KEY
    );

    await writeList(
      EVALUATED_KEY,
      [...evaluated, ...newlyEvaluated],
      MAX_EVALUATED
    );
  }

  return {
    evaluated: newlyEvaluated.length,
    remaining: stillPending.length,
  };
}

/**
 * 검증 완료된 신호들의 요약 통계.
 * (실제로 AI 신호가 얼마나 잘 맞았는지 확인하는 용도)
 */
async function getSignalTrackRecord() {
  const evaluated = await readList(
    EVALUATED_KEY
  );

  const summary = {};

  for (const {
    horizon,
  } of HORIZONS_DAYS) {
    const key = String(horizon);

    const outcomes = evaluated
      .map(r => r.evaluations?.[key])
      .filter(Boolean);

    const upCount = outcomes.filter(
      o => o.up
    ).length;

    summary[key] = {
      sampleSize: outcomes.length,
      winRate: outcomes.length
        ? Number(
            (
              (upCount / outcomes.length) *
              100
            ).toFixed(1)
          )
        : null,
      avgReturnPct: outcomes.length
        ? Number(
            (
              outcomes.reduce(
                (sum, o) =>
                  sum + o.returnPct,
                0
              ) / outcomes.length
            ).toFixed(2)
          )
        : null,
    };
  }

  return {
    totalEvaluated: evaluated.length,
    byHorizon: summary,
  };
}

module.exports = {
  recordSignal,
  evaluatePendingSignals,
  getSignalTrackRecord,
};

