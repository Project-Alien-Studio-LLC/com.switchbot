'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const cumulativeDailyMeter = require('../lib/cumulative-daily-meter');

test('starts without changing the existing daily meter value', () =>
{
	const result = cumulativeDailyMeter({
		dailyKWh: 0.006,
		currentCapabilityValue: 0.006,
	});

	assert.equal(result.value, 0.006);
	assert.deepEqual(result.state, { baseKWh: 0, lastDailyKWh: 0.006 });
});

test('keeps increasing while the daily counter increases', () =>
{
	const result = cumulativeDailyMeter({
		dailyKWh: 0.01,
		previousState: { baseKWh: 0, lastDailyKWh: 0.006 },
	});

	assert.equal(result.value, 0.01);
	assert.deepEqual(result.state, { baseKWh: 0, lastDailyKWh: 0.01 });
});

test('adds the completed day when the raw counter rolls over', () =>
{
	const afterRollover = cumulativeDailyMeter({
		dailyKWh: 0.001,
		previousState: { baseKWh: 0, lastDailyKWh: 0.01 },
	});

	assert.equal(afterRollover.value, 0.011);
	assert.deepEqual(afterRollover.state, { baseKWh: 0.01, lastDailyKWh: 0.001 });

	const later = cumulativeDailyMeter({
		dailyKWh: 0.004,
		previousState: afterRollover.state,
	});
	assert.equal(later.value, 0.014);
});

test('preserves an already cumulative Homey value during migration', () =>
{
	const result = cumulativeDailyMeter({
		dailyKWh: 0.006,
		currentCapabilityValue: 2.5,
	});

	assert.equal(result.value, 2.5);
	assert.deepEqual(result.state, { baseKWh: 2.494, lastDailyKWh: 0.006 });
});

test('ignores tiny counter jitter instead of treating it as a reset', () =>
{
	const result = cumulativeDailyMeter({
		dailyKWh: 0.0099995,
		previousState: { baseKWh: 1, lastDailyKWh: 0.01 },
	});

	assert.equal(result.value, 1.01);
	assert.equal(result.state.baseKWh, 1);
});

test('rejects invalid daily readings', () =>
{
	assert.throws(
		() => cumulativeDailyMeter({ dailyKWh: -1 }),
		/dailyKWh must be a finite, non-negative number/,
	);
	assert.throws(
		() => cumulativeDailyMeter({ dailyKWh: Number.NaN }),
		/dailyKWh must be a finite, non-negative number/,
	);
});
