// api/market-overview.js

const {
  guard,
} = require('../lib/auth');

const {
  getSimpleQuote,
} = require('../lib/dataSources');

const {
  INDICES,
} = require('../lib/universe');

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
    const results =
      await Promise.allSettled(
        INDICES.map(
          index =>
            getSimpleQuote(
              index.ticker
            )
        )
      );

    const indices =
      results.map(
        (result, index) => {
          if (
            result.status ===
            'fulfilled'
          ) {
            return {
              ...result.value,

              label:
                INDICES[index]
                  .label,

              error:
                null,
            };
          }

          return {
            ticker:
              INDICES[index]
                .ticker,

            label:
              INDICES[index]
                .label,

            error:
              result.reason
                ?.message ||
              '시장 데이터 조회 실패',
          };
        }
      );

    const failed =
      indices.filter(
        item =>
          Boolean(
            item.error
          )
      ).length;

    return res.status(200).json({
      ok: true,

      indices,

      summary: {
        total:
          indices.length,

        success:
          indices.length -
          failed,

        failed,
      },

      generatedAt:
        new Date().toISOString(),
    });

  } catch (err) {
    console.error(
      '[api/market-overview]',
      err
    );

    return res.status(500).json({
      ok: false,

      error:
        err?.message ||
        '시장 현황을 불러오지 못했습니다.',

      type:
        err?.name ||
        'Error',
    });
  }
};
