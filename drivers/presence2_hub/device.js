/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');
const { formatReportTime } = require('../../lib/report-display');

class Presence2HubDevice extends HubDevice
{
	formatBatteryBand(value)
	{
		if (!Number.isFinite(value) || value < 0 || value > 100) return 'Unknown';
		if (value === 100) return 'At least 60%';
		if (value === 60) return '20–60%';
		if (value === 20) return '10–20%';
		if (value === 10) return 'Below 10%';
		return `${value}% reported`;
	}

	async ensurePresentationCapabilities()
	{
		for (const capability of ['presence_battery_band', 'presence_last_event'])
		{
			if (!this.hasCapability(capability))
			{
				try
				{
					await this.addCapability(capability);
				}
				catch (err)
				{
					this.homey.app.updateLog(`Presence display ${capability}: ${err.message}`, 0, 'hub');
				}
			}
		}
		if (this.hasCapability('presence_battery_band') && this.getCapabilityValue('presence_battery_band') == null)
		{
			await this.setPresentationCapability('presence_battery_band', this.formatBatteryBand(this.getCapabilityValue('measure_battery')));
		}
		if (this.hasCapability('presence_last_event') && this.getCapabilityValue('presence_last_event') == null)
		{
			await this.setPresentationCapability('presence_last_event', 'No event observed');
		}
	}

