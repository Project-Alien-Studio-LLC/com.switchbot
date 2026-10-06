/* jslint node: true */

'use strict';

const HubDevice = require('../hub_device');
const K11Monitor = require('../../lib/k11-monitor');
const { timeMinutes } = require('../../lib/k11-safety');

class VacuumK11HubDevice extends HubDevice
{
	get requireCommandAcceptance()
	{
		return true;
	}

	async initializeCleaningOptions()
	{
		// These are Homey's next-start selections, not reported robot settings.
		// Updating capability values does not invoke command listeners.
		const defaults = { vaccum_clean_mode: 'sweep', vaccum_fan_level: '1', vaccum_times: '1' };
		for (const [capability, value] of Object.entries(defaults))
		{
			if (this.getCapabilityValue(capability) == null)
			{
				await this.setCapabilityValue(capability, value);
			}
		}

		// Preserve the legacy ID so existing device values and Flows still work.
		const options = this.getCapabilityOptions('vaccum_clean_mode');
		const values = [
			{ id: 'sweep', title: { en: 'Sweep' } },
			{ id: 'sweep_mop', title: { en: 'Mop' } },
		];
		if (JSON.stringify(options.values) !== JSON.stringify(values))
		{
			await this.setCapabilityOptions('vaccum_clean_mode', { ...options, values });
		}
	}

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		await super.onInit();
		await this.initializeCleaningOptions();
		this.k11Monitor = new K11Monitor(this);
		await this.k11Monitor.init();
		this.registerCapabilityListener('k11_schedules_paused', (value) => this.k11Monitor.setScheduleControl('schedulesPaused', value));
		this.registerCapabilityListener('k11_skip_next', (value) => this.k11Monitor.setScheduleControl('skipNext', value));
		await this.pollHubDeviceValues();

		// try
		// {
		// 	await this.getHubDeviceValues();
		// }
		// catch (err)
		// {
		// 	this.setUnavailable(err.message);
		// }

