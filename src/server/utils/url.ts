export function getApiBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) {
    return process.env.VITE_API_BASE_URL;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  return 'http://localhost:3080';
}

/** Server-to-server API URL. Falls back to getApiBaseUrl() if API_SERVER_URL is not set. */
export function getServerApiUrl(): string {
  if (typeof process !== 'undefined' && process.env?.API_SERVER_URL) {
    return process.env.API_SERVER_URL;
  }
  return getApiBaseUrl();
}
