'use strict';

// Bound a whole read/configuration operation, including an OAuth refresh wait.
// The caller must not use this to retry physical device commands.
module.exports = async function requestDeadline(homey, operation, description, timeoutMs = 15000)
{
	let timer;
	try
	{
		return await Promise.race([
			Promise.resolve().then(operation),
			new Promise((resolve, reject) =>
			{
				timer = homey.setTimeout(() => reject(new Error(`${description} timed out after ${timeoutMs / 1000} seconds`)), timeoutMs);
			}),
		]);
	}
	finally
	{
		if (timer) homey.clearTimeout(timer);
	}
};
