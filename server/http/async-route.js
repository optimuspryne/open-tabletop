// Express 4 does not forward rejected async-handler promises to error middleware.
// Wrap every async route so operational failures receive one consistent response.
export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function httpErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  console.error(`[http] ${req.method} ${req.originalUrl}:`, err && err.message ? err.message : err);
  res.status(500).json({ error: 'internal server error' });
}