	async setPresentationCapability(capability, value)
	{
		try
		{
			if (!this.hasCapability(capability)) await this.addCapability(capability);
			await this.setCapabilityValue(capability, value);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Presence display ${capability}: ${err.message}`, 0, 'hub');
		}
	}

	parsePresenceState(value)
	{
		if (typeof value === 'boolean')
		{
			return value;
		}

		if (value === 0 || value === 1)
		{
			return value !== 0;
		}

		if (typeof value === 'string')
		{
			const text = value.trim().toUpperCase();
			if (['DETECTED', 'OCCUPIED', 'PRESENT', 'TRUE', '1', 'MOTION'].includes(text))
			{
				return true;
			}

			if (['NOT_DETECTED', 'UNOCCUPIED', 'ABSENT', 'FALSE', '0', 'CLEAR', 'NONE'].includes(text))
			{
				return false;
			}
		}

		return null;
	}

	resolvePresenceState(data)
	{
		if (!data || typeof data !== 'object')
		{
			return null;
		}

		const candidateFields = ['detected', 'Detected', 'presence', 'moveDetected', 'motionDetected', 'detectionState', 'occupancy', 'occupancyState'];
		for (const field of candidateFields)
		{
			if (typeof data[field] !== 'undefined')
			{
				const parsed = this.parsePresenceState(data[field]);
				if (parsed !== null)
				{
					return parsed;
				}
			}
		}

		return null;
	}

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();
		if (!this.hasCapability('presence_last_report'))
		{
			await this.addCapability('presence_last_report');
		}
		const previousReport = this.getCapabilityValue('presence_last_report');
		if (typeof previousReport === 'string' && /^\d{4}-/.test(previousReport))
		{
			await this.setCapabilityValue('presence_last_report', formatReportTime(previousReport, this.homey));
		}
		await this.ensurePresentationCapabilities();

		if (!this.hasCapability('measure_luminance'))
		{
			try
			{
				await this.addCapability('measure_luminance');
			}
			catch (err)
			{
				this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
			}
		}

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id, this).catch(this.error);

		this.log('Presence2HubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('Presence2HubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('Presence2HubDevice was renamed');
	}

	async pollHubDeviceValues()
	{
		await this.getHubDeviceValues();
		return true;
	}

	async getHubDeviceValues()
	{
		const webhookRevision = this._webhookRevision || 0;
		this._presenceDiagnostics = this._presenceDiagnostics || {};
		this._presenceDiagnostics.lastPollAttemptAt = new Date().toISOString();
		try
		{
			const data = await this._getHubDeviceValues();
			if (!data || typeof data !== 'object')
			{
				throw new Error('No presence sensor status received');
			}
			this._presenceDiagnostics.lastPollResponseAt = new Date().toISOString();
			this._presenceDiagnostics.lastPolledPresence = this.resolvePresenceState(data);
			await this.queueReport(data, 'poll', webhookRevision);
			if (this.resolvePresenceState(data) === null)
			{
				throw new Error('Presence missing from SwitchBot status; keeping previous occupancy');
			}
		}
		catch (err)
		{
			this._presenceDiagnostics.lastError = err.message;
			this._presenceDiagnostics.lastErrorAt = new Date().toISOString();
			this.homey.app.updateLog(`Presence ${this.getData().id}: ${err.message}`, 0, 'hub');
			await this.setWarning(err.message);
		}
	}

	async processWebhookMessage(message)
	{
		try
		{
			const data = message && message.context;
			if (data && this.getData().id === data.deviceMac)
			{
				this._presenceDiagnostics = this._presenceDiagnostics || {};
				this._presenceDiagnostics.lastWebhookReceivedAt = new Date().toISOString();
				this._presenceDiagnostics.receivedWebhooks = (this._presenceDiagnostics.receivedWebhooks || 0) + 1;
				await this.queueReport(data, 'webhook');
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

	queueReport(data, source, webhookRevision)
	{
		this._presenceDiagnostics = this._presenceDiagnostics || {};
		const diagnostics = this._presenceDiagnostics;
		diagnostics.queuedReports = (diagnostics.queuedReports || 0) + 1;
		// Serialize writes so a slow capability update cannot finish after a newer report.
		this._reportQueue = (this._reportQueue || Promise.resolve())
			.catch(() => undefined)
			.then(async () =>
			{
				diagnostics.lastApplyStartedAt = new Date().toISOString();
				try
				{
					await this.applyReport(data, source, webhookRevision);
					diagnostics.lastApplyError = null;
				}
				catch (err)
				{
					diagnostics.lastApplyError = err.message;
					throw err;
				}
				finally
				{
					diagnostics.lastApplyFinishedAt = new Date().toISOString();
					diagnostics.queuedReports--;
				}
			});
		return this._reportQueue;
	}

	async applyReport(data, source, webhookRevision)
	{
		this._presenceDiagnostics = this._presenceDiagnostics || {};
		const diagnostics = this._presenceDiagnostics;
		const report = {
			receivedAt: new Date().toISOString(),
			source,
			presence: this.resolvePresenceState(data),
			lightLevel: Number.isFinite(data.lightLevel) ? data.lightLevel : null,
			battery: Number.isFinite(data.battery) ? data.battery : null,
			timeOfSample: data.timeOfSample === undefined ? null : data.timeOfSample,
			outcome: 'pending',
		};
		this._recentReports = [...(this._recentReports || []).slice(-11), report];
		if (source === 'poll' && webhookRevision !== (this._webhookRevision || 0))
		{
			report.outcome = 'superseded poll';
			diagnostics.supersededPolls = (diagnostics.supersededPolls || 0) + 1;
			return;
		}

		const presence = this.resolvePresenceState(data);
		const hasLight = Number.isFinite(data.lightLevel) && data.lightLevel >= 0 && data.lightLevel <= 20;
		const hasBattery = Number.isFinite(data.battery) && data.battery >= 0 && data.battery <= 100;
		if (presence === null && !hasLight && !hasBattery)
		{
			report.outcome = 'no valid fields';
			return;
		}

		let sampleTime = null;
		if (source === 'webhook' && data.timeOfSample !== undefined)
		{
			sampleTime = Number(data.timeOfSample);
			if (!Number.isFinite(sampleTime) || sampleTime <= 0)
			{
				report.outcome = 'invalid sample time';
				return;
			}
			// SwitchBot sends milliseconds; accept seconds from older webhook producers.
			if (sampleTime < 100000000000) sampleTime *= 1000;
			if (sampleTime > Date.now() + 60000 || sampleTime <= (this._lastWebhookSampleTime || 0))
			{
				report.outcome = sampleTime > Date.now() + 60000 ? 'future sample' : 'duplicate or older sample';
				diagnostics.ignoredWebhookSamples = (diagnostics.ignoredWebhookSamples || 0) + 1;
				return;
			}
		}

		if (presence !== null) await this.setCapabilityValue('alarm_presence', presence);
		if (hasLight) await this.setCapabilityValue('measure_luminance', data.lightLevel * 5);
		if (hasBattery)
		{
			if (!this.hasCapability('measure_battery')) await this.addCapability('measure_battery');
			await this.setCapabilityValue('measure_battery', data.battery);
			await this.setPresentationCapability('presence_battery_band', this.formatBatteryBand(data.battery));
		}

		const receivedAt = new Date().toISOString();
		if (source === 'webhook')
		{
			this._webhookRevision = (this._webhookRevision || 0) + 1;
			if (sampleTime !== null) this._lastWebhookSampleTime = sampleTime;
			diagnostics.lastWebhookAt = receivedAt;
			diagnostics.webhookReports = (diagnostics.webhookReports || 0) + 1;
			await this.setPresentationCapability('presence_last_event', formatReportTime(receivedAt, this.homey));
		}
		if (presence !== null)
		{
			await this.setCapabilityValue('presence_last_report', formatReportTime(receivedAt, this.homey));
			await this.setAvailable();
			await this.unsetWarning();
			diagnostics.lastPresenceReportAt = receivedAt;
			diagnostics.lastPresenceSource = source;
			diagnostics.lastError = null;
			if (source === 'poll') diagnostics.lastSuccessfulPollAt = receivedAt;
		}
		report.outcome = 'applied';
	}

	getPresenceDiagnostics()
	{
		return {
			id: this.getData().id,
			name: this.getName(),
			presence: this.getCapabilityValue('alarm_presence'),
			...this._presenceDiagnostics,
			recentReports: this._recentReports || [],
		};
	}

}

module.exports = Presence2HubDevice;
