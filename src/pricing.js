const { pool } = require('./db');

const DEFAULT_PRICING_CONFIG = {
  version: 1,
  currency: 'cad',
  location_fallback: 'default',
  base_rates: {
    default: { basic: 2000, curriculum: 2300 },
    AB: { basic: 2000, curriculum: 2300 },
    BC: { basic: 2100, curriculum: 2400 },
    MB: { basic: 2000, curriculum: 2300 },
    NB: { basic: 2000, curriculum: 2300 },
    NL: { basic: 2000, curriculum: 2300 },
    NS: { basic: 2100, curriculum: 2400 },
    NT: { basic: 2100, curriculum: 2400 },
    NU: { basic: 2100, curriculum: 2400 },
    ON: { basic: 2200, curriculum: 2500 },
    PE: { basic: 2000, curriculum: 2300 },
    QC: { basic: 2100, curriculum: 2400 },
    SK: { basic: 2000, curriculum: 2300 },
    YT: { basic: 2100, curriculum: 2400 }
  },
  age_brackets: [
    { id: '0-1', min: 0, max: 1, multiplier: 1.2 },
    { id: '2-4', min: 2, max: 4, multiplier: 1.1 },
    { id: '5-12', min: 5, max: 12, multiplier: 1.0 },
    { id: '13-17', min: 13, max: 17, multiplier: 1.0 }
  ],
  time_of_day: [
    { id: 'early', label: 'Early morning', start: '06:00', end: '08:59', multiplier: 1.1 },
    { id: 'day', label: 'Daytime', start: '09:00', end: '16:59', multiplier: 1.0 },
    { id: 'evening', label: 'Evening', start: '17:00', end: '20:59', multiplier: 1.15 },
    { id: 'late', label: 'Late night', start: '21:00', end: '23:59', multiplier: 1.25 }
  ],
  premium_discount_percent: 10,
  fees: {
    provider_share_percent: 75,
    platform_fee_percent: 25,
    stripe_percent: 2.9,
    stripe_fixed_cents: 30
  },
  tax_rates: {
    AB: 5,
    BC: 12,
    MB: 12,
    NB: 15,
    NL: 15,
    NS: 15,
    NT: 5,
    NU: 5,
    ON: 13,
    PE: 15,
    QC: 14.975,
    SK: 11,
    YT: 5
  },
  tax_applies_to: 'platform_fee'
};

function clampNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampPercent(value, fallback) {
  const num = clampNumber(value, fallback);
  if(!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, 0), 100);
}

function toUpper(value) {
  return value ? String(value).trim().toUpperCase() : '';
}

function normalizeCareType(value, config) {
  const careType = String(value || '').trim().toLowerCase();
  const options = Object.keys(config?.base_rates?.default || {});
  if(options.includes(careType)) return careType;
  return options[0] || 'basic';
}

function parseTimeToMinutes(value) {
  if(!value || typeof value !== 'string') return null;
  const parts = value.split(':').map(Number);
  if(parts.length < 2) return null;
  const [hour, minute] = parts;
  if(!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour * 60) + minute;
}

function getAgeMultiplier(age, config) {
  const ageNum = clampNumber(age, null);
  if(!Number.isFinite(ageNum)) return { multiplier: 1, bracket: null };
  const brackets = Array.isArray(config?.age_brackets) ? config.age_brackets : [];
  const match = brackets.find(b => ageNum >= b.min && ageNum <= b.max);
  if(!match) return { multiplier: 1, bracket: null };
  return { multiplier: clampNumber(match.multiplier, 1), bracket: match.id || null };
}

function getTimeMultiplier(startAt, config) {
  if(!startAt) return { multiplier: 1, band: null };
  const date = new Date(startAt);
  if(Number.isNaN(date.getTime())) return { multiplier: 1, band: null };
  const minutes = date.getHours() * 60 + date.getMinutes();
  const bands = Array.isArray(config?.time_of_day) ? config.time_of_day : [];
  for(const band of bands) {
    const start = parseTimeToMinutes(band.start);
    const end = parseTimeToMinutes(band.end);
    if(start === null || end === null) continue;
    const crossesMidnight = start > end;
    const match = crossesMidnight
      ? minutes >= start || minutes <= end
      : minutes >= start && minutes <= end;
    if(match) {
      return { multiplier: clampNumber(band.multiplier, 1), band: band.id || band.label || null };
    }
  }
  return { multiplier: 1, band: null };
}

function computeHours(startAt, endAt, overrideHours) {
  const override = clampNumber(overrideHours, null);
  if(Number.isFinite(override)) return Math.max(0.25, override);
  if(!startAt || !endAt) return 1;
  const start = new Date(startAt);
  const end = new Date(endAt);
  const diffMs = end - start;
  if(!Number.isFinite(diffMs) || diffMs <= 0) return 1;
  const hours = diffMs / 36e5;
  return Math.max(0.25, Math.round(hours * 100) / 100);
}

