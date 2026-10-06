/* jslint node: true */

'use strict';

const LockAdvancedHubDriver = require('../../lib/lock_advanced_hub_driver');

class LockProMatterHubDriver extends LockAdvancedHubDriver
{

	getSupportedLockTypes()
	{
		return ['Smart Lock Pro Wifi'];
	}

}

module.exports = LockProMatterHubDriver;
