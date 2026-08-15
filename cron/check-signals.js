// cron/check-signals.js

const {
  kv,
} = require('@vercel/kv');

const {
  scanUniverse,
} = require('../lib/signalEngine');

const {
  FULL_UNIVERSE,
} = require('../lib/universe');

const {
  isConfigured,
  sendToSubscription,
} = require('../lib/push');

const STRONG_BUY_THRESHOLD =
  60;

const STATE_KEY =
  'signal:lastState';

module.exports = async (
  req,
  res
) => {
  const secret =
    req.headers[
      'x-cron-secret'
    ];

  if (
    !process.env.CRON_SECRET ||
    secret !==
      process.env.CRON_SECRET
  ) {
    return res
      .status(401)
      .json({
        error:
          '인증 실패',
      });
  }

  try {
    const {
      ranked,
    } =
      await scanUniverse(
        FULL_UNIVERSE
      );

    const prevState =
      (await kv.get(
        STATE_KEY
      )) || {};

    const newState = {};

    const newStrongSignals =
      [];

    for (
      const item of ranked
    ) {
      const score =
        Number(
          item.combinedScore
        ) || 0;

      newState[
        item.ticker
      ] = {
        score,

        aiScore:
          Number(
            item.aiScore
          ) || 0,

        confidence:
          Number(
            item.aiConfidence
          ) || 0,

        signal:
          Number(
            item.aiStrategy
              ?.signal
          ) || 0,

        decision:
          item.aiStrategy
            ?.decision ||
          'WAIT',
      };

      const previous =
        prevState[
          item.ticker
        ];

      const previousScore =
        typeof previous ===
        'object'
          ? Number(
              previous.score
            ) || 0
          : Number(
              previous
            ) || 0;

      const currentSignal =
        item.aiStrategy
          ?.signal === 1;

      if (
        currentSignal &&
        score >=
          STRONG_BUY_THRESHOLD &&
        previousScore <
          STRONG_BUY_THRESHOLD
      ) {
        newStrongSignals.push(
          item
        );
      }
    }

    await kv.set(
      STATE_KEY,
      newState
    );

    if (
      newStrongSignals.length ===
      0
    ) {
      return res
        .status(200)
        .json({
          checked:
            ranked.length,

          newSignals: 0,
        });
    }

    if (
      !isConfigured()
    ) {
      return res
        .status(200)
        .json({
          checked:
            ranked.length,

          newSignals:
            newStrongSignals.length,

          pushSent:
            false,

          note:
            'VAPID 키 미설정으로 푸지는 발송되지 않음',
        });
    }

    const title =
      `AI 강한 매수 신호 ${newStrongSignals.length}건`;

    const body =
      newStrongSignals
        .slice(0, 5)
        .map(
          item => {
            const score =
              Number(
                item.combinedScore
              ) || 0;

            const confidence =
              Number(
                item.aiConfidence
              ) || 0;

            return (
              `${item.label} ` +
              `(${score}, ` +
              `신뢰도 ${confidence}%)`
            );
          }
        )
        .join(', ');

    const subKeys =
      (await kv.smembers(
        'push:sub:index'
      )) || [];

    let sent = 0;

    for (
      const key of subKeys
    ) {
      const sub =
        await kv.get(
          key
        );

      if (!sub) {
        continue;
      }

      const result =
        await sendToSubscription(
          sub,
          {
            title,
            body,
            url: '/',
          }
        );

      if (
        result.ok
      ) {
        sent++;
      } else if (
        result.statusCode ===
          404 ||
        result.statusCode ===
          410
      ) {
        await kv.del(
          key
        );

        await kv.srem(
          'push:sub:index',
          key
        );
      }
    }

    return res
      .status(200)
      .json({
        checked:
          ranked.length,

        newSignals:
          newStrongSignals.length,

        pushSent:
          true,

        delivered:
          sent,
      });
  } catch (err) {
    console.error(
      '[cron/check-signals]',
      err
    );

    return res
      .status(500)
      .json({
        error:
          err?.message ||
          '신호 확인 실패',
      });
  }
};
