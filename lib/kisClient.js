// lib/kisClient.js
// 한국투자증권 Open API - 실전투자 전용.
//
// 안전장치:
// - 모의투자 API/환경변수/분기를 사용하지 않음.
// - 실전 API 주소만 사용.
// - 주문 함수는 반드시 confirm:true를 받아야 실행됨.
// - 접근토큰은 Vercel KV에 캐싱.
// - 토큰 발급 실패 시 KIS의 실제 오류 내용을 반환.
//
// 필요한 환경변수:
// KIS_APP_KEY
// KIS_APP_SECRET
// KIS_CANO
// KIS_ACNT_PRDT_CD

const { kv } = require('@vercel/kv');

const BASE_URL = 'https://openapi.koreainvestment.com:9443';
const TOKEN_CACHE_KEY = 'kis:token:real';
const TOKEN_CACHE_SECONDS = 23 * 60 * 60;

function getCredentials() {
  const appKey = String(process.env.KIS_APP_KEY || '').trim();
  const appSecret = String(process.env.KIS_APP_SECRET || '').trim();
  const cano = String(process.env.KIS_CANO || '').trim();
  const acntPrdtCd = String(
    process.env.KIS_ACNT_PRDT_CD || '01'
  ).trim();

  if (!appKey || !appSecret || !cano) {
    throw new Error(
      'KIS 실전투자 환경변수가 설정되지 않았습니다. ' +
      'KIS_APP_KEY, KIS_APP_SECRET, KIS_CANO를 확인하세요.'
    );
  }

  if (!/^\d{8}$/.test(cano)) {
    throw new Error(
      'KIS_CANO 형식이 잘못되었습니다. ' +
      '계좌번호 앞 8자리를 입력해야 합니다.'
    );
  }

  if (!/^\d{2}$/.test(acntPrdtCd)) {
    throw new Error(
      'KIS_ACNT_PRDT_CD 형식이 잘못되었습니다.'
    );
  }

  return {
    appKey,
    appSecret,
    cano,
    acntPrdtCd,
  };
}

/**
 * KIS API 응답을 안전하게 JSON으로 읽는다.
 * JSON이 아닌 경우에도 원문 일부를 오류에 포함한다.
 */
async function readResponse(res) {
  const text = await res.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text.slice(0, 1000),
    };
  }
}

/**
 * KIS 오류를 최대한 자세하게 만들어준다.
 */
function makeKisError(prefix, status, data) {
  const code =
    data?.msg_cd ||
    data?.error_code ||
    data?.code ||
    '';

  const message =
    data?.msg1 ||
    data?.error_description ||
    data?.error_message ||
    data?.message ||
    data?.raw ||
    '알 수 없는 오류';

  const parts = [
    prefix,
    status ? `HTTP ${status}` : '',
    code ? `코드 ${code}` : '',
    message,
  ].filter(Boolean);

  return new Error(parts.join(' · '));
}

/**
 * 실전투자 접근토큰 발급
 *
 * 중요:
 * 기존 코드에서는 403이 발생하면
 * "KIS 토큰 발급 실패 (403)"만 보여주고
 * KIS가 반환한 실제 원인을 버렸다.
 *
 * 여기서는 msg_cd / msg1 / error_description 등을
 * 모두 확인해서 실제 원인을 보여준다.
 */
async function getAccessToken() {
  let cached = null;

  try {
    cached = await kv.get(TOKEN_CACHE_KEY);
  } catch (e) {
    console.warn(
      '[KIS] Vercel KV 토큰 조회 실패:',
      e?.message || e
    );
  }

  if (cached) {
    return cached;
  }

  const { appKey, appSecret } = getCredentials();

  const response = await fetch(
    `${BASE_URL}/oauth2/tokenP`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: appKey,
        appsecret: appSecret,
      }),
    }
  );

  const data = await readResponse(response);

  if (!response.ok) {
    throw makeKisError(
      'KIS 실전투자 토큰 발급 실패',
      response.status,
      data
    );
  }

  if (
    data.rt_cd &&
    data.rt_cd !== '0'
  ) {
    throw makeKisError(
      'KIS 실전투자 토큰 발급 실패',
      response.status,
      data
    );
  }

  if (!data.access_token) {
    throw new Error(
      'KIS 토큰 발급 실패: access_token이 응답에 없습니다.'
    );
  }

  try {
    await kv.set(
      TOKEN_CACHE_KEY,
      data.access_token,
      {
        ex: TOKEN_CACHE_SECONDS,
      }
    );
  } catch (e) {
    console.warn(
      '[KIS] Vercel KV 토큰 저장 실패:',
      e?.message || e
    );
  }

  return data.access_token;
}

