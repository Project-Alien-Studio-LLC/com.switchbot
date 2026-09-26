'use strict';

const safety = require('./k11-safety');
const schedule = require('./k11-schedule');
const { formatReportTime } = require('./report-display');

class K11Monitor
{
	constructor(device)
	{
		this.device = device;
		this.state = device.getStoreValue('k11_safety_v1') || {};
		this.queue = Promise.resolve();
		this.scheduleTimeoutMs = 20000;
	}

	async init()
	{
		for (const capability of ['k11_last_seen', 'measure_k11_status_age', 'k11_monitor_status', 'k11_presence_guard', 'k11_schedules_paused', 'k11_skip_next', 'k11_last_run'])
		{
			if (!this.device.hasCapability(capability)) await this.device.addCapability(capability);
		}
		await this.tick();
		this.timer = this.device.homey.setInterval(() => {
			this.tick().catch(this.device.error);
			this.device.pollHubDeviceValues().catch(this.device.error);
		}, safety.MINUTE);
	}

	stop()
	{
		if (this.timer) this.device.homey.clearInterval(this.timer);
	}

	serialize(callback)
	{
		const next = this.queue.then(callback);
		this.queue = next.catch(() => {});
		return next;
	}

	async record(data, webhook = false)
	{
		return this.serialize(async () => {
			const state = safety.sample(this.state, data, Date.now(), webhook);
			if (!state) return false;
			this.state = state;
			await this.observeSchedule();
			await this.publish();
			return true;
		});
	}

	tick()
	{
		return this.serialize(() => this.publish());
	}

	async publish()
	{
		const { device } = this;
		const now = Date.now();
		const { state, alerts } = safety.evaluate(this.state, now);
		this.state = state;
		if (alerts.some((alert) => alert.reason === 'start'))
		{
			const run = (state.scheduleRuns || []).find((item) => item.id === state.activeScheduleRunId);
			if (run && run.stage === 'requested')
			{
				await this.scheduleEvent(run, 'unconfirmed', 'No cleaning report within two minutes; no automatic retry');
				this.state.pendingStartAt = null;
			}
		}
		// Persist dedup before delivery: restarting cannot repeatedly send an incident.
		await device.setStoreValue('k11_safety_v1', this.state);
		const age = state.lastSeenAt ? Math.max(0, Math.floor((now - state.lastSeenAt) / safety.MINUTE)) : null;
		const pending = Object.keys(state.notified || {}).filter((reason) => Number.isFinite(state.notified[reason]));
		let status = 'Monitoring — no problem reported';
		if (state.online === 'offline') status = 'Reported offline';
		if (age > 5) status = 'Status stale — current state unknown';
		if (age == null) status = 'Waiting for first valid status';
		if (pending.length) status = `Needs attention: ${pending.join(', ')}`;
		await device.setCapabilityValue('k11_last_seen', formatReportTime(state.lastSeenAt || null, device.homey));
		if (age != null) await device.setCapabilityValue('measure_k11_status_age', age);
		await device.setCapabilityValue('k11_monitor_status', status);
		await this.publishScheduleControls();
		for (const alert of alerts)
		{
			await device.homey.flow.getDeviceTriggerCard('k11_attention').trigger(device, alert).catch(device.error);
		}
	}

	async commit(state)
	{
		await this.device.setStoreValue('k11_safety_v1', state);
		this.state = state;
	}

	async bounded(promise)
	{
		let timer;
		try
		{
			return await Promise.race([promise, new Promise((resolve, reject) => {
				timer = setTimeout(() => reject(new Error('Request timed out')), this.scheduleTimeoutMs);
			})]);
		}
		finally { clearTimeout(timer); }
	}

	async publishScheduleControls()
	{
		await this.device.setCapabilityValue('k11_schedules_paused', this.state.schedulesPaused === true);
		await this.device.setCapabilityValue('k11_skip_next', this.state.skipNext === true);
		const now = Date.now();
		let presence = 'Unknown — away-only cleans blocked; 05:00 Quiet allowed';
		if (this.state.presence === 'home') presence = 'Home — 05:00 Quiet allowed; other schedules blocked';
		else if (this.state.presence === 'away' && Number.isFinite(this.state.awaySince) && this.state.awaySince <= now)
		{
			const minutes = Math.floor((now - this.state.awaySince) / safety.MINUTE);
			presence = minutes >= schedule.MINIMUM_AWAY_MINUTES
				? `Away ${minutes} min — eligible`
				: `Away ${minutes} min — other schedules wait for ${schedule.MINIMUM_AWAY_MINUTES}; 05:00 Quiet allowed`;
		}
		if (!this.device.getSettings().k11_morning_scene) presence = presence.replace('05:00 Quiet allowed', '05:00 Quiet scene not configured');
		await this.device.setCapabilityValue('k11_presence_guard', presence);
		const run = this.state.lastScheduleEvent;
		await this.device.setCapabilityValue('k11_last_run', run ? `${run.schedule}: ${run.stage} — ${run.message}` : 'No scheduled run recorded');
	}

