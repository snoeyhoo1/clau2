// api/auth.js

const {
  isAuthConfigured,
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  isAuthed,
} = require('../lib/auth');

module.exports = async (
  req,
  res
) => {
  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );

  const action =
    String(
      req.query?.action || ''
    )
      .trim()
      .toLowerCase();

  if (
    action === 'login'
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

    if (
      !isAuthConfigured()
    ) {
      return res.status(200).json({
        ok: true,
        authRequired: false,
        authed: true,
      });
    }

    const password =
      req.body?.password;

    if (
      !checkPassword(
        password
      )
    ) {
      return res.status(401).json({
        ok: false,
        error:
          '비밀번호가 올바르지 않습니다.',
        authRequired: true,
        authed: false,
      });
    }

    setSessionCookie(res);

    return res.status(200).json({
      ok: true,
      authRequired: true,
      authed: true,
    });
  }

  if (
    action === 'logout'
  ) {
    clearSessionCookie(res);

    return res.status(200).json({
      ok: true,
      authRequired:
        isAuthConfigured(),
      authed: false,
    });
  }

  if (
    action === 'status'
  ) {
    return res.status(200).json({
      ok: true,

      authRequired:
        isAuthConfigured(),

      authed:
        isAuthed(req),
    });
  }

  return res.status(404).json({
    ok: false,

    error:
      '지원하지 않는 인증 경로입니다.',
  });
};
