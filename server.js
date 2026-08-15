// server.js
//
// 로컬 개발/테스트용 서버.
// Vercel에서는 api/ 폴더의 serverless function을 사용한다.

const express =
  require('express');

const path =
  require('path');

const app =
  express();

const PORT =
  process.env.PORT ||
  3000;

app.use(
  express.json()
);

app.use(
  express.static(
    __dirname,
    {
      index:
        'index.html',
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
          routePath,
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

mount(
  'get',
  '/api/scan',
  './api/scan'
);

mount(
  'get',
  '/api/market-overview',
  './api/market-overview'
);

mount(
  'get',
  '/api/signal/:ticker',
  './api/signal/[ticker]'
);

mount(
  'get',
  '/api/backtest/:ticker',
  './api/backtest/[ticker]'
);

mount(
  'get',
  '/api/chart/:ticker',
  './api/chart/[ticker]'
);

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

// 기존 잘못된 경로:
// ./api/cron/check-signals
//
// 실제 파일:
// ./cron/check-signals.js
mount(
  'get',
  '/api/cron/check-signals',
  './cron/check-signals'
);

app.listen(
  PORT,
  () => {
    console.log(
      `신호 앱 서버 실행 중: http://localhost:${PORT}`
    );
  }
);
