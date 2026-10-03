/* jslint node: true */

'use strict';

const HubDevice = require('../drivers/hub_device');

// Answer Homey's capability call before its fixed 10 second timeout.
const COMMAND_ACK_MS = 8000;

// Reported states that say nothing reliable about the bolt position.
const UNCHANGED_STATES = new Set(['jammed', 'locking', 'unlocking']);

class LockAdvancedHubDevice extends HubDevice
{

	/**
	 * onInit is called when the device is initialized.
	 */
	async onInit()
	{
		this.reportQueue = Promise.resolve();
		this.lastSampleTime = -Infinity;
		await super.onInit();
		// Smart Lock Pro/Ultra commands are authenticated through the current
		// OAuth session. Prefer that path when both OAuth and the legacy API key
		// are configured; the latter can still read status but may reject lock
		// actions for newer locks.
		this.preferOAuthCommands = true;

		if (!this.hasCapability('locked'))
		{
			await this.addCapability('locked');
		}

		this.registerCapabilityListener('lock', this.onCapabilityLock.bind(this));
		this.registerCapabilityListener('unlock', this.onCapabilityUnlock.bind(this));
		this.registerCapabilityListener('locked', this.onCapabilityLocked.bind(this));

		if (this.supportsDeadbolt())
		{
			this.registerCapabilityListener('deadbolt', this.onCapabilityDeadbolt.bind(this));

			if (!this.hasCapability('deadbolt'))
			{
				await this.addCapability('deadbolt');
			}
		}

		if (this.supportsNightLatch())
		{
			this.registerCapabilityListener('nightlatchunlock', this.onCapabilityNightLatchUnlock.bind(this));

			if (!this.hasCapability('nightlatchunlock'))
			{
				await this.addCapability('nightlatchunlock');
			}
		}

		const dd = this.getData();
		this.homey.app.registerHomeyWebhook(dd.id).catch(this.error);

		this.log(`${this.constructor.name} has been initialized`);
	}

	supportsDeadbolt()
	{
		return false;
	}

	supportsNightLatch()
	{
		return false;
	}

	/**
	 * onAdded is called when the user adds the device, called just after pairing.
	 */
	async onAdded()
	{
		this.log(`${this.constructor.name} has been added`);
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name)
	{
		this.log(`${this.constructor.name} was renamed`);
	}

	async onSettings({ oldSettings, newSettings, changedKeys })
	{
		// Called when settings changed
	}

	// this method is called when the Homey device has requested to lock
	async onCapabilityLock(value, opts)
	{
		return this._operateBot('lock');
	}

	// this method is called when the Homey device has requested to unlock
	async onCapabilityUnlock(value, opts)
	{
		return this._operateBot('unlock');
	}

	// Keep the standard Homey lock control functional for existing devices.
	// Some devices retain this capability as writable after an app upgrade.
	async onCapabilityLocked(value, opts)
	{
		return this._operateBot(value ? 'lock' : 'unlock');
	}

	// this method is called when the Homey device has requested to deadbolt
	async onCapabilityDeadbolt(value, opts)
	{
		return this._operateBot('deadbolt');
	}

	// this method is called when the Homey device has requested a night latch unlock
	async onCapabilityNightLatchUnlock(value, opts)
	{
		return this._operateBot('nightLatchUnlock');
	}

	async _operateBot(command)
	{
		const data = {
			command,
			parameter: 'default',
			commandType: 'command',
		};

		// The SwitchBot cloud answers a lock command only after the motor has
		// finished (via the hub's BLE link), which can exceed Homey's 10 second
		// capability timeout even though the lock operates. Acknowledge Homey
		// before that limit, let the command finish in the background, and
		// report a late failure as a device warning. The command is never resent.
		const settled = super.setDeviceData(data).then(
			(result) => ({ ok: true, result }),
			(error) => ({ ok: false, error }),
		);
		let timer;
		const acknowledged = new Promise((resolve) =>
		{
			timer = this.homey.setTimeout(() => resolve(null), COMMAND_ACK_MS);
		});
		const outcome = await Promise.race([settled, acknowledged]);
		this.homey.clearTimeout(timer);

		if (outcome === null)
		{
			this.homey.app.updateLog(`Lock ${command} still running after ${COMMAND_ACK_MS / 1000}s; finishing in background`, 2);
			settled.then((late) =>
			{
				if (late.ok)
				{
					this.unsetWarning().catch(this.error);
					return;
				}
				this.homey.app.updateLog(`Lock ${command} failed after acknowledgement: ${late.error.message}`, 0);
				this.setWarning(`Last ${command} command failed: ${late.error.message}`).catch(this.error);
				this.getHubDeviceValues().catch(this.error);
			});
			return null;
		}

		if (!outcome.ok) throw outcome.error;
		return outcome.result;
	}

