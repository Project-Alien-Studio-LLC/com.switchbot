/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class BlindTiltHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		// Blind Tilt devices can expose status through the legacy API but may
		// reject its command endpoint with 190 ("not support device type").
		// Prefer the account OAuth command endpoint for movement commands.
		this.preferOAuthCommands = true;
		await super.onInit();
		await this.addMissingCapabilities();
		this.initializePositionStatus();

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }
		this.registerCapabilityListener('windowcoverings_tilt_set', this.onCapabilityPosition.bind(this));
		this.registerCapabilityListener('windowcoverings_closed', this.onCapabilityClosed.bind(this));
		this.registerCapabilityListener('windowcoverings_tilt_up', this.onCapabilityTiltUp.bind(this));
		this.registerCapabilityListener('windowcoverings_tilt_down', this.onCapabilityTiltDown.bind(this));

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('BlindTiltHubDevice has been initialising');
	}

	async addMissingCapabilities()
	{
		const capabilities = [
			'windowcoverings_closed',
			'windowcoverings_tilt_up',
			'windowcoverings_tilt_down',
			'position',
			'measure_battery',
		];

		for (const capability of capabilities)
		{
			if (!this.hasCapability(capability))
			{
				await this.addCapability(capability);
			}
		}
	}

	initializePositionStatus()
	{
		const storedPosition = this.getCapabilityValue('windowcoverings_tilt_set');
		const numericPosition = Number(storedPosition);
		if (storedPosition !== null && Number.isFinite(numericPosition))
		{
			this.updatePosition(numericPosition);
		}
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('BlindTiltHubDevice has been added');
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('BlindTiltHubDevice was renamed');
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityPosition(value, opts)
	{
		if (value === 0)
		{
			return this._operateCurtain('closeDown', '');
		}
		if (value === 1)
		{
			return this._operateCurtain('closeUp', '');
		}
		if ((value > 0.4) && (value < 0.6))
		{
			return this._operateCurtain('fullyOpen', '');
		}
		if (value >= 0.5)
		{
			return this._operateCurtain('setPosition', `up;${parseInt((1 - value) * 200, 10)}`);
		}
		return this._operateCurtain('setPosition', `down;${parseInt(value * 200, 10)}`);
	}

	async onCapabilityClosed(value, opts)
	{
		if (!value)
		{
			return this._operateCurtain('fullyOpen', '');
		}

		const closePosition = this.getSetting('closePosition');
		return this._operateCurtain(closePosition === 'up' ? 'closeUp' : 'closeDown', '');
	}

	async onCapabilityTiltUp(value, opts)
	{
		return this._operateCurtain('closeUp', '');
	}

	async onCapabilityTiltDown(value, opts)
	{
		return this._operateCurtain('closeDown', '');
	}

	async _operateCurtain(command, parameter)
	{
		const data = {
			command,
			parameter,
			commandType: 'command',
		};

		return super.setDeviceData(data);
	}

	updatePosition(position)
	{
		const numericPosition = Number(position);
		if (!Number.isFinite(numericPosition))
		{
			return;
		}

		const normalizedPosition = Math.min(1, Math.max(0, numericPosition));
		this.setCapabilityValue('windowcoverings_tilt_set', normalizedPosition).catch(this.error);
		this.setCapabilityValue('position', Math.round(normalizedPosition * 100)).catch(this.error);
		this.setCapabilityValue('windowcoverings_closed', normalizedPosition <= 0.01 || normalizedPosition >= 0.99).catch(this.error);

		if (this.lastPosition !== undefined && this.lastPosition !== null && this.lastPosition !== normalizedPosition)
		{
			this.homey.app.triggerPositionLessThan(this, { lastPosition: this.lastPosition, position: normalizedPosition }, { lastPosition: this.lastPosition, position: normalizedPosition }).catch(this.error);
			this.homey.app.triggerPositionGreaterThan(this, { lastPosition: this.lastPosition, position: normalizedPosition }, { lastPosition: this.lastPosition, position: normalizedPosition }).catch(this.error);
		}

		this.lastPosition = normalizedPosition;
	}

	async pollHubDeviceValues()
	{
		await this.getHubDeviceValues();
		return true;
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Curtain Hub got: ${this.homey.app.varToString(data)}`, 3, 'hub');

				this.updatePosition(data.slidePosition / 100);

				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						try
						{
							await this.addCapability('measure_battery');
						}
						catch (err)
						{
							this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
						}
					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}

				this.unsetWarning().catch(this.error);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`BlindTilt getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0, 'hub');
			this.setWarning(err.message).catch(this.error);
		}
	}

	async processWebhookMessage(message)
	{
		try
		{
			const dd = this.getData();
			if (dd.id === message.context.deviceMac)
			{
				// message is for this device
				const data = message.context;
				this.updatePosition(data.slidePosition / 100);

				if (data.battery)
				{
					if (!this.hasCapability('measure_battery'))
					{
						try
						{
							await this.addCapability('measure_battery');
						}
						catch (err)
						{
							this.homey.app.updateLog(this.homey.app.varToString(err), 'hub');
						}
					}

					this.setCapabilityValue('measure_battery', data.battery).catch(this.error);
				}
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

}

module.exports = BlindTiltHubDevice;
