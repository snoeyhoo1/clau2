// api/kis/order.js

const { guard } = require('../../lib/auth');

const {
  placeOrder,
  placeOverseasOrder,
} = require('../../lib/kisClient');

module.exports = async (req, res) => {
  if (guard(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'POST만 지원',
    });
  }

  try {
    const {
      market,
      code,
      quantity,
      price,
      side,
      orderType,
      exchange,
      confirm,
    } = req.body || {};

    let result;

    if (market === 'overseas') {
      result = await placeOverseasOrder({
        code,
        quantity: Number(quantity),
        price: Number(price),
        side,
        exchange: exchange || 'NASD',
        confirm,
      });
    } else {
      result = await placeOrder({
        code,
        quantity: Number(quantity),
        price: price ? Number(price) : undefined,
        side,
        orderType,
        confirm,
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({
      error: err.message,
    });
  }
};
