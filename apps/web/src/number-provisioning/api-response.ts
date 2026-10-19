export class ApiResponseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
  // A gateway failure or lost acknowledgement may follow a successful write.
  get rejected() { return this.status >= 400 && this.status < 500; }
}

export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { /* Proxies may replace errors with HTML. */ }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : undefined;
    throw new ApiResponseError(message ?? (response.status === 401 ? 'Your session expired. Sign in again.' : response.status >= 500 ? 'The server is temporarily unavailable. Please try again shortly.' : fallback), response.status);
  }
  if (!data || typeof data !== 'object') throw new ApiResponseError('The server returned an unexpected response. Please try again shortly.', response.status);
  return data as T;
}