	translateLockStatus(lockState)
	{
		const translatedState = lockState ? this.homey.__(lockState) : null;
		return translatedState || lockState;
	}

	toNormalizedState(lockState)
	{
		return String(lockState || '').toLowerCase();
	}

	isDoorOpen(doorState)
	{
		const value = String(doorState || '').toLowerCase();
		return value === 'open' || value === 'opened';
	}

	// Bring `locked` in line with the reported state. This compares against the
	// capability itself rather than the previous status text: two reports
	// handled together could otherwise leave the status "Locked" while `locked`
	// stayed false, with every later report seen as "no change".
	async applyLockState(rawState)
	{
		let locked;
		let trigger;
		if (rawState === 'locked')
		{
			locked = true;
			trigger = 'triggerLocked';
		}
		else if ((rawState === 'latchboltlocked') || (rawState === 'latched'))
		{
			locked = true;
			trigger = 'triggerLatched';
		}
		else if (UNCHANGED_STATES.has(rawState))
		{
			// Jammed or still moving: the bolt position is not known.
			return;
		}
		else
		{
			locked = false;
			trigger = 'triggerUnlocked';
		}

		if (this.getCapabilityValue('locked') === locked) return;
		await this.setCapabilityValue('locked', locked).catch(this.error);
		this.driver[trigger](this, null, null).catch(this.error);
	}

	// Serialise reports from webhooks and polling so they cannot interleave,
	// and drop a webhook sampled before one already applied.
	applyReport({ lockState, doorState, battery, sampleTime = null })
	{
		const run = this.reportQueue.then(async () =>
		{
			if (sampleTime !== null)
			{
				if (sampleTime < this.lastSampleTime)
				{
					this.homey.app.updateLog(`Lock: ignored late report sampled ${sampleTime} (last ${this.lastSampleTime})`, 2);
					return;
				}
				this.lastSampleTime = sampleTime;
			}

			const rawState = this.toNormalizedState(lockState);
			await this.setCapabilityValue('locked_status', this.translateLockStatus(rawState)).catch(this.error);
			await this.setCapabilityValue('alarm_generic', rawState === 'jammed').catch(this.error);
			if (doorState !== undefined)
			{
				await this.setCapabilityValue('alarm_contact', this.isDoorOpen(doorState)).catch(this.error);
			}
			if (battery !== undefined)
			{
				await this.setCapabilityValue('measure_battery', battery).catch(this.error);
			}
			await this.applyLockState(rawState);
		});
		this.reportQueue = run.catch(() => {});
		return run;
	}

	async getHubDeviceValues()
	{
		try
		{
			const data = await this._getHubDeviceValues();
			if (data)
			{
				this.setAvailable();
				this.homey.app.updateLog(`Lock Hub got: ${this.homey.app.varToString(data)}`, 3);
				await this.applyReport({ lockState: data.lockState, doorState: data.doorState, battery: data.battery });
			}

			this.unsetWarning().catch(this.error);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Lock getHubDeviceValues: ${this.homey.app.varToString(err.message)}`, 0);
			this.setWarning(err.message).catch(this.error);
		}
	}

	async pollHubDeviceValues()
	{
		await this.getHubDeviceValues();
		return true;
	}

	async processWebhookMessage(message)
	{
		try
		{
			const dd = this.getData();
			if (dd.id === message.context.deviceMac)
			{
				// message is for this device
				const { lockState, doorState, battery, timeOfSample } = message.context;
				const sampleTime = (timeOfSample == null || !Number.isFinite(Number(timeOfSample))) ? null : Number(timeOfSample);
				await this.applyReport({ lockState, doorState, battery, sampleTime });
			}
		}
		catch (err)
		{
			this.homey.app.updateLog(`processWebhookMessage error ${err.message}`, 0);
		}
	}

}

module.exports = LockAdvancedHubDevice;
