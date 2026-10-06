/* jslint node: true */

'use strict';

const LockAdvancedHubDevice = require('../../lib/lock_advanced_hub_device');

class LockProMatterHubDevice extends LockAdvancedHubDevice
{

	supportsDeadbolt()
	{
		return true;
	}

	supportsNightLatch()
	{
		return true;
	}

}

module.exports = LockProMatterHubDevice;
