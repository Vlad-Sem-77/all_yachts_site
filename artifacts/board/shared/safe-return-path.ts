const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeLocalReturnPath(
  value: unknown,
  baseOrigin: string,
  fallback = "/forum",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return fallback;
  }

  try {
    const base = new URL(baseOrigin);
    const target = new URL(value, base);
    if (target.origin !== base.origin || target.username || target.password) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
