export function formatMinor(amount: number, currency = "usd"): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase()
  }).format(amount / 100);
}

export function calculateHourlyCharge(pricePerHour: number, hours = 1): number {
  return Math.max(0, Math.round(pricePerHour * hours));
}
