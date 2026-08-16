// api/auth.js

const {
  isAuthConfigured,
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  isAuthed,
} = require('../lib/auth');

module.exports = async (req, res) => {
  const action =
    String(
      req.query?.action || ''
    ).toLowerCase();

  if (
    action === 'login'
  ) {
    if (
      req.method !== 'POST'
    ) {
      return res.status(405).json({
        error:
          'POST만 지원',
      });
    }

    if (
      !isAuthConfigured()
    ) {
      return res.status(200).json({
        ok: true,
        authRequired: false,
      });
    }

    const {
      password,
    } = req.body || {};

    if (
      !checkPassword(password)
    ) {
      return res.status(401).json({
        error:
          '비밀번호가 올바르지 않습니다.',
      });
    }

    setSessionCookie(res);

    return res.status(200).json({
      ok: true,
      authRequired: true,
    });
  }

  if (
    action === 'logout'
  ) {
    clearSessionCookie(res);

    return res.status(200).json({
      ok: true,
    });
  }

  if (
    action === 'status'
  ) {
    return res.status(200).json({
      authRequired:
        isAuthConfigured(),

      authed:
        isAuthed(req),
    });
  }

  return res.status(404).json({
    error:
      '지원하지 않는 인증 경로입니다.',
  });
};
