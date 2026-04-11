export const STREAM_RATE_PER_HOUR_USD = 0.5
export const SWTD_USD_PRICE = 0.00000536288
export const CHARGE_BLOCK_MINUTES = 30

export function getUsdFromMinutes(minutes: number) {
  return (minutes / 60) * STREAM_RATE_PER_HOUR_USD
}

export function getSwtdFromUsd(usd: number) {
  return usd / SWTD_USD_PRICE
}

export function getMinutesFromSwtd(swtdAmount: number) {
  return ((swtdAmount * SWTD_USD_PRICE) / STREAM_RATE_PER_HOUR_USD) * 60
}

export function floorToChargeableMinutes(minutes: number) {
  return Math.floor(minutes / CHARGE_BLOCK_MINUTES) * CHARGE_BLOCK_MINUTES
}

export function getSwtdCoverage(swtdBalance: number) {
  const safeSwtdBalance = Number.isFinite(swtdBalance) ? Math.max(0, swtdBalance) : 0
  const exactMinutes = getMinutesFromSwtd(safeSwtdBalance)
  const chargeableMinutes = floorToChargeableMinutes(exactMinutes)

  return {
    swtdBalance: safeSwtdBalance,
    approvalUsd: safeSwtdBalance * SWTD_USD_PRICE,
    exactMinutes,
    chargeableMinutes,
    chargeableUsd: getUsdFromMinutes(chargeableMinutes),
    blockMinutes: CHARGE_BLOCK_MINUTES,
  }
}
