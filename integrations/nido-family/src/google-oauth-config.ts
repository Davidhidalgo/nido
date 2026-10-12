// Public service origin chosen by the Nido publisher. Never put OAuth secrets here.
// Empty until the shared service has been deployed and verified.
export const googleOAuthService = "";

export function oauthOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("El servicio OAuth de Nido debe tener un origen HTTPS.");
  return url.origin;
}

export function configuredOAuthService(): string | undefined {
  const value = process.env.NIDO_GOOGLE_AUTH_URL || googleOAuthService;
  return value ? oauthOrigin(value) : undefined;
}

export function oauthUiOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Abre OpenClaw mediante HTTPS o localhost para conectar con Google.");
  return url.origin;
}