		this.registerCapabilityListener('play', this.onCapabilityPlay.bind(this));
		this.registerCapabilityListener('pause', this.onCapabilityCommand.bind(this, 'pause'));
		this.registerCapabilityListener('robot_vaccum_dock', this.onCapabilityCommand.bind(this, 'dock'));
		this.registerCapabilityListener('volume_set', this.onCapabilitySetVolume.bind(this));
		this.registerCapabilityListener('vaccum_fan_level', this.onCapabilityFanLevel.bind(this));
		this.registerCapabilityListener('vaccum_times', this.onCapabilityTimes.bind(this));
		this.registerCapabilityListener('vaccum_clean_mode', this.onCapabilityCleanMode.bind(this));
		await this.syncWaterLevelCapability();

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log('VacuumK11HubDevice has been initialising');
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log('VacuumK11HubDevice has been added');
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
		timeMinutes(newSettings.k11_quiet_start || '22:00');
		timeMinutes(newSettings.k11_quiet_end || '09:00');
		if (newSettings.k11_schedule_armed && (!newSettings.k11_test_verified || !newSettings.k11_room_verified || !newSettings.k11_room_scene))
		{
			throw new Error('Verify the room scene and supervised physical test before arming a schedule');
		}
		if (changedKeys.includes('k11_room_scene') && oldSettings.k11_room_scene && newSettings.k11_schedule_armed)
		{
			throw new Error('Disarm automatic cleaning before changing the room scene');
		}
	}

	async onOAuth2Uninit()
	{
		if (this.k11Monitor) this.k11Monitor.stop();
		await super.onOAuth2Uninit();
	}

	async startRoom(scheduled = false)
	{
		if (!this.k11Monitor) throw new Error('K11+ monitor is still initializing');
		return this.k11Monitor.startRoom(scheduled);
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log('VacuumK11HubDevice was renamed');
	}

	async onCapabilityPlay(value, opts)
	{
		let fanLevel = this.getCapabilityValue('vaccum_fan_level');
		if (!fanLevel)
		{
			fanLevel = '1';
		}

		let times = this.getCapabilityValue('vaccum_times');
		if (!times)
		{
			times = '1';
		}

		let action = this.getCapabilityValue('vaccum_clean_mode');
		if (!action)
		{
			action = 'sweep';
		}

		return this.startVacuum(action, fanLevel, times);
	}

	async startVacuum(action, fanLevel, timesOrWaterLevel, flowTimes)
	{
		// The shared Flow card supplies (mode, fan, water, cycles), whereas the
		// K11+ Start button supplies (mode, fan, cycles). Water is not part of
		// the K11+ startClean payload, but must not replace the requested cycles.
		const times = flowTimes ?? timesOrWaterLevel;
		// The K11+ API calls its mopping program "mop". Older versions of this
		// driver exposed it as "sweep_mop", so retain existing device values
		// without sending an unsupported action to SwitchBot.
		const normalizedAction = action === 'sweep_mop' ? 'mop' : action;
		const parameter = { action: normalizedAction, param: { fanLevel: parseInt(fanLevel, 10), times: parseInt(times, 10) } };

		const data = {
			command: 'startClean',
			parameter,
			commandType: 'command',
		};

		return this.setDeviceData(data);
	}

	async onCapabilityFanLevel(value, opts)
	{
		return this._operateDevice('changeParam', { fanLevel: parseInt(value, 10) });
	}

	async onCapabilityWaterLevel(value, opts)
	{
		if (!this.isMoppingMode())
		{
			throw new Error('Water level is only available while the K11+ is in mop mode');
		}

		return this._operateDevice('changeParam', { waterLevel: parseInt(value, 10) });
	}

	async onCapabilityTimes(value, opts)
	{
		return this._operateDevice('changeParam', { times: parseInt(value, 10) });
	}

	async onCapabilitySetVolume(value, opts)
	{
		return this._operateDevice('setVolume', parseInt(value * 100, 10));
	}

	async onCapabilityCleanMode(value, opts)
	{
		await this.syncWaterLevelCapability(value);
	}

	isMoppingMode(action = this.getCapabilityValue('vaccum_clean_mode'))
	{
		return ['mop', 'sweep_mop'].includes(action);
	}

	async syncWaterLevelCapability(action)
	{
		if (this.isMoppingMode(action))
		{
			if (!this.hasCapability('vaccum_water_level'))
			{
				await this.addCapability('vaccum_water_level');
			}

			if (!this._waterLevelListenerRegistered)
			{
				this.registerCapabilityListener('vaccum_water_level', this.onCapabilityWaterLevel.bind(this));
				this._waterLevelListenerRegistered = true;
			}

			if (!this.getCapabilityValue('vaccum_water_level'))
			{
				await this.setCapabilityValue('vaccum_water_level', '1');
			}
		}
		else if (this.hasCapability('vaccum_water_level'))
		{
			await this.removeCapability('vaccum_water_level');
		}
	}

	async pollHubDeviceValues()
	{
		const state = this.k11Monitor && this.k11Monitor.state;
		const interval = state && (state.runStartedAt || state.returnStartedAt || state.pendingStartAt || state.status === 'introuble') ? 60000 : 300000;
		// Bound polling even if the shared app poller runs much more frequently.
		if (this._lastPollAttempt && Date.now() - this._lastPollAttempt < interval) return true;
		await this.getHubDeviceValues();
		return true;
	}

	isCleaningState(state)
	{
		if (!state)
		{
			return false;
		}

		const normalizedState = String(state).trim().toLowerCase();
		const translatedClearing = String(this.homey.__('clearing') || '').trim().toLowerCase();
		const translatedCleaning = String(this.homey.__('cleaning') || '').trim().toLowerCase();

		return ['clearing', 'cleaning', translatedClearing, translatedCleaning].includes(normalizedState);
	}

	onVacuumWorkingStatusChanged(previousState, currentRawState, currentTranslatedState)
	{
		const wasCleaning = this.isCleaningState(previousState);
		const isCleaning = this.isCleaningState(currentRawState) || this.isCleaningState(currentTranslatedState);

		if (!wasCleaning && isCleaning)
		{
			this.driver.triggerCleaningStarted(this).catch(this.error);
		}
		else if (wasCleaning && !isCleaning)
		{
			this.driver.triggerCleaningStopped(this).catch(this.error);
		}
	}

	async getHubDeviceValues()
	{
		if (this._statusFlight) return this._statusFlight;
		this._lastPollAttempt = Date.now();
		this._statusFlight = this.fetchK11Status();
		try
		{
			return await this._statusFlight;
		}
		finally
		{
			this._statusFlight = null;
		}
	}

	async fetchK11Status()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				if (this.k11Monitor && !await this.k11Monitor.record(data)) return null;
				this.setAvailable();
				this.homey.app.updateLog(`VacuumK11HubDevicegot: ${this.homey.app.varToString(data)}`, 3, 'hub');

				// Check for working status
				if (data.workingStatus)
				{
					// Make the workingStatus lowercase and then look up the translation
					let workingStatus = this.homey.__(data.workingStatus.toLowerCase());

					// If the translation is not found, use the original value
					if (!workingStatus)
					{
						workingStatus = data.workingStatus;
					}

					const previousState = this.getCapabilityValue('robot_vaccum_state');
					if (workingStatus !== previousState)
					{
						this.setCapabilityValue('robot_vaccum_state', workingStatus).catch(this.error);

						const tokens = {
							state: data.workingStatus,
						};

						this.driver.triggerStateChanged(this, tokens, null).catch(this.error);

						const args = {
							state: data.workingStatus,
						};
						this.driver.triggerStateChangedTo(this, null, args).catch(this.error);
						this.onVacuumWorkingStatusChanged(previousState, data.workingStatus, workingStatus);
					}
				}

				// Check for task
				if (data.taskType)
				{
					// Make the taskType lowercase and then look up the translation
					let taskType = this.homey.__(data.taskType.toLowerCase());

					// If the translation is not found, use the original value
					if (!taskType)
					{
						taskType = data.taskType;
					}

					if (taskType !== this.getCapabilityValue('robot_vaccum_task'))
					{
						this.setCapabilityValue('robot_vaccum_task', taskType).catch(this.error);

						const tokens = {
							task: data.taskType,
						};

						this.driver.triggerTaskChanged(this, tokens, null).catch(this.error);

						const args = {
							task: data.taskType,
						};
						this.driver.triggerTaskChangedTo(this, null, args).catch(this.error);
					}
				}

				// Check for battery
				if (Number.isInteger(data.battery) && data.battery >= 0 && data.battery <= 100)
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
				return data;
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`VacuumK11HubDevice getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0, 'hub');
			this.setWarning(err.message).catch(this.error);
		}
		return null;
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
				if (data)
				{
					if (this.k11Monitor && !await this.k11Monitor.record(data, true)) return;
					// Check for working status
					if (data.workingStatus)
					{
						// Make the workingStatus lowercase and then look up the translation
						let workingStatus = this.homey.__(data.workingStatus.toLowerCase());

						// If the translation is not found, use the original value
						if (!workingStatus)
						{
							workingStatus = data.workingStatus;
						}

						const previousState = this.getCapabilityValue('robot_vaccum_state');
						if (workingStatus !== previousState)
						{
							this.setCapabilityValue('robot_vaccum_state', workingStatus).catch(this.error);

							const tokens = {
								state: data.workingStatus,
							};

							this.driver.triggerStateChanged(this, tokens, null).catch(this.error);

							const args = {
								state: data.workingStatus,
							};
							this.driver.triggerStateChangedTo(this, null, args).catch(this.error);
							this.onVacuumWorkingStatusChanged(previousState, data.workingStatus, workingStatus);
						}
					}

					// Check for task
					if (data.taskType)
					{
						// Make the taskType lowercase and then look up the translation
						let taskType = this.homey.__(data.taskType.toLowerCase());

						// If the translation is not found, use the original value
						if (!taskType)
						{
							taskType = data.taskType;
						}

						if (taskType !== this.getCapabilityValue('robot_vaccum_task'))
						{
							this.setCapabilityValue('robot_vaccum_task', taskType).catch(this.error);

							const tokens = {
								task: data.taskType,
							};

							this.driver.triggerTaskChanged(this, tokens, null).catch(this.error);

							const args = {
								task: data.taskType,
							};
							this.driver.triggerTaskChangedTo(this, null, args).catch(this.error);
						}
					}

					if (Number.isInteger(data.battery) && data.battery >= 0 && data.battery <= 100)
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
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0, 'hub');
		}
	}

}

module.exports = VacuumK11HubDevice;
