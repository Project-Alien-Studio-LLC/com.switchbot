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
		if (this.getStoreValue('lockUiRestored_v1')) return;
		try
		{
			const options = this.getCapabilityOptions('locked') || {};
			this.homey.app.updateLog(`Lock Ultra: locked options before restore ${JSON.stringify(options)}`, 0);
			await this.setCapabilityOptions('locked', { ...options, setable: true, uiComponent: 'toggle' });
			// Homey only rebuilds the device view when capabilities change.
			// locked_status keeps no history and no Flow uses it, so re-adding it
			// is a safe way to trigger that rebuild once.
			const status = this.getCapabilityValue('locked_status');
			await this.removeCapability('locked_status');
			await this.addCapability('locked_status');
			if (status !== null) await this.setCapabilityValue('locked_status', status);
			await this.setStoreValue('lockUiRestored_v1', true);
			this.homey.app.updateLog('Lock Ultra: lock state control restored', 0);
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
