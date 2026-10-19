/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class RelayHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		// Relay Switch 1PM devices can expose status through the legacy API but
		// may reject its command endpoint with 190 ("not support device type").
		// Prefer the account OAuth command endpoint, which supports the relay.
		this.preferOAuthCommands = true;
		// A successful cached status GET does not turn a rejected command into
		// success. In particular, 161 must never be retried or acknowledged.
		this.requireCommandAcceptance = true;
		this.initialised = false;
		await super.onInit();

		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		if (dd.type === 'Relay Switch 1')
		{
			if (this.hasCapability('measure_voltage'))
			{
				this.removeCapability('measure_voltage').catch(this.error);
			}
			if (this.hasCapability('measure_power'))
			{
				this.removeCapability('measure_power').catch(this.error);
			}
			if (this.hasCapability('measure_current'))
			{
				this.removeCapability('measure_current').catch(this.error);
			}
			if (this.hasCapability('meter_power'))
			{
				this.removeCapability('meter_power').catch(this.error);
			}
		}

		this.initialised = true;

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }

		this.log('RelayHubDevice has been initialized');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('RelayHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('RelayHubDevice was renamed');
	}

	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		// Called when settings changed
		if ((changedKeys.indexOf('classType') >= 0) && (oldSettings.classType !== newSettings.classType))
		{
			this.setClass(oldSettings.classType);
		}
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityOnOff(value, opts)
	{
		if (!value)
		{
			return this._operateBot('turnOff');
		}

		return this._operateBot('turnOn');
	}

	async _operateBot(command)
	{
		const data = {
			command,
			parameter: 'default',
			commandType: 'command',
		};

		try
		{
			const accepted = await super.setDeviceData(data);
			if (!accepted) throw new Error('Relay command acceptance is unknown');
			const report = await this._getHubDeviceValues();
			const observed = this.parseSwitchStatus(report && report.switchStatus);
			if (observed !== (command === 'turnOn')) throw new Error('Relay command accepted but requested state is not verified');
			await this.setCapabilityValue('onoff', observed);
			this._relayCommandUnverified = false;
			await this.unsetWarning();
			return accepted;
		}
		catch (err)
		{
			this._relayCommandUnverified = true;
			await this.setWarning('Relay command failed or state unverified; no automatic retry').catch(this.error);
			throw err;
		}
	}

	parseSwitchStatus(value)
	{
		if (value === 0) return false;
		if (value === 1) return true;
		throw new Error('Relay status is missing or invalid; previous state retained');
	}

	async pollHubDeviceValues()
	{
		await this.getHubDeviceValues();
		return true;
	}

	async getHubDeviceValues()
	{
		if (!this.initialised)
		{
			return;
		}

		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				const observed = this.parseSwitchStatus(data.switchStatus);
				this.setAvailable();
				this.homey.app.updateLog(`Relay Hub got: ${this.homey.app.varToString(data)}`, 3, 'hub', 'hub');

				await this.setCapabilityValue('onoff', observed);
				if (this.hasCapability('measure_voltage'))
				{
					this.setCapabilityValue('measure_voltage', data.voltage).catch(this.error);
					this.setCapabilityValue('measure_power', data.power).catch(this.error);
					// Relay Switch 1PM reports electricCurrent in mA; measure_current expects Amps.
					this.setCapabilityValue('measure_current', data.electricCurrent / 1000).catch(this.error);
					// SwitchBot resets usedElectricity daily. Convert it to the monotonic
					// cumulative kWh value required by Homey's meter_power capability.
					await this.setDailyEnergyMeterValue('meter_power', data.usedElectricity);
				}
			}
			if (!this._relayCommandUnverified) this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Bot getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0, 'hub', 'hub');
			this.setWarning(err.message).catch(this.error);
		}
	}

	async processWebhookMessage(message)
	{
		if (!this.initialised)
		{
			return;
		}

		try
		{
			const dd = this.getData();
			if (dd.id === message.context.deviceMac)
			{
				// message is for this device
				const data = message.context;
				this.homey.app.updateLog(`processWebhookMessage: ${this.homey.app.varToString(data)}`, 3, 'hub', 'hub');
				await this.setCapabilityValue('onoff', this.parseSwitchStatus(data.switchStatus));
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub', 'hub');
		}
	}

}

module.exports = RelayHubDevice;
