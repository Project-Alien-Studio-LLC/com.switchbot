'use strict';

// Keep machine timestamps in diagnostics; capability tiles use Homey's timezone.
function formatReportTime(value, homey)
{
	const date = new Date(value);
	if (value == null || !Number.isFinite(date.getTime())) return 'Awaiting report';
	const timeZone = homey?.clock?.getTimezone?.() || 'UTC';
	try
	{
		return new Intl.DateTimeFormat('en-US', {
			timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
		}).format(date);
	}
	catch (error)
	{
		return new Intl.DateTimeFormat('en-US', {
			timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
		}).format(date);
	}
}

module.exports = { formatReportTime };