	recordPresence(presence)
	{
		return this.serialize(async () => {
			await this.commit(schedule.recordPresence(this.state, presence, Date.now()));
			await this.publishScheduleControls();
			return true;
		});
	}

	setScheduleControl(control, value)
	{
		if (!['schedulesPaused', 'skipNext'].includes(control) || typeof value !== 'boolean') throw new Error('Invalid schedule control');
		return this.serialize(async () => {
			await this.commit({ ...this.state, [control]: value });
			await this.publishScheduleControls();
			return true;
		});
	}

	async scheduleEvent(run, stage, message, attention = false)
	{
		await this.commit(schedule.event(this.state, run, stage, message, Date.now()));
		await this.publishScheduleControls();
		const tokens = { schedule: run.schedule, stage, message: `${run.scene}: ${message}` };
		await this.device.homey.flow.getDeviceTriggerCard('k11_run_event').trigger(this.device, tokens).catch(this.device.error);
		if (attention)
		{
			await this.device.homey.flow.getDeviceTriggerCard('k11_attention').trigger(this.device, {
				reason: 'schedule', message: `K11+ ${run.schedule}: ${message}. No automatic retry.`,
			}).catch(this.device.error);
		}
	}

	async observeSchedule()
	{
		const run = (this.state.scheduleRuns || []).find((item) => item.id === this.state.activeScheduleRunId);
		if (!run || this.state.online !== 'online' || this.state.sampleAt < run.requestedAt) return;
		if (['clearing', 'cleaning'].includes(this.state.status) && ['requested', 'unconfirmed', 'uncertain'].includes(run.stage))
		{
			await this.scheduleEvent(run, 'cleaning', 'Cleaning reported by robot; room route is not confirmed by telemetry');
		}
		else if (['charging', 'chargedone'].includes(this.state.status) && run.stage === 'cleaning')
		{
			await this.scheduleEvent(run, 'docked', 'Docking reported after cleaning; not proof all rooms finished');
			await this.commit({ ...this.state, activeScheduleRunId: null });
		}
	}

