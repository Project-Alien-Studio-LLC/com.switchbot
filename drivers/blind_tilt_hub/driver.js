/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubBlindTiltDriver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		super.onOAuth2Init();

		// Device Triggers
		this.windowcoverings_tilt_set_changed = this.homey.flow.getDeviceTriggerCard('windowcoverings_tilt_set_changed');

		this.log('HubBlindTiltDriver has been initialized');
	}

	async onPairListDevices({ oAuth2Client })
	{
		// SwitchBot reports the group master for a Blind Tilt group as the
		// controllable device, but its `hubDeviceId` can be stale or point at a
		// non-Hub device. Requiring that field makes the group impossible to add
		// to Homey and leaves users with only the unreliable local BLE devices.
		// `getHUBDevices` still selects the master only, so this does not expose
		// the individual group members for duplicate pairing.
		return this.getHUBDevices(oAuth2Client, 'Blind Tilt', false, false);
	}

}

module.exports = HubBlindTiltDriver;
