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

const {
  calculateLiveQuantity,
} = require('../lib/positionSizing');

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

    res.setHeader(
      'Cache-Control',
      'no-store, max-age=0'
    );

    res.setHeader(
      'X-Content-Type-Options',
      'nosniff'
    );

    const action =
      String(
        req.query?.action || ''
      )
        .trim()
        .toLowerCase();

    if (
      action === 'sizing'
    ) {
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
        const market =
          req.query?.market ===
          'overseas'
            ? 'overseas'
            : 'domestic';

        const entry = Number(
          req.query?.entry
        );

        const stop = Number(
          req.query?.stop
        );

        let equity = 0;

        if (market === 'overseas') {
          const overseas =
            await getOverseasBalance();

          equity = Number(
            overseas?.cashUsd || 0
          );
        } else {
          const domestic =
            await getBalance();

          equity = Number(
            domestic?.orderableCash || 0
          );
        }

        const sizing =
          calculateLiveQuantity({
            equity,
            entryPrice: entry,
            stopPrice: stop,
          });

        return res.status(200).json({
          ok: true,
          market,
          equity,
          ...sizing,
        });

      } catch (err) {
        console.error(
          '[api/kis/sizing]',
          err
        );

        return res.status(500).json({
          ok: false,
          error:
            err?.message ||
            '추천 수량 계산 실패',
        });
      }
    }

    if (
      action === 'balance'
    ) {
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

        const domesticOk =
          !domestic.error;

        const overseasOk =
          !overseas.error;

        return res.status(200).json({
          ok:
            domesticOk ||
            overseasOk,

          domestic,

          overseas,

          accountConnected:
            domesticOk ||
            overseasOk,

          status: {
            domestic:
              domesticOk,

            overseas:
              overseasOk,
          },

          env:
            'real',
        });

      } catch (err) {
        console.error(
          '[api/kis/balance]',
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
    }

    if (
      action === 'order'
    ) {
      if (
        req.method !== 'POST'
      ) {
        return res.status(405).json({
          ok: false,
          error:
            'POST만 지원합니다.',
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

        if (
          !code ||
          !quantity ||
          Number(
            quantity
          ) <= 0
        ) {
          return res.status(400).json({
            ok: false,
            error:
              '종목 코드와 유효한 주문 수량이 필요합니다.',
          });
        }

        if (
          !side
        ) {
          return res.status(400).json({
            ok: false,
            error:
              '주문 방향이 필요합니다.',
          });
        }

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

        return res.status(200).json({
          ok: true,

          ...result,
        });

      } catch (err) {
        console.error(
          '[api/kis/order]',
          err
        );

        return res.status(400).json({
          ok: false,

          error:
            err?.message ||
            '주문 처리 실패',

          type:
            err?.name ||
            'Error',
        });
      }
    }

    return res.status(404).json({
      ok: false,

      error:
        '지원하지 않는 KIS 경로입니다.',
    });
  };
