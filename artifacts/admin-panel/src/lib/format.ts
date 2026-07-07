export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatDate(dateString: string) {
  const date = /^\d+$/.test(dateString)
    ? new Date(Number(dateString))
    : new Date(dateString);
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}
