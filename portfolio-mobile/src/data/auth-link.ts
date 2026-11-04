export function parseAuthLink(raw: string, redirect: string) {
  const url = new URL(raw);
  const target = new URL(redirect);
  if (url.protocol !== target.protocol || url.host !== target.host || url.pathname !== target.pathname) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  const error = params.get('error_description') ?? url.searchParams.get('error_description');
  if (error) throw new Error(error);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken && !refreshToken) return null;
  if (!accessToken || !refreshToken) throw new Error('Incomplete authentication link.');
  return { accessToken, refreshToken, recovery: params.get('type') === 'recovery' };
}
