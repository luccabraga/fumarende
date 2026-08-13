export function formatCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatCentsUSD(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function parseCentsFromInput(value: string): number {
  const normalized = value.replace(',', '.');
  const amount = Number.parseFloat(normalized);
  if (Number.isNaN(amount)) return NaN;
  return Math.round(amount * 100);
}
