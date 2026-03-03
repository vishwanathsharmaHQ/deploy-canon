const config = require('../config');

function aiTimeout(req, res, next) {
  res.setTimeout(config.openai.timeout, () => {
    res.status(504).send('Request timeout');
  });
  next();
}

module.exports = { aiTimeout };
