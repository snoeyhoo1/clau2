// api/kis/balance.js

const {
  getBalance,
  getOverseasBalance,
} = require('../../lib/kisClient');

module.exports = async (req, res) => {
  try {
    const [
      domesticResult,
      overseasResult,
    ] = await Promise.allSettled([
      getBalance(),
      getOverseasBalance(),
    ]);

    const domestic =
      domesticResult.status === 'fulfilled'
        ? domesticResult.value
        : {
            error:
              domesticResult.reason?.message ||
              '국내 계좌 조회 실패',
          };

    const overseas =
      overseasResult.status === 'fulfilled'
        ? overseasResult.value
        : {
            error:
              overseasResult.reason?.message ||
              '해외 계좌 조회 실패',
          };

    res.status(200).json({
      domestic,
      overseas,

      // 화면에서 전체 자산을 계산하기 위한 기본값
      accountConnected:
        !domestic.error ||
        !overseas.error,

      env: 'real',
    });
  } catch (err) {
    res.status(500).json({
      error:
        err?.message ||
        '계좌 조회 중 알 수 없는 오류',
    });
  }
};
