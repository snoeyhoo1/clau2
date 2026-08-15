// lib/kisClient.js
// 한국투자증권 Open API - 실전투자 전용.
//
// 안전장치:
// - 모의투자 API/환경변수/분기를 사용하지 않음.
// - 실전 API 주소만 사용.
// - 주문 함수는 반드시 confirm:true를 받아야 실행됨.
// - 접근토큰은 Vercel KV + 서버 메모리에 캐싱.
// - 동시에 여러 요청이 들어와도 tokenP를 중복 호출하지 않음.
// - 토큰 발급 실패 직후 반복 호출을 막음.
// - 토큰 발급 실패 시 KIS의 실제 오류 내용을 반환.
//
// 필요한 환경변수:
// KIS_APP_KEY
// KIS_APP_SECRET
// KIS_CANO
// KIS_ACNT_PRDT_CD

const { kv } = require('@vercel/kv');

const BASE_URL =
  'https://openapi.koreainvestment.com:9443';

const TOKEN_CACHE_KEY =
  'kis:token:real';

const TOKEN_CACHE_SECONDS =
  23 * 60 * 60;

let memoryToken = null;
let memoryTokenExpiresAt = 0;

let tokenRequestPromise = null;

let tokenFailureUntil = 0;
let tokenFailureMessage = null;


/**
 * KIS 실전투자 환경변수
 */
function getCredentials() {
  const appKey = String(
    process.env.KIS_APP_KEY || ''
  ).trim();

  const appSecret = String(
    process.env.KIS_APP_SECRET || ''
  ).trim();

  const cano = String(
    process.env.KIS_CANO || ''
  ).trim();

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
 * KIS 오류를 최대한 자세하게 만든다.
 */
function makeKisError(
  prefix,
  status,
  data
) {
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

  return new Error(
    parts.join(' · ')
  );
}


/**
 * KIS 실전투자 접근토큰 발급
 */
async function getAccessToken() {
  const now = Date.now();

  // 메모리 캐시
  if (
    memoryToken &&
    memoryTokenExpiresAt >
      now + 5 * 60 * 1000
  ) {
    return memoryToken;
  }


  // 최근 토큰 발급 실패
  if (
    tokenFailureUntil > now &&
    tokenFailureMessage
  ) {
    throw new Error(
      tokenFailureMessage
    );
  }


  // Vercel KV 캐시
  try {
    const cached =
      await kv.get(
        TOKEN_CACHE_KEY
      );

    if (cached) {
      memoryToken =
        String(cached);

      memoryTokenExpiresAt =
        now +
        (TOKEN_CACHE_SECONDS -
          10 * 60) *
          1000;

      return memoryToken;
    }
  } catch (e) {
    console.warn(
      '[KIS] Vercel KV 토큰 조회 실패:',
      e?.message || e
    );
  }


  // 이미 발급 중이면 공유
  if (tokenRequestPromise) {
    return tokenRequestPromise;
  }


  tokenRequestPromise =
    (async () => {
      try {
        const {
          appKey,
          appSecret,
        } = getCredentials();

        const response =
          await fetch(
            `${BASE_URL}/oauth2/tokenP`,
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json; charset=utf-8',

                Accept:
                  'application/json',
              },

              body: JSON.stringify({
                grant_type:
                  'client_credentials',

                appkey:
                  appKey,

                appsecret:
                  appSecret,
              }),
            }
          );

        const data =
          await readResponse(
            response
          );


        if (!response.ok) {
          const error =
            makeKisError(
              'KIS 실전투자 토큰 발급 실패',
              response.status,
              data
            );

          const isRateLimit =
            response.status === 403 &&
            (
              data?.msg_cd ===
                'EGW00133' ||
              data?.error_code ===
                'EGW00133' ||
              String(
                data?.msg1 || ''
              ).includes(
                'EGW00133'
              )
            );

          if (isRateLimit) {
            tokenFailureUntil =
              Date.now() +
              65 * 1000;

            tokenFailureMessage =
              error.message;
          }

          throw error;
        }


        if (
          data.rt_cd &&
          data.rt_cd !== '0'
        ) {
          const error =
            makeKisError(
              'KIS 실전투자 토큰 발급 실패',
              response.status,
              data
            );

          const isRateLimit =
            data?.msg_cd ===
              'EGW00133' ||
            data?.error_code ===
              'EGW00133' ||
            String(
              data?.msg1 || ''
            ).includes(
              'EGW00133'
            );

          if (isRateLimit) {
            tokenFailureUntil =
              Date.now() +
              65 * 1000;

            tokenFailureMessage =
              error.message;
          }

          throw error;
        }


        if (!data.access_token) {
          throw new Error(
            'KIS 토큰 발급 실패: ' +
            'access_token이 응답에 없습니다.'
          );
        }


        const accessToken =
          String(
            data.access_token
          );

        memoryToken =
          accessToken;

        memoryTokenExpiresAt =
          Date.now() +
          (TOKEN_CACHE_SECONDS -
            10 * 60) *
            1000;

        tokenFailureUntil = 0;
        tokenFailureMessage =
          null;


        try {
          await kv.set(
            TOKEN_CACHE_KEY,
            accessToken,
            {
              ex:
                TOKEN_CACHE_SECONDS,
            }
          );
        } catch (e) {
          console.warn(
            '[KIS] Vercel KV 토큰 저장 실패:',
            e?.message || e
          );
        }

        console.log(
          '[KIS] 실전투자 access token 발급 완료'
        );

        return accessToken;

      } finally {
        tokenRequestPromise =
          null;
      }
    })();

  return tokenRequestPromise;
}


