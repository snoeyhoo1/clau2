// api/auth/login.js

const {
  isAuthConfigured,
  checkPassword,
  setSessionCookie,
} = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST만 지원' });
  }

  if (!isAuthConfigured()) {
    // SITE_PASSWORD 미설정 상태 = 게이트 자체가 꺼져 있음.
    return res.status(200).json({ ok: true, authRequired: false });
  }

  const { password } = req.body || {};

  if (!checkPassword(password)) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }

  setSessionCookie(res);

  return res.status(200).json({ ok: true, authRequired: true });
};
