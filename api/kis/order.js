// api/kis/order.js
const { placeOrder, placeOverseasOrder } = require('../../lib/kisClient');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원' });
  try {
    const { market, code, quantity, price, side, orderType, exchange, confirm } = req.body || {};

    let result;
    if (market === 'overseas') {
      result = await placeOverseasOrder(undefined, {
        code,
        quantity: Number(quantity),
        price: Number(price),
        side,
        exchange: exchange || 'NASD',
        confirm,
      });
    } else {
      result = await placeOrder(undefined, {
        code,
        quantity: Number(quantity),
        price: price ? Number(price) : undefined,
        side,
        orderType,
        confirm,
      });
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
