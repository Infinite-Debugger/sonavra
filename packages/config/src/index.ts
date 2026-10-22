export const serviceName = 'sonavra';
export const apiPort = Number(process.env.API_PORT ?? 3001);

export function guestRetentionHours(
  value = process.env.SONAVRA_GUEST_RETENTION_HOURS,
) {
  const hours = value === undefined ? 24 : Number(value);
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 8760) {
    throw new Error(
      'SONAVRA_GUEST_RETENTION_HOURS must be an integer between 1 and 8760',
    );
  }
  return hours;
}
