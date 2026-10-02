/* jslint node: true */

'use strict';

const LockAdvancedHubDevice = require('../../lib/lock_advanced_hub_device');

class LockUltraHubDevice extends LockAdvancedHubDevice
{

	async onInit()
	{
		await super.onInit();
		// Devices paired before 2.0.94 still carry the deadbolt button.
		if (this.hasCapability('deadbolt'))
		{
			await this.removeCapability('deadbolt').catch(this.error);
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
