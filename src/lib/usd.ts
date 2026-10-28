/** `USD 2.00` for whole cents and four decimals for fractions of a cent, so a small spend never reads as zero. */
export function formatUsd(micro: number): string {
  const usd = micro / 1_000_000;
  return `USD ${micro % 10_000 === 0 ? usd.toFixed(2) : usd.toFixed(4)}`;
}
