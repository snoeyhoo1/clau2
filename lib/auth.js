// lib/auth.js
//
// 앱 전체(정적 페이지 제외, API 전부)를 비밀번호로 보호하기 위한
// 최소한의 세션 쿠키 인증. 별도 회원 시스템이 아니라
// "이 앱을 쓸 수 있는 사람인지"만 확인하는 단일 비밀번호 게이트.
//
// 환경변수 SITE_PASSWORD가 설정되어 있지 않으면 인증을 강제하지
// 않는다(로컬 개발 편의). 배포 시에는 반드시 설정할 것.

const crypto = require('crypto');

const COOKIE_NAME = 'sd_auth';

function sitePassword() {
  return process.env.SITE_PASSWORD || '';
}

function isAuthConfigured() {
  return sitePassword().length > 0;
}

function expectedToken() {
  return crypto
    .createHash('sha256')
    .update(`signal-desk:${sitePassword()}`)
    .digest('hex');
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};

  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });

  return out;
}

function isAuthed(req) {
  if (!isAuthConfigured()) return true;

  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];

  if (!token) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(expectedToken())
    );
  } catch (err) {
    return false;
  }
}

function checkPassword(candidate) {
  if (!isAuthConfigured()) return false;

  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(sitePassword());

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

function setSessionCookie(res) {
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

  const parts = [
    `${COOKIE_NAME}=${expectedToken()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];

  if (isProd) parts.push('Secure');

  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

// 보호가 필요한 API 핸들러 맨 앞에서 호출.
// 인증 실패 시 401을 응답하고 true를 반환(호출부는 그 즉시 return).
function guard(req, res) {
  if (isAuthed(req)) return false;

  res.status(401).json({
    error: '비밀번호 인증이 필요합니다.',
    requiresAuth: true,
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
