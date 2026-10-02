/* jslint node: true */

'use strict';

const LockAdvancedHubDevice = require('../../lib/lock_advanced_hub_device');

class LockUltraHubDevice extends LockAdvancedHubDevice
{

	async onInit()
	{
		// Devices paired before 2.0.94 still carry the deadbolt button.
		if (this.hasCapability('deadbolt'))
		{
			try
			{
				await this.removeCapability('deadbolt');
				this.homey.app.updateLog('Lock Ultra: removed unused deadbolt capability', 2);
			}
			catch (err)
			{
				this.homey.app.updateLog(`Lock Ultra: could not remove deadbolt: ${err.message}`, 0);
			}
		}
		await super.onInit();
		await this.showLockStateControl();
	}

	// Devices paired before 2.0.94 stored `uiComponent: null` for `locked`,
	// which app updates do not overwrite; restore the standard lock control.
	async showLockStateControl()
	{
		try
		{
			const options = this.getCapabilityOptions('locked') || {};
			if (options.uiComponent === 'toggle' && options.setable === true) return;
			await this.setCapabilityOptions('locked', { ...options, setable: true, uiComponent: 'toggle' });
			this.homey.app.updateLog('Lock Ultra: lock state control restored', 2);
		}
		catch (err)
		{
			this.homey.app.updateLog(`Lock Ultra: could not restore lock state control: ${err.message}`, 0);
		}
	}

	// The Lock Ultra's standard lock control shows and changes the state, so
	// there is no separate deadbolt action; Lock/Unlock stay for Flows.
	supportsDeadbolt()
	{
		return false;
	}

}

module.exports = LockUltraHubDevice;
