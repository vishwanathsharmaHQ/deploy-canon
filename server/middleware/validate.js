/**
 * Validate that specified params are valid integers.
 * Usage: validateParams('threadId', 'nodeId')
 */
function validateParams(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      const val = parseInt(req.params[name]);
      if (isNaN(val)) {
        return res.status(400).json({ error: `Invalid ${name}: must be an integer` });
      }
      req.params[name] = val;
    }
    next();
  };
}

/**
 * Validate that required body fields are present.
 * Usage: requireBody('title', 'content')
 */
function requireBody(...fields) {
  return (req, res, next) => {
    for (const field of fields) {
      if (req.body[field] === undefined || req.body[field] === null) {
        return res.status(400).json({ error: `${field} is required` });
      }
    }
    next();
  };
}

module.exports = { validateParams, requireBody };
