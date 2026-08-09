// server.js
// 로컬 개발/테스트용 서버. 실제 배포는 Vercel(api/ 폴더의 서버리스 함수)을 사용.
// api/ 폴더의 각 파일이 module.exports = async (req, res) => {...} 형태라서
// Express 라우트에서 그대로 재사용함.
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname, { index: 'index.html' }));
app.use(express.json());

// Vercel 스타일 (req, res) 핸들러를 Express에 연결하는 헬퍼
function mount(method, routePath, handlerPath) {
  app[method](routePath, (req, res) => {
    // Express의 :param 값을 Vercel의 req.query.param 스타일로도 채워줌
    Object.assign(req.query, req.params);
    delete require.cache[require.resolve(handlerPath)];
    const handler = require(handlerPath);
    handler(req, res);
  });
}

mount('get', '/api/scan', './api/scan');
mount('get', '/api/market-overview', './api/market-overview');
mount('get', '/api/signal/:ticker', './api/signal/[ticker]');
mount('get', '/api/backtest/:ticker', './api/backtest/[ticker]');
mount('get', '/api/chart/:ticker', './api/chart/[ticker]');
mount('get', '/api/push/vapid-public-key', './api/push/vapid-public-key');
mount('post', '/api/push/subscribe', './api/push/subscribe');
mount('post', '/api/push/unsubscribe', './api/push/unsubscribe');
mount('get', '/api/cron/check-signals', './api/cron/check-signals');

app.listen(PORT, () => {
  console.log(`신호 앱 서버 실행 중: http://localhost:${PORT}`);
  console.log('참고: /api/push, /api/cron 은 Vercel KV 환경변수가 없으면 로컬에서 오류가 날 수 있습니다.');
});
