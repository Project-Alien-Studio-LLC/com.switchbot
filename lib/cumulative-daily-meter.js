'use strict';

const ROLLOVER_EPSILON_KWH = 0.000001;

function asNonNegativeNumber(value, label)
{
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0)
	{
		throw new TypeError(`${label} must be a finite, non-negative number`);
	}

	return number;
}

function normalizeState(state)
{
	if (!state || typeof state !== 'object')
	{
		return null;
	}

	const baseKWh = Number(state.baseKWh);
	const lastDailyKWh = Number(state.lastDailyKWh);
	if (!Number.isFinite(baseKWh) || baseKWh < 0 || !Number.isFinite(lastDailyKWh) || lastDailyKWh < 0)
	{
		return null;
	}

	return { baseKWh, lastDailyKWh };
}

/**
 * Convert a meter that resets its kWh value daily into the monotonic cumulative
 * value expected by Homey's meter_power capability.
 *
 * @param {object} options options
 * @param {number} options.dailyKWh current daily counter in kWh
 * @param {object|null} options.previousState persisted conversion state
 * @param {number|null} options.currentCapabilityValue current Homey meter value
 * @returns {{ value: number, state: { baseKWh: number, lastDailyKWh: number } }}
 */
function cumulativeDailyMeter({ dailyKWh, previousState = null, currentCapabilityValue = null })
{
	const rawKWh = asNonNegativeNumber(dailyKWh, 'dailyKWh');
	const state = normalizeState(previousState);

	let baseKWh;
	let effectiveDailyKWh = rawKWh;
	if (state)
	{
		baseKWh = state.baseKWh;
		if (rawKWh < (state.lastDailyKWh - ROLLOVER_EPSILON_KWH))
		{
			baseKWh += state.lastDailyKWh;
		}
		else if (rawKWh < state.lastDailyKWh)
		{
			effectiveDailyKWh = state.lastDailyKWh;
		}
	}
	else
	{
		const currentValue = Number(currentCapabilityValue);
		baseKWh = Number.isFinite(currentValue) && currentValue >= rawKWh
			? currentValue - rawKWh
			: 0;
	}

	const value = Number((baseKWh + effectiveDailyKWh).toFixed(6));
	return {
		value,
		state: {
			baseKWh: Number(baseKWh.toFixed(6)),
			lastDailyKWh: effectiveDailyKWh,
		},
	};
}

module.exports = cumulativeDailyMeter;
