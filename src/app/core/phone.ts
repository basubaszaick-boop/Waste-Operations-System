/** Any Philippine mobile number format -> 09XXXXXXXXX. Returns '' when it is not a mobile number. */
export function normalizePH(input: string | null | undefined): string {
  const d = String(input ?? '').replace(/\D/g, '');
  if (/^639\d{9}$/.test(d)) return '0' + d.slice(2);
  if (/^09\d{9}$/.test(d)) return d;
  if (/^9\d{9}$/.test(d)) return '0' + d;
  return '';
}