	async runSchedule(args)
	{
		const run = schedule.slot(args, Date.now(), this.device.homey.clock.getTimezone(), this.device.getSettings().k11_morning_scene);
		const proceed = await this.serialize(async () => {
			const skip = this.state.skipNext === true;
			const next = schedule.reserve(this.state, run, Date.now());
			if (!next) return false;
			await this.commit(next); // Reservation and skip consumption are atomic and survive restart.
			let reason;
			if (skip) reason = 'Skip next cleaning was selected';
			else if (this.state.schedulesPaused) reason = 'All vacuum schedules are paused';
			else if (args.decision === 'home') reason = 'Homey reports you are home';
			else if (this.startInFlight) reason = 'Another room-start request is in progress';
			else reason = schedule.presenceBlockReason(this.state, args, Date.now());
			if (reason)
			{
				await this.scheduleEvent(run, 'skipped', reason);
				return false;
			}
			this.startInFlight = true;
			return true;
		});
		if (!proceed) return true;
		let submitted = false;
		try
		{
			const data = await this.bounded(this.device.getHubDeviceValues()).catch(() => null);
			if (!data) throw new Error('Could not refresh robot status');
			const eligible = await this.serialize(async () => {
				if (this.state.schedulesPaused) throw new Error('Schedules were paused during the status check');
				const now = Date.now();
				schedule.slot(args, now, this.device.homey.clock.getTimezone(), this.device.getSettings().k11_morning_scene);
				const awayReason = schedule.presenceBlockReason(this.state, args, now);
				if (awayReason)
				{
					await this.scheduleEvent(run, 'skipped', awayReason);
					return false;
				}
				safety.assertStartAllowed(this.state, { k11_room_scene: args.scene.id, k11_room_verified: true }, now, this.device.homey.clock.getTimezone(), false);
				if (this.state.lastStartRequestAt && now - this.state.lastStartRequestAt < 5 * safety.MINUTE) throw new Error('A start was recently requested; robot state must settle before another start');
				const scene = this.device.homey.drivers.getDriver('scene').getDevices().find((item) => item.getData().id === args.scene.id);
				if (!scene) throw new Error('Selected scene is no longer paired');
				if (typeof scene.getAvailable === 'function' && !scene.getAvailable()) throw new Error('Selected scene is unavailable');
				const client = this.device.homey.app.openToken ? null : scene.getOAuth2ClientForDevice();
				if (!this.device.homey.app.openToken && !client) throw new Error('Scene authentication unavailable');
				const notified = { ...this.state.notified };
				delete notified.start;
				await this.commit({ ...this.state, activeScheduleRunId: run.id, lastStartRequestAt: now, pendingStartAt: now, notified });
				await this.scheduleEvent(run, 'requested', 'Submitting the selected SwitchBot scene; movement not yet observed');
				submitted = true;
				const response = await this.bounded(this.device.homey.app.openToken ? this.device.homey.app.hub.startScene(args.scene.id) : client.startScene(args.scene.id));
				if (this.device.homey.app.openToken ? response !== true : !response || response.statusCode !== 100) throw new Error('Scene rejected or acceptance uncertain');
				return true;
			});
			if (!eligible) return true;
		}
		catch (error)
		{
			await this.serialize(async () => {
				// Only known local messages are recorded; provider errors may contain secrets.
				const safeMessages = ['Could not refresh robot status', 'Schedules were paused during the status check', 'Fresh online robot status is required', 'Robot is busy, paused, or not ready', 'An unfinished session needs attention before a new start', 'At least 30% reported battery is required', 'A start was recently requested; robot state must settle before another start', 'Selected scene is no longer paired', 'Selected scene is unavailable', 'Scene authentication unavailable', 'Outside the approved schedule slot; no command sent'];
				const reason = safeMessages.includes(error.message) ? error.message : 'Status, scene or local storage verification failed';
				const message = submitted ? 'Scene acceptance uncertain; check the robot' : `Safety check blocked cleaning: ${reason}`;
				if (submitted) this.state.pendingStartAt = null;
				await this.scheduleEvent(run, submitted ? 'uncertain' : 'skipped', message, true);
			});
		}
		finally { this.startInFlight = false; }
		return true;
	}

	async startRoom(scheduled = false)
	{
		if (this.startInFlight) throw new Error('A room start is already in progress');
		this.startInFlight = true;
		try
		{
			const data = await this.device.getHubDeviceValues();
			if (!data) throw new Error('Could not refresh robot status; no command sent');
			return await this.serialize(async () => {
				const settings = this.device.getSettings();
				const now = Date.now();
				const day = safety.assertStartAllowed(this.state, settings, now, this.device.homey.clock.getTimezone(), scheduled);
				// A successful or ambiguous request must not be replayed on double-click.
				if (this.state.lastStartRequestAt && now - this.state.lastStartRequestAt < 5 * safety.MINUTE) throw new Error('A room start was recently requested; confirm robot state before retrying');
				const scenes = this.device.homey.drivers.getDriver('scene').getDevices();
				const scene = scenes.find((item) => item.getData().id === settings.k11_room_scene);
				if (!scene) throw new Error('Configured room scene is not paired in Homey');
				this.state.lastStartRequestAt = now;
				this.state.activeScheduleRunId = null; // Do not attribute a later manual run to an older schedule.
				this.state.pendingStartAt = now;
				delete (this.state.notified || {}).start;
				if (scheduled) this.state.lastAutomationDay = day;
				await this.device.setStoreValue('k11_safety_v1', this.state);
				if (this.device.homey.app.openToken)
				{
					const response = await this.device.homey.app.hub.startScene(settings.k11_room_scene);
					if (response !== true) throw new Error('Scene acceptance unknown; do not automatically retry');
				}
				else
				{
					const client = scene.getOAuth2ClientForDevice();
					if (!client) throw new Error('Room scene authentication unavailable');
					const response = await client.startScene(settings.k11_room_scene);
					if (!response || response.statusCode !== 100) throw new Error('Scene was rejected or acceptance is unknown; do not automatically retry');
				}
				// Acceptance is not proof of movement, room selection, or completion.
				return true;
			});
		}
		finally
		{
			this.startInFlight = false;
		}
	}
}

module.exports = K11Monitor;
