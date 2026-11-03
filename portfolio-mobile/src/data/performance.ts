import type { Transaction } from '../hooks/use-positions';

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

export function weightedAnnualReturn(
  transactions: Transaction[],
  terminalValue: number,
  terminalDate = new Date().toISOString().slice(0, 10),
) {
  if (!transactions.length) return null;
  const startTime = Math.min(...transactions.map((transaction) =>
    new Date(`${transaction.date}T00:00:00.000Z`).getTime()));
  const endTime = new Date(`${terminalDate}T00:00:00.000Z`).getTime();
  if (endTime <= startTime) return null;

  const cashFlows = transactions.map((transaction) => ({
    time: new Date(`${transaction.date}T00:00:00.000Z`).getTime(),
    amount: (transaction.type === 'BUY' ? -1 : 1) *
      transaction.shares * transaction.price * transaction.fxToEur,
  }));
  cashFlows.push({ time: endTime, amount: terminalValue });
  if (!cashFlows.some((flow) => flow.amount < 0) || !cashFlows.some((flow) => flow.amount > 0)) return null;

  const valueAt = (rate: number) => cashFlows.reduce((sum, flow) => {
    const years = (flow.time - startTime) / YEAR_MS;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
  const totalFlows = cashFlows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  let low = -0.9999;
  let high = 1;
  let lowValue = valueAt(low);
  let highValue = valueAt(high);
  while (lowValue * highValue > 0 && high < 1000) {
    high = high * 2 + 1;
    highValue = valueAt(high);
  }
  if (lowValue * highValue > 0) return null;
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = valueAt(middle);
    if (Math.abs(middleValue) <= Math.max(1, totalFlows) * 1e-10) return middle * 100;
    if (lowValue * middleValue <= 0) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return ((low + high) / 2) * 100;
}
