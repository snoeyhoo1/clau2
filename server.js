// server.js
//
// 로컬 개발/테스트용 서버.
// Vercel에서는 api/ 폴더의 serverless function을 사용한다.

const express = require('express');
const path = require('path');

const app = express();

const PORT =
  process.env.PORT ||
  3000;

app.use(
  express.json({
    limit: '2mb',
  })
);

app.use(
  express.static(
    __dirname,
    {
      index: 'index.html',
    }
  )
);

function mount(
  method,
  routePath,
  handlerPath
) {
  app[method](
    routePath,
    async (
      req,
      res
    ) => {
      try {
        Object.assign(
          req.query,
          req.params
        );

        const resolved =
          require.resolve(
            handlerPath
          );

        delete require.cache[
          resolved
        ];

        const handler =
          require(
            resolved
          );

        await handler(
          req,
          res
        );
      } catch (err) {
        console.error(
          `[${routePath}]`,
          err
        );

        if (
          !res.headersSent
        ) {
          res
            .status(500)
            .json({
              error:
                err?.message ||
                '서버 오류',
            });
        }
      }
    }
  );
}

/*
 * ============================================================
 * MARKET / SEARCH
 * ============================================================
 */

mount(
  'get',
  '/api/search',
  './api/search'
);

mount(
  'get',
  '/api/market-news',
  './api/market-news'
);

mount(
  'get',
  '/api/market-overview',
  './api/market-overview'
);

mount(
  'get',
  '/api/scan',
  './api/scan'
);

mount(
  'get',
  '/api/rankings',
  './api/rankings'
);

/*
 * ============================================================
 * STOCK ANALYSIS
 * ============================================================
 */

mount(
  'get',
  '/api/signal/:ticker',
  './api/signal/[ticker]'
);

mount(
  'get',
  '/api/chart/:ticker',
  './api/chart/[ticker]'
);

mount(
  'get',
  '/api/backtest/:ticker',
  './api/backtest/[ticker]'
);

/*
 * ============================================================
 * KIS / ACCOUNT
 * ============================================================
 */

mount(
  'get',
  '/api/kis/balance',
  './api/kis/balance'
);

mount(
  'post',
  '/api/kis/order',
  './api/kis/order'
);

/*
 * ============================================================
 * PUSH
 * ============================================================
 */

mount(
  'get',
  '/api/push/vapid-public-key',
  './api/push/vapid-public-key'
);

mount(
  'post',
  '/api/push/subscribe',
  './api/push/subscribe'
);

mount(
  'post',
  '/api/push/unsubscribe',
  './api/push/unsubscribe'
);

/*
 * ============================================================
 * CRON
 * ============================================================
 */

mount(
  'get',
  '/api/cron/check-signals',
  './cron/check-signals'
);

/*
 * ============================================================
 * START
 * ============================================================
 */

app.listen(
  PORT,
  () => {
    console.log(
      `신호 앱 서버 실행 중: http://localhost:${PORT}`
    );
  }
);
