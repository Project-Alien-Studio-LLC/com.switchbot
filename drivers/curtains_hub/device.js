/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');

class CurtainsHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		// Curtain3 groups are rejected by SwitchBot's legacy API-token command
		// endpoint ("not support device type") but are supported by OAuth.
		this.preferOAuthCommands = true;
		await super.onInit();

		if (this.hasCapability('open_close'))
		{
			this.removeCapability('open_close').catch(this.error);
		}
		if (!this.hasCapability('windowcoverings_closed'))
		{
			this.addCapability('windowcoverings_closed').catch(this.error);
		}
		if (!this.hasCapability('position'))
		{
			this.addCapability('position').catch(this.error);
		}
		if (!this.hasCapability('windowcoverings_state'))
		{
			this.addCapability('windowcoverings_state').catch(this.error);
		}

		this.invertPosition = this.getSetting('invertPosition');
		if (this.invertPosition === null)
		{
			this.invertPosition = false;
		}

		this.motionMode = Number(this.getSetting('motionMode'));
		if (this.motionMode === null)
		{
			this.motionMode = 2;
		}

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }
		this.registerCapabilityListener('windowcoverings_closed', this.onCapabilityopenClose.bind(this));
		this.registerCapabilityListener('windowcoverings_set', this.onCapabilityPosition.bind(this));
		this.registerCapabilityListener('windowcoverings_state', this.onCapabilityState.bind(this));

        const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);
        this.log('CurtainsHubDevice has been initialized');
    }

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('CurtainsHubDevice has been added');
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		if (changedKeys.indexOf('invertPosition') >= 0)
		{
			this.invertPosition = newSettings.invertPosition;
		}

		if (changedKeys.indexOf('motionMode') >= 0)
		{
			this.motionMode = Number(newSettings.motionMode);
		}

		if (changedKeys.indexOf('classType') >= 0)
		{
			this.setClass(newSettings.classType);
		}
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('CurtainsHubDevice was renamed');
	}

	// this method is called when the Homey device switches the device on or off
	async onCapabilityopenClose(value, opts)
	{
		// Homey's boolean is true when closed, while its position capability is
		// expressed as 0 = closed and 1 = open.
		const homeyPosition = value ? 0 : 1;
		return this.runToPos(this.homeyPositionToSwitchBot(homeyPosition), this.motionMode);
	}

	// this method is called when the Homey device has requested a position change ( 0 to 1)
	async onCapabilityPosition(value, opts)
	{
		let mode = this.motionMode;

		if (opts === 'fast')
		{
			mode = 0;
		}
		else if (opts === 'slow')
		{
			mode = 1;
		}

		return this.runToPos(this.homeyPositionToSwitchBot(value), mode);
	}

	async onCapabilityState(value, opts)
	{
		if (this.pollTimer)
		{
			this.homey.clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		if (value === 'idle')
		{
			await this.stop();
			this.pollTimer = this.homey.setTimeout(() => {
				this.getHubDeviceValues().catch(this.error);
			}, 1000);
		}
		else if (value === 'up')
		{
			return this.open();
		}
		else if (value === 'down')
		{
			return this.close();
		}

		return false;
	}

	/* ------------------------------------------------------------------
	 * open()
	 * - Open the curtain
	 *
	 * [Arguments]
	 * - none
	 *
	 * [Return value]
	 * - Promise object
	 *   Nothing will be passed to the `resolve()`.
	 * ---------------------------------------------------------------- */
	open()
	{
		return this._operateCurtain('turnOn', 'default');
	}

	/* ------------------------------------------------------------------
	 * close()
	 * - close the curtain
	 *
	 * [Arguments]
	 * - none
	 *
	 * [Return value]
	 * - Promise object
	 *   Nothing will be passed to the `resolve()`.
	 * ---------------------------------------------------------------- */
	close()
	{
		return this._operateCurtain('turnOff', 'default');
	}

	async stop()
	{
		const result = await this._operateCurtain('pause', 'default');

		// Curtain3 can acknowledge `pause` without stopping. Re-read its state and,
		// when it is still moving, command the freshly reported position instead.
		try
		{
			await this.delay(500);
			const data = await this._getHubDeviceValues();
			if (data && data.moving && Number.isFinite(Number(data.slidePosition)))
			{
				return this.runToPos(Number(data.slidePosition), this.motionMode);
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`Unable to verify Curtain3 pause: ${err.message}`, 1, 'hub');
		}

		return result;
	}

	delay(milliseconds)
	{
		return new Promise((resolve) => this.homey.setTimeout(resolve, milliseconds));
	}

	formatMotionMode(mode)
	{
		if (mode === 'ff' || mode === '0xff' || Number(mode) === 0xff)
		{
			return 'ff';
		}

		const numericMode = Number(mode);
		if (numericMode === 0 || numericMode === 1)
		{
			return String(numericMode);
		}

		return 'ff';
	}

	homeyPositionToSwitchBot(position)
	{
		let homeyPosition = Math.min(1, Math.max(0, Number(position)));
		if (this.invertPosition)
		{
			homeyPosition = 1 - homeyPosition;
		}

		// Homey: 0 = closed, 1 = open. SwitchBot: 0 = open, 100 = closed.
		return Math.round((1 - homeyPosition) * 100);
	}

	switchBotPositionToHomey(position)
	{
		const switchBotPosition = Math.min(100, Math.max(0, Number(position)));
		let homeyPosition = 1 - (switchBotPosition / 100);
		if (this.invertPosition)
		{
			homeyPosition = 1 - homeyPosition;
		}

		return homeyPosition;
	}

	/* ------------------------------------------------------------------
	 * runToPos()
	 * - run to the targe position
	 *
	 * [Arguments]
	 * - percent | number | Required | the percentage of target position
	 *
	 * [Return value]
	 * - Promise object
	 *   Nothing will be passed to the `resolve()`.
	 * ---------------------------------------------------------------- */
	async runToPos(percent, mode = 0xff)
	{
		const switchBotPosition = Math.min(100, Math.max(0, Math.round(Number(percent))));
		return this._operateCurtain('setPosition', `0,${this.formatMotionMode(mode)},${switchBotPosition}`);
	}

	async _operateCurtain(command, parameter)
	{
		this.setCapabilityValue('position', null).catch(this.error);
		const data = {
			command,
			parameter,
			commandType: 'command',
		};

		// Curtain3 groups are paired from the shared SwitchBot account rather
		// than a per-device OAuth session. Resolve that saved account session
		// directly so `HubDevice` cannot fall back to the legacy API-token route,
		// which rejects Curtain3 with "not support device type".
		const oAuth2Client = this.homey.app.getFirstSavedOAuth2Client();
		if (oAuth2Client)
		{
			const dd = this.getData();
			this.homey.app.updateLog(`Sending ${this.homey.app.varToString(data)} to ${dd.id} using shared OAuth`, 3, 'hub');
			const response = await oAuth2Client.setDeviceData(dd.id, data);
			const statusCode = Number.parseInt(response?.statusCode ?? response?.body?.statusCode ?? 100, 10);
			if (statusCode !== 100)
			{
				const message = response?.message ?? response?.body?.message ?? 'Command rejected by SwitchBot';
				throw new Error(`${statusCode}: ${message}`);
			}

			this.homey.app.updateLog(`Success sending command to ${dd.id} using shared OAuth`, 2, 'hub');
			return true;
		}

		return super.setDeviceData(data);
	}

	async pollHubDeviceValues()
	{
		const dd = this.getData();
		if (!dd.type)
		{
			await this.getHubDeviceValues();
			return true;
		}

		return false;
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

				const position = this.switchBotPositionToHomey(data.slidePosition);

				if (position < 0.5)
				{
					this.setCapabilityValue('windowcoverings_closed', true).catch(this.error);
				}
				else
				{
					this.setCapabilityValue('windowcoverings_closed', false).catch(this.error);
				}

				if (position === 1)
				{
					this.setCapabilityValue('windowcoverings_state', 'up').catch(this.error);
				}
				else if (position === 0)
				{
					this.setCapabilityValue('windowcoverings_state', 'down').catch(this.error);
				}
				else
				{
					this.setCapabilityValue('windowcoverings_state', data.moving ? null : 'idle').catch(this.error);
				}

				this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
				this.setCapabilityValue('position', position * 100).catch(this.error);

				if (this.lastPosition)
				{
					if (this.lastPosition !== position)
					{
						this.homey.app.triggerPositionLessThan(this, { lastPosition: this.lastPosition, position }, { lastPosition: this.lastPosition, position }).catch(this.error);
						this.homey.app.triggerPositionGreaterThan(this, { lastPosition: this.lastPosition, position }, { lastPosition: this.lastPosition, position }).catch(this.error);
					}
				}

				this.lastPosition = position;

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
			this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Curtains getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0, 'hub');
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
				if (this.pollTimer)
				{
					this.homey.clearTimeout(this.pollTimer);
					this.pollTimer = null;
				}

				const data = message.context;
				const position = this.switchBotPositionToHomey(data.slidePosition);

				if (position < 0.5)
				{
					this.setCapabilityValue('windowcoverings_closed', true).catch(this.error);
				}
				else
				{
					this.setCapabilityValue('windowcoverings_closed', false).catch(this.error);
				}

				if (this.lastPosition)
				{
					if (this.lastPosition !== position)
					{
						this.homey.app.triggerPositionLessThan(this, { lastPosition: this.lastPosition, position }, { lastPosition: this.lastPosition, position }).catch(this.error);
						this.homey.app.triggerPositionGreaterThan(this, { lastPosition: this.lastPosition, position }, { lastPosition: this.lastPosition, position }).catch(this.error);
					}
				}

				this.setCapabilityValue('windowcoverings_set', position).catch(this.error);
				this.setCapabilityValue('position', position * 100).catch(this.error);

				if (position === 1)
				{
					this.setCapabilityValue('windowcoverings_state', 'up').catch(this.error);
				}
				else if (position === 0)
				{
					this.setCapabilityValue('windowcoverings_state', 'down').catch(this.error);
				}
				else
				{
					this.setCapabilityValue('windowcoverings_state', null).catch(this.error);
					this.pollTimer = this.homey.setTimeout(() => {
						this.getHubDeviceValues().catch(this.error);
					}, 2000);
				}

				this.lastPosition = position;

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

module.exports = CurtainsHubDevice;
