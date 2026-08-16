// api/kis.js

const {
  guard,
} = require('../lib/auth');

const {
  getBalance,
  getOverseasBalance,
  placeOrder,
  placeOverseasOrder,
} = require('../lib/kisClient');

module.exports =
  async (
    req,
    res
  ) => {
    if (
      guard(req, res)
    ) {
      return;
    }

    const action =
      String(
        req.query?.action || ''
      ).toLowerCase();

    if (
      action === 'balance'
    ) {
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
                  domesticResult
                    .reason
                    ?.message ||
                  '국내 계좌 조회 실패',
              };

        const overseas =
          overseasResult.status ===
          'fulfilled'
            ? overseasResult.value
            : {
                error:
                  overseasResult
                    .reason
                    ?.message ||
                  '해외 계좌 조회 실패',
              };

        return res.status(200).json({
          domestic,
          overseas,

          accountConnected:
            !domestic.error ||
            !overseas.error,

          env:
            'real',
        });
      } catch (err) {
        return res.status(500).json({
          error:
            err?.message ||
            '계좌 조회 중 알 수 없는 오류',
        });
      }
    }

    if (
      action === 'order'
    ) {
      if (
        req.method !== 'POST'
      ) {
        return res.status(405).json({
          error:
            'POST만 지원',
        });
      }

      try {
        const {
          market,
          code,
          quantity,
          price,
          side,
          orderType,
          exchange,
          confirm,
        } =
          req.body || {};

        let result;

        if (
          market ===
          'overseas'
        ) {
          result =
            await placeOverseasOrder({
              code,

              quantity:
                Number(
                  quantity
                ),

              price:
                Number(
                  price
                ),

              side,

              exchange:
                exchange ||
                'NASD',

              confirm,
            });
        } else {
          result =
            await placeOrder({
              code,

              quantity:
                Number(
                  quantity
                ),

              price:
                price
                  ? Number(
                      price
                    )
                  : undefined,

              side,

              orderType,

              confirm,
            });
        }

        return res.status(200).json(
          result
        );
      } catch (err) {
        return res.status(400).json({
          error:
            err?.message ||
            '주문 처리 실패',
        });
      }
    }

    return res.status(404).json({
      error:
        '지원하지 않는 KIS 경로입니다.',
    });
  };
