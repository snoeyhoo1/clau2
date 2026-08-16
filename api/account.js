// api/account.js

const {
  guard,
} = require('../lib/auth');

const {
  getBalance,
  getOverseasBalance,
} = require('../lib/kisClient');

function num(
  value,
  fallback = 0
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

module.exports = async (
  req,
  res
) => {
  if (
    guard(req, res)
  ) {
    return;
  }

  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );

  res.setHeader(
    'X-Content-Type-Options',
    'nosniff'
  );

  if (
    req.method !== 'GET'
  ) {
    return res.status(405).json({
      ok: false,

      error:
        'GET만 지원합니다.',
    });
  }

  try {
    const [
      domesticResult,
      overseasResult,
    ] =
      await Promise.allSettled([
        getBalance(),
        getOverseasBalance(),
      ]);

    const domestic =
      domesticResult.status ===
      'fulfilled'
        ? domesticResult.value
        : {
            error:
              domesticResult.reason
                ?.message ||
              '국내 계좌 조회 실패',
          };

    const overseas =
      overseasResult.status ===
      'fulfilled'
        ? overseasResult.value
        : {
            error:
              overseasResult.reason
                ?.message ||
              '해외 계좌 조회 실패',
          };

    const domesticCash =
      num(
        domestic.cash
      );

    const domesticStockValue =
      num(
        domestic.totalEvalAmount
      );

    const domesticTotal =
      domesticCash +
      domesticStockValue;

    const available =
      num(
        domestic.orderableCash
      );

    const profit =
      num(
        domestic.totalProfitLoss
      );

    const rate =
      num(
        domestic.totalProfitLossPct
      );

    const domesticHoldings =
      Array.isArray(
        domestic.holdings
      )
        ? domestic.holdings.map(
            item => ({
              ...item,

              ticker:
                item.code,

              label:
                item.name,

              currency:
                item.currency ||
                'KRW',
            })
          )
        : [];

    const overseasHoldings =
      Array.isArray(
        overseas.holdings
      )
        ? overseas.holdings.map(
            item => ({
              ...item,

              ticker:
                item.code,

              label:
                item.name,

              currency:
                item.currency ||
                'USD',
            })
          )
        : [];

    const holdings = [
      ...domesticHoldings,
      ...overseasHoldings,
    ];

    const domesticConnected =
      !domestic.error;

    const overseasConnected =
      !overseas.error;

    return res.status(200).json({
      ok:
        domesticConnected ||
        overseasConnected,

      env:
        'real',

      accountConnected:
        domesticConnected ||
        overseasConnected,

      totalValue:
        domesticTotal,

      total:
        domesticTotal,

      evaluationAmount:
        domesticTotal,

      available,

      availableAmount:
        available,

      orderableAmount:
        available,

      profit,

      evaluationProfit:
        profit,

      rate,

      profitRate:
        rate,

      holdings,

      domestic: {
        ...domestic,

        totalValue:
          domesticTotal,
      },

      overseas: {
        ...overseas,
      },

      overseasAssetValueUsd:
        num(
          overseas.totalEvalAmountUsd
        ),

      overseasCashUsd:
        num(
          overseas.cashUsd
        ),

      overseasProfitUsd:
        num(
          overseas.totalProfitLossUsd
        ),

      errors: {
        domestic:
          domestic.error ||
          null,

        overseas:
          overseas.error ||
          null,
      },

      status: {
        domestic:
          domesticConnected,

        overseas:
          overseasConnected,
      },

      generatedAt:
        new Date().toISOString(),
    });

  } catch (err) {
    console.error(
      '[api/account]',
      err
    );

    return res.status(500).json({
      ok: false,

      error:
        err?.message ||
        '계좌 조회 중 알 수 없는 오류',

      type:
        err?.name ||
        'Error',
    });
  }
};