function resolveBaseRateCents(province, careType, config) {
  const locationKey = toUpper(province) || toUpper(config?.location_fallback) || 'DEFAULT';
  const fallbackKey = toUpper(config?.location_fallback) || 'DEFAULT';
  const ratesMap = config?.base_rates || {};
  const locationRates = ratesMap[locationKey] || ratesMap[fallbackKey] || ratesMap.default || {};
  const careKey = normalizeCareType(careType, config);
  const base = locationRates[careKey];
  if(Number.isFinite(Number(base))) return Math.round(Number(base));
  const defaultRates = ratesMap.default || {};
  if(Number.isFinite(Number(defaultRates[careKey]))) return Math.round(Number(defaultRates[careKey]));
  if(Number.isFinite(Number(defaultRates.basic))) return Math.round(Number(defaultRates.basic));
  return 2000;
}

function calculatePricing(factors = {}, config = DEFAULT_PRICING_CONFIG) {
  const careType = normalizeCareType(factors.care_type, config);
  const province = toUpper(factors.province);
  const baseRateCents = resolveBaseRateCents(province, careType, config);
  const ageInfo = getAgeMultiplier(factors.age, config);
  const timeInfo = getTimeMultiplier(factors.start_at, config);
  const premiumDiscount = clampPercent(config?.premium_discount_percent, 0);
  const isPremium = !!factors.is_premium;

  const rateAfterAge = baseRateCents * ageInfo.multiplier;
  const rateAfterTime = rateAfterAge * timeInfo.multiplier;
  const discountCents = isPremium ? (rateAfterTime * premiumDiscount / 100) : 0;
  const hourlyRateCents = Math.max(0, Math.round(rateAfterTime - discountCents));

  const platformPercent = clampPercent(config?.fees?.platform_fee_percent, null);
  const providerPercent = clampPercent(config?.fees?.provider_share_percent, null);
  let platformFeeCents = 0;
  let providerFeeCents = 0;
  if(Number.isFinite(platformPercent)) {
    platformFeeCents = Math.round(hourlyRateCents * platformPercent / 100);
    providerFeeCents = hourlyRateCents - platformFeeCents;
  } else if(Number.isFinite(providerPercent)) {
    providerFeeCents = Math.round(hourlyRateCents * providerPercent / 100);
    platformFeeCents = hourlyRateCents - providerFeeCents;
  } else {
    providerFeeCents = Math.round(hourlyRateCents * 0.75);
    platformFeeCents = hourlyRateCents - providerFeeCents;
  }

  const taxRate = clampNumber(config?.tax_rates?.[province], 0);
  const taxBase = config?.tax_applies_to === 'total' ? hourlyRateCents : platformFeeCents;
  const taxCents = Math.round(taxBase * taxRate / 100);
  const totalHourlyCents = hourlyRateCents + taxCents;

  const hours = computeHours(factors.start_at, factors.end_at, factors.hours);
  const totalBookingCents = Math.round(totalHourlyCents * hours);

  const stripePercent = clampPercent(config?.fees?.stripe_percent, 2.9);
  const stripeFixedCents = Math.round(clampNumber(config?.fees?.stripe_fixed_cents, 30));
  const stripeFeeCents = Math.round(totalBookingCents * stripePercent / 100) + stripeFixedCents;
  const stripeFeePerHourCents = Math.round(stripeFeeCents / (hours || 1));

  return {
    currency: config.currency || 'cad',
    base_rate_cents: baseRateCents,
    care_type: careType,
    age_bracket: ageInfo.bracket,
    age_multiplier: ageInfo.multiplier,
    time_band: timeInfo.band,
    time_multiplier: timeInfo.multiplier,
    premium_discount_percent: premiumDiscount,
    premium_discount_cents: Math.round(discountCents),
    hourly_rate_cents: hourlyRateCents,
    provider_fee_cents: providerFeeCents,
    platform_fee_cents: platformFeeCents,
    tax_rate_percent: taxRate,
    tax_cents: taxCents,
    total_hourly_cents: totalHourlyCents,
    hours,
    total_booking_cents: totalBookingCents,
    stripe_fee_cents: stripeFeeCents,
    stripe_fee_per_hour_cents: stripeFeePerHourCents,
    factors: {
      age: clampNumber(factors.age, null),
      is_premium: isPremium,
      province: province || null,
      care_type: careType
    },
    config_version: config.version || 1
  };
}

async function getPricingConfig() {
  if(!pool) return DEFAULT_PRICING_CONFIG;
  try{
    const { rows } = await pool.query('SELECT config FROM pricing_config WHERE id=1');
    if(rows[0]?.config) return rows[0].config;
    await pool.query('INSERT INTO pricing_config(id, config) VALUES(1, $1)', [DEFAULT_PRICING_CONFIG]);
    return DEFAULT_PRICING_CONFIG;
  }catch(err){
    console.error('[Pricing] load failed:', err.message);
    return DEFAULT_PRICING_CONFIG;
  }
}

async function updatePricingConfig(config) {
  if(!pool) return DEFAULT_PRICING_CONFIG;
  try{
    const normalized = config && typeof config === 'object' ? config : DEFAULT_PRICING_CONFIG;
    await pool.query(
      'INSERT INTO pricing_config(id, config, updated_at) VALUES(1, $1, NOW()) ON CONFLICT (id) DO UPDATE SET config=EXCLUDED.config, updated_at=NOW()',
      [normalized]
    );
    return normalized;
  }catch(err){
    console.error('[Pricing] update failed:', err.message);
    return DEFAULT_PRICING_CONFIG;
  }
}

module.exports = {
  DEFAULT_PRICING_CONFIG,
  calculatePricing,
  getPricingConfig,
  updatePricingConfig
};
