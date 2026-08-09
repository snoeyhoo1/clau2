// lib/dataSources.js
// 키 없이 쓸 수 있는 Yahoo Finance 공개 엔드포인트 래퍼.
// 미국 종목: 티커 그대로 (예: AAPL)
// 한국 종목: 코스피는 .KS, 코스닥은 .KQ 접미사 (예: 삼성전자 -> 005930.KS, 카카오 -> 035720.KQ)

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const RSS_URL = 'https://feeds.finance.yahoo.com/rss/2.0/headline';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (signal-app)' },
  });
  if (!res.ok) throw new Error(`요청 실패 (${res.status}): ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (signal-app)' },
  });
  if (!res.ok) throw new Error(`요청 실패 (${res.status}): ${url}`);
  return res.text();
}

// 최근 종가 배열 + 현재가 반환
async function getQuoteAndHistory(ticker, range = '6mo', interval = '1d') {
  const url = `${CHART_URL}/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`데이터 없음: ${ticker}`);

  const closesRaw = result.indicators?.quote?.[0]?.close || [];
  const timestampsRaw = result.timestamp || [];
  const closes = [];
  const dates = [];
  closesRaw.forEach((c, i) => {
    if (c !== null && c !== undefined) {
      closes.push(c);
      dates.push(new Date(timestampsRaw[i] * 1000).toISOString().slice(0, 10));
    }
  });
  const meta = result.meta || {};

  // 버그 수정: meta.chartPreviousClose는 요청한 range(예: 3년)의 "시작 시점 기준" 값이라
  // 장기 range를 요청하면 등락률이 터무니없이 커지는 문제가 있었음.
  // 실제 하루 전 종가는 closes 배열의 마지막에서 두 번째 값을 쓰는 게 정확함.
  const actualPreviousClose = closes.length >= 2 ? closes[closes.length - 2] : meta.chartPreviousClose;

  return {
    ticker,
    currency: meta.currency,
    exchange: meta.exchangeName,
    currentPrice: meta.regularMarketPrice,
    previousClose: actualPreviousClose,
    closes,
    dates,
  };
}

// RSS <item> 블록 단위로 title/pubDate를 정확히 짝지어 파싱
function parseRssItems(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return items.map((m) => {
    const block = m[1];
    const titleMatch = block.match(/<title>(.*?)<\/title>/);
    const dateMatch = block.match(/<pubDate>(.*?)<\/pubDate>/);
    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null;
    const pubDate = dateMatch ? new Date(dateMatch[1]) : null;
    return { title, pubDate: pubDate && !isNaN(pubDate) ? pubDate : null };
  }).filter((i) => i.title);
}

function normalizeForDedupe(title) {
  return title.toLowerCase().replace(/[^\w가-힣\s]/g, '').slice(0, 50);
}

// 티커 관련 최근 뉴스 헤드라인을 Yahoo Finance RSS + 구글 뉴스 RSS 두 소스에서 모아
// 중복 제거 후 최신순으로 정렬. 각 헤드라인은 { title, source, publishedAt } 형태.
async function getHeadlines(ticker, limit = 10, companyLabel) {
  const searchTerm = companyLabel || ticker;
  const sources = [
    { url: `${RSS_URL}?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`, name: 'Yahoo Finance' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent(searchTerm + ' stock')}&hl=en-US&gl=US&ceid=US:en`, name: 'Google News' },
  ];

  const results = await Promise.allSettled(sources.map((s) => fetchText(s.url)));
  let combined = [];
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const items = parseRssItems(r.value);
    items.forEach((item) => combined.push({ title: item.title, source: sources[i].name, publishedAt: item.pubDate }));
  });

  // 중복 제거 (제목 앞부분이 비슷하면 같은 뉴스로 간주, 먼저 나온 것 유지)
  const seen = new Set();
  combined = combined.filter((item) => {
    const key = normalizeForDedupe(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 최근 10일 이내로 제한 (날짜 파싱 실패한 항목은 최신일 수도 있으니 보존)
  const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  combined = combined.filter((item) => !item.publishedAt || now - item.publishedAt.getTime() <= TEN_DAYS);

  // 최신순 정렬 (날짜 없는 항목은 뒤로)
  combined.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return b.publishedAt - a.publishedAt;
  });

  return combined.slice(0, limit);
}

function toKRTicker(code, market = 'KS') {
  // code: '005930' 같은 종목코드, market: 'KS'(코스피) or 'KQ'(코스닥)
  return `${code}.${market}`;
}

// 지수처럼 현재가+등락률만 필요할 때 쓰는 경량 조회 (뉴스/장기이력 불필요)
async function getSimpleQuote(ticker) {
  const url = `${CHART_URL}/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`데이터 없음: ${ticker}`);
  const meta = result.meta || {};
  const closesRaw = (result.indicators?.quote?.[0]?.close || []).filter((c) => c !== null && c !== undefined);
  const previousClose = closesRaw.length >= 2 ? closesRaw[closesRaw.length - 2] : meta.chartPreviousClose;
  const currentPrice = meta.regularMarketPrice;
  const changePct = previousClose
    ? (((currentPrice - previousClose) / previousClose) * 100).toFixed(2)
    : null;
  return { ticker, currentPrice, changePct, currency: meta.currency };
}

module.exports = {
  getQuoteAndHistory,
  getHeadlines,
  toKRTicker,
  getSimpleQuote,
};
