/* jslint node: true */

'use strict';

const HubDriver = require('../hub_driver');

class HubVacuumK11Driver extends HubDriver
{

	/**
	 * onOAuth2Init is called when the driver is initialized.
	 */
	async onOAuth2Init()
	{
		await super.onOAuth2Init();
		this.homey.flow.getActionCard('k11_start_room').registerRunListener((args) => args.device.startRoom(false));
		this.homey.flow.getActionCard('k11_start_scheduled_room').registerRunListener((args) => args.device.startRoom(true));
		this.homey.flow.getActionCard('k11_run_schedule')
			.registerRunListener((args) => args.device.k11Monitor.runSchedule(args))
			.registerArgumentAutocompleteListener('scene', async (query) => this.homey.drivers.getDriver('scene').getDevices()
				.map((scene) => ({ id: scene.getData().id, name: scene.getName() }))
				.filter((scene) => scene.name.toLowerCase().includes(query.toLowerCase())));
		this.homey.flow.getActionCard('k11_schedule_control').registerRunListener((args) => {
			const controls = { pause: ['schedulesPaused', true], resume: ['schedulesPaused', false], skip: ['skipNext', true], unskip: ['skipNext', false] };
			if (!controls[args.control]) throw new Error('Unknown schedule control');
			return args.device.k11Monitor.setScheduleControl(...controls[args.control]);
		});
		this.homey.flow.getActionCard('k11_presence_state').registerRunListener((args) => args.device.k11Monitor.recordPresence(args.presence));

		this.log('HubVacuumK11Driver has been initialized');
	}

	async onPairListDevices({ oAuth2Client })
	{
		return this.getHUBDevices(oAuth2Client, ['Robot Vacuum Cleaner K11 Plus']);
	}

	async triggerStateChanged(device, tokens, state)
	{
		this.homey.app.stateChangedTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerStateChangedTo(device, tokens, state)
	{
		this.homey.app.stateChangedToTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerTaskChanged(device, tokens, state)
	{
		this.homey.app.taskChangedTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerTaskChangedTo(device, tokens, state)
	{
		this.homey.app.taskChangedToTrigger.trigger(device, tokens, state).catch(this.error);
	}

	async triggerCleaningStarted(device)
	{
		this.homey.app.vaccumCleaningStartedTrigger.trigger(device).catch(this.error);
	}

	async triggerCleaningStopped(device)
	{
		this.homey.app.vaccumCleaningStoppedTrigger.trigger(device).catch(this.error);
	}

}

module.exports = HubVacuumK11Driver;
