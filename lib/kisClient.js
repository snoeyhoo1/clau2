// lib/kisClient.js
// 한국투자증권 Open API 연동. 공식 GitHub(koreainvestment/open-trading-api) 샘플코드 기준으로 작성.
//
// 안전장치:
// - 기본값은 모의투자(paper). 실전투자로 쓰려면 환경변수 KIS_ENV=real을 명시적으로 설정해야 함.
// - 주문 함수는 반드시 confirm:true를 받아야 실행됨 (2단계 확인 없이는 절대 주문 안 나감).
// - 접근토큰은 Vercel KV에 캐싱해서 불필요하게 자주 재발급받지 않음 (KIS가 빈번한 토큰
//   재발급을 제한하고 있음).

const { kv } = require('@vercel/kv');

function getEnv() {
  return process.env.KIS_ENV === 'real' ? 'real' : 'mock'; // 기본값 안전하게 모의투자
}

function getBaseUrl(env) {
  return env === 'real'
    ? 'https://openapi.koreainvestment.com:9443'
    : 'https://openapivts.koreainvestment.com:29443';
}

function getCredentials(env) {
  // 실전/모의를 같은 이름의 환경변수로 관리 (KIS_ENV로 스위치).
  // 실전과 모의는 앱키/시크릿/계좌번호가 서로 다르므로 접미사로 구분.
  const suffix = env === 'real' ? 'REAL' : 'MOCK';
  const appKey = process.env[`KIS_APP_KEY_${suffix}`];
  const appSecret = process.env[`KIS_APP_SECRET_${suffix}`];
  const cano = process.env[`KIS_CANO_${suffix}`]; // 계좌번호 앞 8자리
  const acntPrdtCd = process.env[`KIS_ACNT_PRDT_CD_${suffix}`] || '01'; // 계좌번호 뒤 2자리

  if (!appKey || !appSecret || !cano) {
    throw new Error(
      `KIS ${env === 'real' ? '실전' : '모의'}투자 환경변수가 설정되지 않았습니다. ` +
      `KIS_APP_KEY_${suffix}, KIS_APP_SECRET_${suffix}, KIS_CANO_${suffix}를 등록하세요.`
    );
  }
  return { appKey, appSecret, cano, acntPrdtCd };
}

