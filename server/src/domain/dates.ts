/** Fechas en el formato AAAAMMDD que usa WSFEv1, siempre en horario de Argentina. */
const AR_TZ = 'America/Argentina/Buenos_Aires';

export function hoyArca(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts.replace(/-/g, '');
}

/** "2026-09-09" -> "20260909". Acepta también el formato ya compacto. */
export function toArcaDate(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length !== 8) throw new Error(`Fecha inválida: ${value}`);
  return digits;
}

/** "20260909" -> "09/09/2026" */
export function fromArcaDate(value: string | null | undefined): string {
  if (!value || value.length !== 8) return '';
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

/** "20260909" -> "2026-09-09" (para el JSON del QR). */
export function arcaDateToIso(value: string): string {
  if (!value || value.length !== 8) return '';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export function esFechaValida(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Diferencia en días entre dos fechas AAAAMMDD (b - a). */
export function diffDias(a: string, b: string): number {
  const toUtc = (v: string) =>
    Date.UTC(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)));
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
