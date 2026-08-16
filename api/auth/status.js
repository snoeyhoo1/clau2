// api/auth/status.js

const {
  isAuthConfigured,
  isAuthed,
} = require('../../lib/auth');

module.exports = async (req, res) => {
  return res.status(200).json({
    authRequired: isAuthConfigured(),
    authed: isAuthed(req),
  });
};
