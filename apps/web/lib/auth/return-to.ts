export function safeReturnTo(value?: string) {
  return typeof value === 'string' &&
    /^(\/|\/account|\/library|\/recordings\/[a-f0-9-]{36})$/.test(value)
    ? value
    : '/account';
}
