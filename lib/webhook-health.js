'use strict';

function matchingDetails(response, url)
{
	if (!response || response.statusCode !== 100 || !Array.isArray(response.body)) throw new Error('SwitchBot webhook details query failed');
	const details = response.body.find((item) => item && typeof item.url === 'string' && item.url.localeCompare(url, 'en', { sensitivity: 'base' }) === 0);
	if (!details || typeof details.enable !== 'boolean') throw new Error('SwitchBot webhook enabled status missing');
	return details;
}

module.exports = async function ensureWebhookHealth(client, url)
{
	const response = await client.getWebhook();
	if (!response || response.statusCode !== 100 || !response.body || !Array.isArray(response.body.urls)) throw new Error('SwitchBot webhook URL query failed');
	const { urls } = response.body;
	const registered = urls.some((item) => typeof item === 'string' && item.localeCompare(url, 'en', { sensitivity: 'base' }) === 0);
	let created = false;
	if (!registered)
	{
		if (urls.length) throw new Error('Another SwitchBot webhook is configured; keeping its registration');
		const setup = await client.setWebhook(url);
		if (!setup || setup.statusCode !== 100) throw new Error('SwitchBot webhook setup failed');
		created = true;
	}
	let details = matchingDetails(await client.getWebhookDetails(url), url);
	let repaired = false;
	if (!details.enable || details.deviceList !== 'ALL')
	{
		const updated = await client.enableWebhook(url);
		if (!updated || updated.statusCode !== 100) throw new Error('SwitchBot webhook enable failed');
		details = matchingDetails(await client.getWebhookDetails(url), url);
		if (!details.enable || details.deviceList !== 'ALL') throw new Error('SwitchBot webhook enable not confirmed');
		repaired = true;
	}
	return { enabled: details.enable, deviceList: details.deviceList, created, repaired };
};
