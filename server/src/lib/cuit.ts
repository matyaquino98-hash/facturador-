/**
 * Validación de CUIT/CUIL: 11 dígitos con dígito verificador módulo 11.
 */
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function normalizeDoc(value: string): string {
  return (value ?? '').replace(/[^\d]/g, '');
}

export function isValidCuit(value: string): boolean {
  const digits = normalizeDoc(value);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // 00000000000, 11111111111, ...
  const checkDigit = Number(digits[10]);
  let acc = 0;
  for (let i = 0; i < 10; i++) acc += Number(digits[i]) * WEIGHTS[i]!;
  const mod = 11 - (acc % 11);
  const expected = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return expected === checkDigit;
}

/** DNI: 7 u 8 dígitos (no tiene dígito verificador). */
export function isValidDni(value: string): boolean {
  const digits = normalizeDoc(value);
  return digits.length >= 7 && digits.length <= 8 && Number(digits) > 0;
}

/** Formatea 20123456789 -> 20-12345678-9. Devuelve el original si no son 11 dígitos. */
export function formatCuit(value: string): string {
  const d = normalizeDoc(value);
  if (d.length !== 11) return value;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}
