/* jslint node: true */

'use strict';

module.exports = {
	async getPresenceDiagnostics({ homey })
	{
		const devices = [];
		for (const driver of Object.values(homey.drivers.getDrivers()))
		{
			for (const device of Object.values(driver.getDevices()))
			{
				if (typeof device.getPresenceDiagnostics === 'function') devices.push(device.getPresenceDiagnostics());
			}
		}
		return { generatedAt: new Date().toISOString(), polling: homey.app.hubPollingStatus || null, devices };
	},
	async getLog({ homey, query })
	{
		return homey.app.diagLog;
	},
	async getLogFilterOptions({ homey, query })
	{
		return homey.app.getLogFilterOptions();
	},
	async getDetect({ homey, query })
	{
		try
		{
			homey.app.detectedDevices = homey.app.varToString(await homey.app.getHUBDevices());
		}
		catch (err)
		{
			if (!homey.app.detectedDevices)
			{
				homey.app.detectedDevices = err.message;
			}
		}
		return homey.app.detectedDevices;
	},
	async getBLEStatistics({ homey, query })
	{
		return homey.app.getBLEStatistics();
	},
	async clearBLEStatistics({ homey, query })
	{
		homey.app.clearBLEStatistics(true);
		return 'OK';
	},
	async getDetectedBLEDevices({ homey, query })
	{
		if (homey.app.isBLEInitialising())
		{
			return { initialising: true, devices: [] };
		}

		return { initialising: false, devices: await homey.app.getDetectedBLEDevices() };
	},
	async getAllDetectedBLEDevices({ homey, query })
	{
		return homey.app.getAllDetectedBLEDevices();
	},
	async getBLEAdvertisementSettings({ homey, query })
	{
		return homey.app.getBLEAdvertisementSettings();
	},
	async clearAllDetectedBLEDevices({ homey, query })
	{
		homey.app.clearAllDetectedBLEDevices();
		return 'OK';
	},
	async GetDriverSupportMatrix({ homey, body })
	{
		return homey.app.getDriverSupportMatrix((body && body.mode) || 'hub');
	},
	async SendUnsupportedDevices({ homey, body })
	{
		return homey.app.sendUnsupportedDevices(body && body.unsupportedDevices);
	},
	async clearLog({ homey, query })
	{
		homey.app.diagLog = '';
		return 'OK';
	},
	async SendDeviceLog({ homey, query })
	{
		return homey.app.sendLog('deviceLog');
	},
	async SendInfoLog({ homey, query })
	{
		return homey.app.sendLog('infoLog');
	},
	async SendStatusLog({ homey, query })
	{
		return homey.app.sendLog('statusLog');
	},
	async clearStatusLog({ homey, query })
	{
		homey.app.deviceStatusLog = '';
		return 'OK';
	},
	async newData({ homey, body })
	{
		if (homey.app.BLEHub)
		{
			homey.app.BLEHub.newBLEHubData(body);
		}
		return 'OK';
	},
	async requestDeviceStatus({ homey, query })
	{
		const retval = await homey.app.getDeviceStatus(query.deviceId);
		const data = JSON.stringify(retval, null, 2);
		homey.app.deviceStatusLog += data;
		return homey.app.deviceStatusLog;
	},
	async checkOAuthStatus({ homey, query })
	{
		try
		{
			const savedSessions = homey.app.getSavedOAuth2Sessions();
			// getSavedOAuth2Sessions returns an object of sessions by sessionId
			const hasSession = savedSessions && Object.keys(savedSessions).length > 0;
			return {
				hasOAuthSession: hasSession,
			};
		}
		catch (err)
		{
			return {
				hasOAuthSession: false,
			};
		}
	},
	async startOAuth2Flow({ homey, query })
	{
		try
		{
			const { authUrl, flowId } = await homey.app.startSettingsOAuthLogin();
			return {
				authUrl,
				flowId,
				success: true,
			};
		}
		catch (err)
		{
			return {
				success: false,
				error: err.message,
			};
		}
	},
};
