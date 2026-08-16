// api/push/vapid-public-key.js
const { guard } = require('../../lib/auth');

module.exports = (req, res) => {
  if (guard(req, res)) return;
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'VAPID 키가 설정되지 않았습니다. 서버 환경변수를 확인하세요.' });
  }
  res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY });
};
