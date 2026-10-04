export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid request body.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ message: 'Request is too large.' });
  if (err?.name === 'ValidationError') return res.status(400).json({ message: 'Some fields are invalid.' });
  console.error(err);
  return res.status(500).json({ message: 'Something went wrong. Please try again.' });
}
