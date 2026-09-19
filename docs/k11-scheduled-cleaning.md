# K11 scheduled cleaning and monitoring

This driver supports guarded native room-scene schedules, persistent pause/skip controls, continuous-away tracking, and truthful request/observation reporting. Existing device and Flow identifiers remain unchanged.

## Quiet morning exception

Set the device's `k11_morning_scene` to an explicitly verified native Quiet room-scene ID. The `quiet_morning` Flow decision is allowed only for that exact scene, schedule key `morning`, and the 05:00 local slot. An empty configuration fails closed. Other scheduled runs require at least 30 minutes continuously away.

Check native SwitchBot Do Not Disturb settings separately. In a verified K11 incident, scene requests were accepted by the cloud but the robot's native log reported that DND prevented execution. Keep an authorized morning slot outside the native DND window. Quiet suction does not prove voice prompts or automatic emptying are silent.

## Safety and evidence

- Require fresh online status, sufficient battery, idle state, no unfinished session, and a paired scene.
- Persist a per-date/slot reservation before submission; never automatically retry an uncertain request.
- Distinguish requested, cleaning observed, docking observed, and unconfirmed. Docking is not proof of room coverage.
- Do not display an undefined notification marker as a real start fault. Retain genuine unresolved faults; alert only after the observation timeout.
- Verify changes with unit tests and configuration readback. A physical cleaning test requires authorization; a successful natural scheduled run provides separate execution evidence.

Private scene identifiers belong in device settings, not source control. Deployment should preserve existing device stores and pairings.
