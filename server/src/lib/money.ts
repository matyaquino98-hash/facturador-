/**
 * Aritmética monetaria en enteros.
 *
 * Todos los importes se manejan en **centavos** (enteros) y las cantidades en
 * **milésimas** (enteros), de modo que ninguna suma o producto pasa por un float.
 * Esto evita los clásicos 0.1 + 0.2 = 0.30000000000000004 que hacen que ImpTotal
 * no cierre contra ImpNeto + ImpIVA y ARCA rechace el comprobante.
 */

/** Redondeo "half-up" (mitad hacia arriba en valor absoluto) de una división entera. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('division por cero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((n * 2 + d) / (d * 2));
}

/** Convierte un string/number con hasta 2 decimales a centavos enteros. */
export function toCents(value: number | string): number {
  return parseScaled(value, 2);
}

/** Convierte un string/number con hasta 3 decimales a milésimas enteras. */
export function toMilli(value: number | string): number {
  return parseScaled(value, 3);
}

/**
 * Parseo decimal exacto vía string: nunca multiplica un float por una potencia de 10
 * (0.07 * 100 = 7.000000000000001).
 */
export function parseScaled(value: number | string, decimals: number): number {
  const raw = typeof value === 'number' ? formatFloat(value) : value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === '' || raw === '-' || raw === '.') {
    throw new Error(`importe invalido: ${String(value)}`);
  }
  const negative = raw.startsWith('-');
  const [intPart = '0', fracPart = ''] = raw.replace('-', '').split('.');
  // Redondea (half-up) si vienen más decimales de los soportados.
  const kept = fracPart.slice(0, decimals).padEnd(decimals, '0');
  const nextDigit = fracPart.charCodeAt(decimals) - 48;
  let scaled = Number(`${intPart}${kept}`);
  if (nextDigit >= 5 && nextDigit <= 9) scaled += 1;
  if (!Number.isSafeInteger(scaled)) throw new Error(`importe fuera de rango: ${raw}`);
  return negative ? -scaled : scaled;
}

function formatFloat(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`importe invalido: ${value}`);
  // toFixed(6) conserva precisión suficiente y elimina la basura binaria del float.
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/** Centavos -> string "1234.56" con punto decimal, tal como lo espera ARCA. */
export function centsToArca(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${negative ? '-' : ''}${int}.${String(frac).padStart(2, '0')}`;
}

/** Centavos -> "$ 1.234,56" para el PDF y la UI. */
export function centsToDisplay(cents: number, currency = '$'): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const intStr = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${currency} ${intStr},${frac}`;
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
