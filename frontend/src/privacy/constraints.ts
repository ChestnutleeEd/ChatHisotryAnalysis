const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const MAIN_THREAD_ANALYSIS_FALLBACK = "forbidden" as const;

export function isLoopbackRuntimeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" ||
        url.protocol === "https:" ||
        url.protocol === "ws:" ||
        url.protocol === "wss:") &&
      LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isSameLoopbackOriginRequest(
  value: string,
  expectedOrigin: string,
): boolean {
  try {
    const requestUrl = new URL(value);
    const originUrl = new URL(expectedOrigin);
    return (
      isLoopbackRuntimeUrl(requestUrl.href) &&
      isLoopbackRuntimeUrl(originUrl.href) &&
      requestUrl.origin === originUrl.origin
    );
  } catch {
    return false;
  }
}