async function getAccessToken(env) {
  const cacheKey = `kis:token:${env}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    // KV 조회 실패해도 토큰 재발급으로 계속 진행
  }

  const { appKey, appSecret } = getCredentials(env);
  const res = await fetch(`${getBaseUrl(env)}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
  });
  if (!res.ok) throw new Error(`KIS 토큰 발급 실패 (${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error('KIS 토큰 발급 실패: access_token 없음');

  try {
    // 만료(기본 24시간)보다 여유있게 23시간만 캐싱
    await kv.set(cacheKey, data.access_token, { ex: 23 * 60 * 60 });
  } catch (e) {
    // 캐싱 실패해도 토큰 자체는 반환 (다음 호출에서 재발급될 뿐)
  }
  return data.access_token;
}

// 주문 요청 시 KIS가 요구하는 해시키 (위변조 방지용)
async function getHashkey(env, body) {
  const { appKey, appSecret } = getCredentials(env);
  const res = await fetch(`${getBaseUrl(env)}/uapi/hashkey`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      appkey: appKey,
      appsecret: appSecret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`해시키 발급 실패 (${res.status})`);
  const data = await res.json();
  return data.HASH;
}

async function kisRequest(env, { method, path, trId, params, body }) {
  const token = await getAccessToken(env);
  const { appKey, appSecret } = getCredentials(env);
  const baseUrl = getBaseUrl(env);

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: trId,
    custtype: 'P', // 개인
  };

  let url = `${baseUrl}${path}`;
  const options = { method, headers };

  if (method === 'GET' && params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  } else if (method === 'POST' && body) {
    headers.hashkey = await getHashkey(env, body);
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();
  if (data.rt_cd && data.rt_cd !== '0') {
    throw new Error(`KIS API 오류: ${data.msg1 || data.msg_cd || '알 수 없는 오류'}`);
  }
  return data;
}

// 계좌 잔고 + 보유종목 조회
async function getBalance(env = getEnv()) {
  const { cano, acntPrdtCd } = getCredentials(env);
  const trId = env === 'real' ? 'TTTC8434R' : 'VTTC8434R';

  const data = await kisRequest(env, {
    method: 'GET',
    path: '/uapi/domestic-stock/v1/trading/inquire-balance',
    trId,
    params: {
      CANO: cano,
      ACNT_PRDT_CD: acntPrdtCd,
      AFHR_FLPR_YN: 'N',
      UNPR_DVSN: '01',
      FUND_STTL_ICLD_YN: 'N',
      FNCG_AMT_AUTO_RDPT_YN: 'N',
      OFL_YN: '',
      INQR_DVSN: '01',
      PRCS_DVSN: '00',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    },
  });

  const holdings = (data.output1 || [])
    .filter((h) => Number(h.hldg_qty) > 0)
    .map((h) => ({
      code: h.pdno,
      name: h.prdt_name,
      quantity: Number(h.hldg_qty),
      avgPrice: Number(h.pchs_avg_pric),
      currentPrice: Number(h.prpr),
      evalAmount: Number(h.evlu_amt),
      profitLossPct: Number(h.evlu_pfls_rt),
    }));

  const summary = (data.output2 || [])[0] || {};

  return {
    env,
    cash: Number(summary.dnca_tot_amt || 0), // 예수금총액
    orderableCash: Number(summary.nxdy_excc_amt || summary.prvs_rcdl_excc_amt || 0), // 주문가능현금
    totalEvalAmount: Number(summary.tot_evlu_amt || 0),
    totalProfitLoss: Number(summary.evlu_pfls_smtl_amt || 0),
    holdings,
  };
}

// 현금 주문 (매수/매도). confirm:true가 아니면 절대 실행 안 함 (2단계 확인 안전장치).
async function placeOrder(env = getEnv(), { code, quantity, price, side, orderType = 'market', confirm }) {
  if (confirm !== true) {
    throw new Error('주문 확인(confirm)이 필요합니다. 사용자 확인 없이는 주문을 실행하지 않습니다.');
  }
  if (!code || !quantity || quantity <= 0) {
    throw new Error('종목코드와 수량을 정확히 입력하세요.');
  }
  if (side !== 'buy' && side !== 'sell') {
    throw new Error('side는 buy 또는 sell이어야 합니다.');
  }

  const { cano, acntPrdtCd } = getCredentials(env);
  const isReal = env === 'real';
  const trId = side === 'buy'
    ? (isReal ? 'TTTC0802U' : 'VTTC0802U')
    : (isReal ? 'TTTC0801U' : 'VTTC0801U');

  const ordDvsn = orderType === 'limit' ? '00' : '01'; // 00=지정가, 01=시장가
  const ordUnpr = orderType === 'limit' ? String(price) : '0'; // 시장가는 0

  const body = {
    CANO: cano,
    ACNT_PRDT_CD: acntPrdtCd,
    PDNO: code,
    ORD_DVSN: ordDvsn,
    ORD_QTY: String(quantity),
    ORD_UNPR: ordUnpr,
  };

  const data = await kisRequest(env, {
    method: 'POST',
    path: '/uapi/domestic-stock/v1/trading/order-cash',
    trId,
    body,
  });

  return {
    env,
    side,
    code,
    quantity,
    orderType,
    orderNo: data.output?.ODNO,
    orderTime: data.output?.ORD_TMD,
    message: data.msg1,
  };
}

// ⚠ 아래 해외주식 TR_ID는 검색으로 다수 확인했지만 KIS 공식 문서로 100% 대조하진
// 못했습니다. 실전투자(KIS_ENV=real)로 전환하기 전에 반드시
// https://apiportal.koreainvestment.com 에서 정확한 TR_ID를 재확인하세요.
const OVERSEAS_TR_ID = {
  balance: { real: 'TTTS3012R', mock: 'VTTS3012R' },
  buy: { real: 'JTTT1002U', mock: 'VTTT1002U' },
  sell: { real: 'JTTT1006U', mock: 'VTTT1001U' },
};

// 해외주식 잔고 + 보유종목 조회 (기본: 나스닥/뉴욕/아멕스 통합)
async function getOverseasBalance(env = getEnv(), exchange = 'NASD') {
  const { cano, acntPrdtCd } = getCredentials(env);
  const trId = env === 'real' ? OVERSEAS_TR_ID.balance.real : OVERSEAS_TR_ID.balance.mock;

  const data = await kisRequest(env, {
    method: 'GET',
    path: '/uapi/overseas-stock/v1/trading/inquire-balance',
    trId,
    params: {
      CANO: cano,
      ACNT_PRDT_CD: acntPrdtCd,
      OVRS_EXCG_CD: exchange,
      TR_CRCY_CD: 'USD',
      CTX_AREA_FK200: '',
      CTX_AREA_NK200: '',
    },
  });

  const holdings = (data.output1 || [])
    .filter((h) => Number(h.ovrs_cblc_qty) > 0)
    .map((h) => ({
      code: h.ovrs_pdno,
      name: h.ovrs_item_name,
      quantity: Number(h.ovrs_cblc_qty),
      avgPrice: Number(h.pchs_avg_pric),
      currentPrice: Number(h.now_pric2),
      evalAmount: Number(h.ovrs_stck_evlu_amt),
      profitLossPct: Number(h.evlu_pfls_rt),
      currency: 'USD',
    }));

  const summary = (data.output2 || {});

  return {
    env,
    exchange,
    totalEvalAmountUsd: Number(summary.tot_evlu_pfls_amt || 0),
    holdings,
  };
}

// 해외주식 주문 (지정가만 지원 — 시장가 TR_ID는 검증이 덜 돼서 안전하게 지정가로 제한)
async function placeOverseasOrder(env = getEnv(), { code, quantity, price, side, exchange = 'NASD', confirm }) {
  if (confirm !== true) {
    throw new Error('주문 확인(confirm)이 필요합니다. 사용자 확인 없이는 주문을 실행하지 않습니다.');
  }
  if (!code || !quantity || quantity <= 0) {
    throw new Error('종목코드와 수량을 정확히 입력하세요.');
  }
  if (!price || price <= 0) {
    throw new Error('해외주식은 지정가만 지원합니다. 가격을 입력하세요.');
  }
  if (side !== 'buy' && side !== 'sell') {
    throw new Error('side는 buy 또는 sell이어야 합니다.');
  }

  const { cano, acntPrdtCd } = getCredentials(env);
  const isReal = env === 'real';
  const trId = side === 'buy'
    ? (isReal ? OVERSEAS_TR_ID.buy.real : OVERSEAS_TR_ID.buy.mock)
    : (isReal ? OVERSEAS_TR_ID.sell.real : OVERSEAS_TR_ID.sell.mock);

  const body = {
    CANO: cano,
    ACNT_PRDT_CD: acntPrdtCd,
    OVRS_EXCG_CD: exchange,
    PDNO: code,
    ORD_QTY: String(quantity),
    OVRS_ORD_UNPR: String(price),
    CTAC_TLNO: '',
    MGCO_APTM_ODNO: '',
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN: '00', // 지정가
  };

  const data = await kisRequest(env, {
    method: 'POST',
    path: '/uapi/overseas-stock/v1/trading/order',
    trId,
    body,
  });

  return {
    env,
    market: 'overseas',
    side,
    code,
    quantity,
    price,
    exchange,
    orderNo: data.output?.ODNO,
    orderTime: data.output?.ORD_TMD,
    message: data.msg1,
  };
}

module.exports = { getEnv, getBalance, placeOrder, getOverseasBalance, placeOverseasOrder };
