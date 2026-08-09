// lib/universe.js
// 자동 스캔 대상 종목 목록. 개별 관심종목 편집 대신, 이 유니버스 전체를
// 매번 스캔해서 신호가 강한 종목을 자동으로 찾아냄.
// 유니버스가 커질수록 스캔 시간/API 호출이 늘어나므로 적당한 크기로 유지.

const US_UNIVERSE = [
  { ticker: 'AAPL', label: '애플' },
  { ticker: 'MSFT', label: '마이크로소프트' },
  { ticker: 'NVDA', label: '엔비디아' },
  { ticker: 'GOOGL', label: '알파벳' },
  { ticker: 'AMZN', label: '아마존' },
  { ticker: 'META', label: '메타' },
  { ticker: 'TSLA', label: '테슬라' },
  { ticker: 'AVGO', label: '브로드컴' },
  { ticker: 'AMD', label: 'AMD' },
  { ticker: 'NFLX', label: '넷플릭스' },
  { ticker: 'JPM', label: 'JP모건' },
  { ticker: 'V', label: '비자' },
  { ticker: 'JNJ', label: '존슨앤존슨' },
  { ticker: 'WMT', label: '월마트' },
  { ticker: 'PLTR', label: '팔란티어' },
];

const KR_UNIVERSE = [
  { ticker: '005930.KS', label: '삼성전자' },
  { ticker: '000660.KS', label: 'SK하이닉스' },
  { ticker: '035420.KS', label: 'NAVER' },
  { ticker: '035720.KS', label: '카카오' },
  { ticker: '005380.KS', label: '현대차' },
  { ticker: '051910.KS', label: 'LG화학' },
  { ticker: '006400.KS', label: '삼성SDI' },
  { ticker: '207940.KS', label: '삼성바이오로직스' },
  { ticker: '068270.KS', label: '셀트리온' },
  { ticker: '005490.KS', label: 'POSCO홀딩스' },
  { ticker: '028260.KS', label: '삼성물산' },
  { ticker: '096770.KS', label: 'SK이노베이션' },
  { ticker: '247540.KQ', label: '에코프로비엠' },
  { ticker: '086520.KQ', label: '에코프로' },
  { ticker: '091990.KQ', label: '셀트리온헬스케어' },
];

const FULL_UNIVERSE = [...US_UNIVERSE, ...KR_UNIVERSE];

// 시장 지수 (시장 현황 화면용)
const INDICES = [
  { ticker: '^GSPC', label: 'S&P 500' },
  { ticker: '^IXIC', label: '나스닥' },
  { ticker: '^KS11', label: '코스피' },
  { ticker: '^KQ11', label: '코스닥' },
];

module.exports = { US_UNIVERSE, KR_UNIVERSE, FULL_UNIVERSE, INDICES };
