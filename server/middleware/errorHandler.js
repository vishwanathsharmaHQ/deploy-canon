function errorHandler(err, _req, res, _next) {
  console.error('Unhandled error:', err);
  const status = err.statusCode || 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