/**
 * KIS Hashkey 발급
 */
async function getHashkey(body) {
  const {
    appKey,
    appSecret,
  } = getCredentials();

  const response =
    await fetch(
      `${BASE_URL}/uapi/hashkey`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json; charset=utf-8',

          appkey:
            appKey,

          appsecret:
            appSecret,
        },

        body:
          JSON.stringify(body),
      }
    );

  const data =
    await readResponse(
      response
    );

  if (!response.ok) {
    throw makeKisError(
      'KIS 해시키 발급 실패',
      response.status,
      data
    );
  }

  if (!data.HASH) {
    throw new Error(
      'KIS 해시키 발급 실패: ' +
      'HASH가 응답에 없습니다.'
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
  const token =
    await getAccessToken();

  const {
    appKey,
    appSecret,
  } = getCredentials();

  const headers = {
    'Content-Type':
      'application/json; charset=utf-8',

    Accept:
      'application/json',

    authorization:
      `Bearer ${token}`,

    appkey:
      appKey,

    appsecret:
      appSecret,

    tr_id:
      trId,

    custtype:
      'P',
  };

  let url =
    `${BASE_URL}${path}`;

  const options = {
    method,
    headers,
  };


  if (
    method === 'GET' &&
    params
  ) {
    const query =
      new URLSearchParams(
        params
      ).toString();

    url += `?${query}`;
  }


  if (
    method === 'POST' &&
    body
  ) {
    headers.hashkey =
      await getHashkey(
        body
      );

    options.body =
      JSON.stringify(body);
  }


  const response =
    await fetch(
      url,
      options
    );

  const data =
    await readResponse(
      response
    );


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
 *
 * 중요:
 * totalEvalAmount는 계좌 전체 평가금액이 아니라
 * "국내 보유주식 평가액"으로 반환한다.
 *
 * app.js에서
 *
 * 현금 + 국내주식 + 해외주식 + 해외현금
 *
 * 형태로 전체 자산을 계산하기 때문에
 * tot_evlu_amt를 그대로 반환하면
 * 현금이 중복될 수 있다.
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

      trId:
        'TTTC8434R',

      params: {
        CANO:
          cano,

        ACNT_PRDT_CD:
          acntPrdtCd,

        AFHR_FLPR_YN:
          'N',

        UNPR_DVSN:
          '01',

        FUND_STTL_ICLD_YN:
          'N',

        FNCG_AMT_AUTO_RDPT_YN:
          'N',

        OFL_YN:
          '',

        INQR_DVSN:
          '01',

        PRCS_DVSN:
          '00',

        CTX_AREA_FK100:
          '',

        CTX_AREA_NK100:
          '',
      },
    });


  const holdings =
    (data.output1 || [])
      .filter(
        (h) =>
          Number(h.hldg_qty) > 0
      )
      .map((h) => ({
        code:
          h.pdno,

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
    (data.output2 || [])[0] ||
    {};


  // 현금
  const cash =
    Number(
      summary.dnca_tot_amt || 0
    );


  // 주문가능현금
  const orderableCash =
    Number(
      summary.nxdy_excc_amt ||
      summary.prvs_rcdl_excc_amt ||
      0
    );


  // 실제 보유 국내주식 평가액
  const holdingsStockValue =
    holdings.reduce(
      (sum, h) =>
        sum +
        Number(
          h.evalAmount || 0
        ),
      0
    );


  /*
   * KIS가 제공하는 scts_evlu_amt가
   * 유효하면 사용한다.
   *
   * 그렇지 않으면 종목별 평가액을
   * 직접 합산한다.
   */
  const securitiesEvalAmount =
    Number(
      summary.scts_evlu_amt
    );


  const totalEvalAmount =
    Number.isFinite(
      securitiesEvalAmount
    ) &&
    securitiesEvalAmount > 0
      ? securitiesEvalAmount
      : holdingsStockValue;


  const totalProfitLoss =
    Number(
      summary.evlu_pfls_smtl_amt ||
      0
    );


  const totalProfitLossPct =
    Number(
      summary.evlu_pfls_rt ||
      0
    );


  return {
    env:
      'real',

    cash,

    orderableCash,

    // 반드시 국내 보유주식 평가액만 반환
    totalEvalAmount,

    totalProfitLoss,

    totalProfitLossPct,

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
    CANO:
      cano,

    ACNT_PRDT_CD:
      acntPrdtCd,

    PDNO:
      code,

    ORD_DVSN:
      ordDvsn,

    ORD_QTY:
      String(quantity),

    ORD_UNPR:
      ordUnpr,
  };


  const data =
    await kisRequest({
      method:
        'POST',

      path:
        '/uapi/domestic-stock/v1/trading/order-cash',

      trId,

      body,
    });


  return {
    env:
      'real',

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
  balance:
    'TTTS3012R',

  buy:
    'JTTT1002U',

  sell:
    'JTTT1006U',
};


/**
 * 해외주식 잔고 조회
 *
 * 중요:
 * totalEvalAmountUsd도 계좌 전체 평가금액을
 * 그대로 반환하지 않는다.
 *
 * 보유 종목 평가액만 합산한다.
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
      method:
        'GET',

      path:
        '/uapi/overseas-stock/v1/trading/inquire-balance',

      trId:
        OVERSEAS_TR_ID.balance,

      params: {
        CANO:
          cano,

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
          Number(
            h.ovrs_cblc_qty
          ) > 0
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


  // 해외 보유주식 평가액만 합산
  const holdingsEvalUsd =
    holdings.reduce(
      (sum, h) =>
        sum +
        Number(
          h.evalAmount || 0
        ),
      0
    );


  const summary =
    data.output2 || {};


  /*
   * 해외 현금.
   *
   * KIS 응답에서 제공되는 필드 중
   * 실제 값이 존재하는 필드를 사용한다.
   */
  const cashUsd =
    Number(
      summary.frcr_use_amt ||
      summary.frcr_dnca_amt ||
      summary.d2_frcr_ufsh_amt ||
      0
    );


  const totalProfitLossUsd =
    Number(
      summary.ovrs_tot_pfls ||
      summary.evlu_pfls_amt ||
      summary.tot_evlu_pfls_amt ||
      0
    );


  return {
    env:
      'real',

    exchange,

    // 해외 보유주식 평가액만 반환
    totalEvalAmountUsd:
      holdingsEvalUsd,

    cashUsd,

    totalProfitLossUsd,

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
    CANO:
      cano,

    ACNT_PRDT_CD:
      acntPrdtCd,

    OVRS_EXCG_CD:
      exchange,

    PDNO:
      code,

    ORD_QTY:
      String(quantity),

    OVRS_ORD_UNPR:
      String(price),

    CTAC_TLNO:
      '',

    MGCO_APTM_ODNO:
      '',

    ORD_SVR_DVSN_CD:
      '0',

    ORD_DVSN:
      '00',
  };


  const data =
    await kisRequest({
      method:
        'POST',

      path:
        '/uapi/overseas-stock/v1/trading/order',

      trId,

      body,
    });


  return {
    env:
      'real',

    market:
      'overseas',

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