/**
 * KIS Hashkey 발급
 */
async function getHashkey(body) {
  const {
    appKey,
    appSecret,
  } = getCredentials();

  const response = await fetch(
    `${BASE_URL}/uapi/hashkey`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        appkey: appKey,
        appsecret: appSecret,
      },
      body: JSON.stringify(body),
    }
  );

  const data = await readResponse(response);

  if (!response.ok) {
    throw makeKisError(
      'KIS 해시키 발급 실패',
      response.status,
      data
    );
  }

  if (!data.HASH) {
    throw new Error(
      'KIS 해시키 발급 실패: HASH가 응답에 없습니다.'
    );
  }

  return data.HASH;
}

/**
 * KIS API 공통 요청
 */
async function kisRequest({
  method,
  path,
  trId,
  params,
  body,
}) {
  const token = await getAccessToken();

  const {
    appKey,
    appSecret,
  } = getCredentials();

  const headers = {
    'Content-Type':
      'application/json; charset=utf-8',

    Accept: 'application/json',

    authorization:
      `Bearer ${token}`,

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

  if (
    method === 'GET' &&
    params
  ) {
    const query =
      new URLSearchParams(params)
        .toString();

    url += `?${query}`;
  }

  if (
    method === 'POST' &&
    body
  ) {
    headers.hashkey =
      await getHashkey(body);

    options.body =
      JSON.stringify(body);
  }

  const response =
    await fetch(url, options);

  const data =
    await readResponse(response);

  if (!response.ok) {
    throw makeKisError(
      'KIS API 요청 실패',
      response.status,
      data
    );
  }

  if (
    data.rt_cd &&
    data.rt_cd !== '0'
  ) {
    throw makeKisError(
      'KIS API 오류',
      response.status,
      data
    );
  }

  return data;
}

/**
 * 국내주식 잔고 조회
 */
async function getBalance() {
  const {
    cano,
    acntPrdtCd,
  } = getCredentials();

  const data =
    await kisRequest({
      method: 'GET',

      path:
        '/uapi/domestic-stock/v1/trading/inquire-balance',

      trId: 'TTTC8434R',

      params: {
        CANO: cano,
        ACNT_PRDT_CD:
          acntPrdtCd,

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

  const holdings =
    (data.output1 || [])
      .filter(
        (h) =>
          Number(h.hldg_qty) > 0
      )
      .map((h) => ({
        code: h.pdno,

        name:
          h.prdt_name,

        quantity:
          Number(h.hldg_qty),

        avgPrice:
          Number(h.pchs_avg_pric),

        currentPrice:
          Number(h.prpr),

        evalAmount:
          Number(h.evlu_amt),

        profitLossPct:
          Number(h.evlu_pfls_rt),
      }));

  const summary =
    (data.output2 || [])[0] || {};

  const cash =
    Number(
      summary.dnca_tot_amt || 0
    );

  const orderableCash =
    Number(
      summary.nxdy_excc_amt ||
      summary.prvs_rcdl_excc_amt ||
      0
    );

  const totalEvalAmount =
    Number(
      summary.tot_evlu_amt || 0
    );

  const totalProfitLoss =
    Number(
      summary.evlu_pfls_smtl_amt ||
      0
    );

  return {
    env: 'real',

    cash,

    orderableCash,

    totalEvalAmount,

    totalProfitLoss,

    holdings,
  };
}

/**
 * 국내주식 현금 주문
 */
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

  if (
    !code ||
    !quantity ||
    quantity <= 0
  ) {
    throw new Error(
      '종목코드와 수량을 정확히 입력하세요.'
    );
  }

  if (
    side !== 'buy' &&
    side !== 'sell'
  ) {
    throw new Error(
      'side는 buy 또는 sell이어야 합니다.'
    );
  }

  const {
    cano,
    acntPrdtCd,
  } = getCredentials();

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
    ACNT_PRDT_CD:
      acntPrdtCd,

    PDNO: code,

    ORD_DVSN:
      ordDvsn,

    ORD_QTY:
      String(quantity),

    ORD_UNPR:
      ordUnpr,
  };

  const data =
    await kisRequest({
      method: 'POST',

      path:
        '/uapi/domestic-stock/v1/trading/order-cash',

      trId,

      body,
    });

  return {
    env: 'real',

    side,

    code,

    quantity,

    orderType,

    orderNo:
      data.output?.ODNO,

    orderTime:
      data.output?.ORD_TMD,

    message:
      data.msg1,
  };
}

/**
 * 해외주식 TR ID
 */
const OVERSEAS_TR_ID = {
  balance: 'TTTS3012R',
  buy: 'JTTT1002U',
  sell: 'JTTT1006U',
};

/**
 * 해외주식 잔고 조회
 */
async function getOverseasBalance(
  exchange = 'NASD'
) {
  const {
    cano,
    acntPrdtCd,
  } = getCredentials();

  const data =
    await kisRequest({
      method: 'GET',

      path:
        '/uapi/overseas-stock/v1/trading/inquire-balance',

      trId:
        OVERSEAS_TR_ID.balance,

      params: {
        CANO: cano,

        ACNT_PRDT_CD:
          acntPrdtCd,

        OVRS_EXCG_CD:
          exchange,

        TR_CRCY_CD:
          'USD',

        CTX_AREA_FK200:
          '',

        CTX_AREA_NK200:
          '',
      },
    });

  const holdings =
    (data.output1 || [])
      .filter(
        (h) =>
          Number(h.ovrs_cblc_qty) > 0
      )
      .map((h) => ({
        code:
          h.ovrs_pdno,

        name:
          h.ovrs_item_name,

        quantity:
          Number(
            h.ovrs_cblc_qty
          ),

        avgPrice:
          Number(
            h.pchs_avg_pric
          ),

        currentPrice:
          Number(
            h.now_pric2
          ),

        evalAmount:
          Number(
            h.ovrs_stck_evlu_amt
          ),

        profitLossPct:
          Number(
            h.evlu_pfls_rt
          ),

        currency:
          'USD',
      }));

  const summary =
    data.output2 || {};

  return {
    env: 'real',

    exchange,

    totalEvalAmountUsd:
      Number(
        summary.tot_evlu_pfls_amt ||
        summary.tot_evlu_amt ||
        0
      ),

    holdings,
  };
}

/**
 * 해외주식 실전 주문
 */
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

  if (
    !code ||
    !quantity ||
    quantity <= 0
  ) {
    throw new Error(
      '종목코드와 수량을 정확히 입력하세요.'
    );
  }

  if (
    !price ||
    price <= 0
  ) {
    throw new Error(
      '해외주식은 지정가 주문만 지원합니다. ' +
      '가격을 입력하세요.'
    );
  }

  if (
    side !== 'buy' &&
    side !== 'sell'
  ) {
    throw new Error(
      'side는 buy 또는 sell이어야 합니다.'
    );
  }

  const {
    cano,
    acntPrdtCd,
  } = getCredentials();

  const trId =
    side === 'buy'
      ? OVERSEAS_TR_ID.buy
      : OVERSEAS_TR_ID.sell;

  const body = {
    CANO: cano,

    ACNT_PRDT_CD:
      acntPrdtCd,

    OVRS_EXCG_CD:
      exchange,

    PDNO: code,

    ORD_QTY:
      String(quantity),

    OVRS_ORD_UNPR:
      String(price),

    CTAC_TLNO: '',

    MGCO_APTM_ODNO: '',

    ORD_SVR_DVSN_CD:
      '0',

    ORD_DVSN:
      '00',
  };

  const data =
    await kisRequest({
      method: 'POST',

      path:
        '/uapi/overseas-stock/v1/trading/order',

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

    orderNo:
      data.output?.ODNO,

    orderTime:
      data.output?.ORD_TMD,

    message:
      data.msg1,
  };
}

module.exports = {
  getBalance,
  placeOrder,
  getOverseasBalance,
  placeOverseasOrder,
};
