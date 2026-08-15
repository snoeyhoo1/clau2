// lib/kisClient.js
// 한국투자증권 Open API - 실전투자 전용.
//
// 안전장치:
// - 모의투자 API/환경변수/분기를 사용하지 않음.
// - 실전 API 주소만 사용.
// - 주문 함수는 반드시 confirm:true를 받아야 실행됨.
// - 접근토큰은 Vercel KV에 캐싱.
//
// 필요한 환경변수:
// KIS_APP_KEY
// KIS_APP_SECRET
// KIS_CANO
// KIS_ACNT_PRDT_CD

const { kv } = require('@vercel/kv');

const BASE_URL = 'https://openapi.koreainvestment.com:9443';

function getCredentials() {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const cano = process.env.KIS_CANO;
  const acntPrdtCd = process.env.KIS_ACNT_PRDT_CD || '01';

  if (!appKey || !appSecret || !cano) {
    throw new Error(
      'KIS 실전투자 환경변수가 설정되지 않았습니다. ' +
      'KIS_APP_KEY, KIS_APP_SECRET, KIS_CANO를 등록하세요.'
    );
  }

  return {
    appKey,
    appSecret,
    cano,
    acntPrdtCd,
  };
}

async function getAccessToken() {
  const cacheKey = 'kis:token:real';

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return cached;
  } catch (e) {
    // KV 실패 시 새 토큰 발급
  }

  const { appKey, appSecret } = getCredentials();

  const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`KIS 토큰 발급 실패 (${res.status})`);
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error('KIS 토큰 발급 실패: access_token 없음');
  }

  try {
    await kv.set(cacheKey, data.access_token, {
      ex: 23 * 60 * 60,
    });
  } catch (e) {
    // 캐싱 실패해도 토큰은 반환
  }

  return data.access_token;
}

async function getHashkey(body) {
  const { appKey, appSecret } = getCredentials();

  const res = await fetch(`${BASE_URL}/uapi/hashkey`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      appkey: appKey,
      appsecret: appSecret,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`해시키 발급 실패 (${res.status})`);
  }

  const data = await res.json();

  if (!data.HASH) {
    throw new Error('해시키 발급 실패: HASH 없음');
  }

  return data.HASH;
}

async function kisRequest({
  method,
  path,
  trId,
  params,
  body,
}) {
  const token = await getAccessToken();
  const { appKey, appSecret } = getCredentials();

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: trId,
    custtype: 'P',
  };

  let url = `${BASE_URL}${path}`;

  const options = {
    method,
    headers,
  };

  if (method === 'GET' && params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }

  if (method === 'POST' && body) {
    headers.hashkey = await getHashkey(body);
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();

  if (data.rt_cd && data.rt_cd !== '0') {
    throw new Error(
      `KIS API 오류: ${data.msg1 || data.msg_cd || '알 수 없는 오류'}`
    );
  }

  return data;
}

// 국내주식 잔고 조회
async function getBalance() {
  const { cano, acntPrdtCd } = getCredentials();

  const data = await kisRequest({
    method: 'GET',
    path: '/uapi/domestic-stock/v1/trading/inquire-balance',

    // 실전투자 전용
    trId: 'TTTC8434R',

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
    env: 'real',
    cash: Number(summary.dnca_tot_amt || 0),
    orderableCash: Number(
      summary.nxdy_excc_amt ||
      summary.prvs_rcdl_excc_amt ||
      0
    ),
    totalEvalAmount: Number(summary.tot_evlu_amt || 0),
    totalProfitLoss: Number(
      summary.evlu_pfls_smtl_amt || 0
    ),
    holdings,
  };
}

// 국내주식 현금 주문
async function placeOrder({
  code,
  quantity,
  price,
  side,
  orderType = 'market',
  confirm,
}) {
  if (confirm !== true) {
    throw new Error(
      '주문 확인(confirm)이 필요합니다. ' +
      '사용자 확인 없이는 주문을 실행하지 않습니다.'
    );
  }

  if (!code || !quantity || quantity <= 0) {
    throw new Error('종목코드와 수량을 정확히 입력하세요.');
  }

  if (side !== 'buy' && side !== 'sell') {
    throw new Error('side는 buy 또는 sell이어야 합니다.');
  }

  const { cano, acntPrdtCd } = getCredentials();

  // 실전투자 전용 TR ID
  const trId =
    side === 'buy'
      ? 'TTTC0802U'
      : 'TTTC0801U';

  const ordDvsn =
    orderType === 'limit'
      ? '00'
      : '01';

  const ordUnpr =
    orderType === 'limit'
      ? String(price)
      : '0';

  const body = {
    CANO: cano,
    ACNT_PRDT_CD: acntPrdtCd,
    PDNO: code,
    ORD_DVSN: ordDvsn,
    ORD_QTY: String(quantity),
    ORD_UNPR: ordUnpr,
  };

  const data = await kisRequest({
    method: 'POST',
    path: '/uapi/domestic-stock/v1/trading/order-cash',
    trId,
    body,
  });

  return {
    env: 'real',
    side,
    code,
    quantity,
    orderType,
    orderNo: data.output?.ODNO,
    orderTime: data.output?.ORD_TMD,
    message: data.msg1,
  };
}

// 해외주식 실전투자 TR ID
const OVERSEAS_TR_ID = {
  balance: 'TTTS3012R',
  buy: 'JTTT1002U',
  sell: 'JTTT1006U',
};

// 해외주식 잔고 조회
async function getOverseasBalance(exchange = 'NASD') {
  const { cano, acntPrdtCd } = getCredentials();

  const data = await kisRequest({
    method: 'GET',
    path: '/uapi/overseas-stock/v1/trading/inquire-balance',

    // 실전투자 전용
    trId: OVERSEAS_TR_ID.balance,

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
    .filter(
      (h) => Number(h.ovrs_cblc_qty) > 0
    )
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

  const summary = data.output2 || {};

  return {
    env: 'real',
    exchange,
    totalEvalAmountUsd: Number(
      summary.tot_evlu_pfls_amt || 0
    ),
    holdings,
  };
}

// 해외주식 실전 주문
async function placeOverseasOrder({
  code,
  quantity,
  price,
  side,
  exchange = 'NASD',
  confirm,
}) {
  if (confirm !== true) {
    throw new Error(
      '주문 확인(confirm)이 필요합니다. ' +
      '사용자 확인 없이는 주문을 실행하지 않습니다.'
    );
  }

  if (!code || !quantity || quantity <= 0) {
    throw new Error('종목코드와 수량을 정확히 입력하세요.');
  }

  if (!price || price <= 0) {
    throw new Error(
      '해외주식은 지정가 주문만 지원합니다. 가격을 입력하세요.'
    );
  }

  if (side !== 'buy' && side !== 'sell') {
    throw new Error('side는 buy 또는 sell이어야 합니다.');
  }

  const { cano, acntPrdtCd } = getCredentials();

  const trId =
    side === 'buy'
      ? OVERSEAS_TR_ID.buy
      : OVERSEAS_TR_ID.sell;

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
    ORD_DVSN: '00',
  };

  const data = await kisRequest({
    method: 'POST',
    path: '/uapi/overseas-stock/v1/trading/order',
    trId,
    body,
  });

  return {
    env: 'real',
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

module.exports = {
  getBalance,
  placeOrder,
  getOverseasBalance,
  placeOverseasOrder,
};
