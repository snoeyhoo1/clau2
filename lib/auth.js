// lib/auth.js
//
// 앱 전체(정적 페이지 제외, API 전부)를 비밀번호로 보호하기 위한
// 최소한의 세션 쿠키 인증.
//
// 환경변수 SITE_PASSWORD가 설정되어 있지 않으면 인증을 강제하지 않는다.
// 배포 환경에서는 반드시 SITE_PASSWORD를 설정하는 것을 권장한다.

const crypto =
  require('crypto');

const COOKIE_NAME =
  'sd_auth';

const SESSION_MAX_AGE =
  60 * 60 * 24 * 30;

function sitePassword() {
  return (
    process.env.SITE_PASSWORD ||
    ''
  );
}

function isAuthConfigured() {
  return (
    sitePassword().length > 0
  );
}

function isProduction() {
  return (
    process.env.VERCEL === '1' ||
    process.env.NODE_ENV ===
      'production'
  );
}

function expectedToken() {
  return crypto
    .createHash('sha256')
    .update(
      `signal-desk:${sitePassword()}`
    )
    .digest('hex');
}

function parseCookies(
  req
) {
  const header =
    req.headers?.cookie ||
    '';

  const out = {};

  header
    .split(';')
    .forEach(pair => {
      const idx =
        pair.indexOf('=');

      if (idx === -1) {
        return;
      }

      const key =
        pair
          .slice(0, idx)
          .trim();

      const rawValue =
        pair
          .slice(idx + 1)
          .trim();

      if (!key) {
        return;
      }

      try {
        out[key] =
          decodeURIComponent(
            rawValue
          );
      } catch {
        // 잘못 인코딩된 쿠키는 무시한다.
      }
    });

  return out;
}

function isAuthed(
  req
) {
  if (
    !isAuthConfigured()
  ) {
    return true;
  }

  const cookies =
    parseCookies(req);

  const token =
    cookies[COOKIE_NAME];

  if (!token) {
    return false;
  }

  const expected =
    expectedToken();

  try {
    const tokenBuffer =
      Buffer.from(token);

    const expectedBuffer =
      Buffer.from(expected);

    if (
      tokenBuffer.length !==
      expectedBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      tokenBuffer,
      expectedBuffer
    );
  } catch {
    return false;
  }
}

function checkPassword(
  candidate
) {
  if (
    !isAuthConfigured()
  ) {
    return false;
  }

  const a =
    Buffer.from(
      String(
        candidate || ''
      )
    );

  const b =
    Buffer.from(
      sitePassword()
    );

  if (
    a.length !==
    b.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}

function setSessionCookie(
  res
) {
  const parts = [
    `${COOKIE_NAME}=${expectedToken()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE}`,
  ];

  if (
    isProduction()
  ) {
    parts.push(
      'Secure'
    );
  }

  res.setHeader(
    'Set-Cookie',
    parts.join('; ')
  );
}

function clearSessionCookie(
  res
) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];

  if (
    isProduction()
  ) {
    parts.push(
      'Secure'
    );
  }

  res.setHeader(
    'Set-Cookie',
    parts.join('; ')
  );
}

function guard(
  req,
  res
) {
  if (
    isAuthed(req)
  ) {
    return false;
  }

  res.status(401).json({
    ok: false,

    error:
      '비밀번호 인증이 필요합니다.',

    requiresAuth:
      true,
  });

  return true;
}

module.exports = {
  COOKIE_NAME,

  isAuthConfigured,

  isAuthed,

  checkPassword,

  setSessionCookie,

  clearSessionCookie,

  guard,
};
