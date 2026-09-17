/**
 * Every response carries a meta block so the UI can always tell the user how
 * fresh the data is and whether a source is currently failing.
 */
export const ok = (res, data, meta = {}) => res.json({ ok: true, data, meta });

export const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ ok: false, error: message, ...extra });

/** Wraps an async route so a thrown error becomes a clean JSON response. */
export const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
