# Presence reporting recovery (ALI-187)

The hub presence driver receives SwitchBot change reports and periodic cloud status reads. A partial report must not clear occupancy, and a status request started before a webhook must not overwrite the newer report when it finishes.

The driver now serializes capability writes, preserves omitted values, accepts both `detected` and the documented `Detected` field, records zero readings, and rejects duplicate or out-of-order webhook samples. A failed capability write does not block the next report. OAuth status reads and token GET requests have 15-second transport deadlines so a silent cloud read cannot indefinitely hold up the serial hub polling loop. Command behavior and the existing polling quota are unchanged.

Homey webhook registration is also serialized. If a sensor initializes while registration is in flight, a trailing registration includes the latest complete device list. An older request can no longer finish after a newer one and replace the tracked webhook handle with an obsolete subscription. Registration logs use the immutable list actually submitted to Homey.

`presence_last_report` is an additive, read-only capability containing the local receipt time of a valid presence report. It advances even when occupancy is unchanged. This is evidence of receiving cloud status, not proof that the physical sensor sampled at that instant. Partial light/battery reports and failed polls do not advance it.

The authenticated `GET /getPresenceDiagnostics/` app endpoint exposes per-sensor successful poll and webhook times, ignored sample and superseded poll counters, and current shared polling progress. It sends no device commands and makes no additional provider requests. These counters reset when the app restarts; the displayed receipt capability retains its last value.

Regression coverage: partial status, zero readings, field variants, unchanged reports, failed reads, slow polls racing with webhooks, out-of-order samples, unrelated device IDs, recovery after capability write failure, and transport read deadlines. Live installation acceptance additionally requires unchanged device identities/settings and Flow definitions, a fresh real cloud poll, and available devices. An intermittent physical reporting fault is only closed after observing affected-sensor transitions in use.

Provider schema: https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/sensors/presence-sensor.md
