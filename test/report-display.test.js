'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatReportTime } = require('../lib/report-display');

test('report tiles show a compact local time across the daylight-saving boundary', () => {
	const homey = { clock: { getTimezone: () => 'America/New_York' } };
	assert.equal(formatReportTime('2026-09-26T12:49:36.950Z', homey), 'Sep 26, 8:49 AM');
	assert.equal(formatReportTime('2026-12-26T12:49:36.950Z', homey), 'Dec 26, 7:49 AM');
});

test('unreported and invalid timestamps remain explicit', () => {
	assert.equal(formatReportTime(null), 'Awaiting report');
	assert.equal(formatReportTime('invalid'), 'Awaiting report');
});
