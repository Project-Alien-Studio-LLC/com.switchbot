# SwitchBot bounded reliability trial

Collector runs every 120 seconds using Homey diagnostics GETs only; it makes no additional SwitchBot cloud requests. Its persisted first-run end time is fixed at 24 hours and must not be reset or extended. Daily evidence is pruned to a rolling 48-hour maximum. App process boundaries remain visible in snapshots and are not uninterrupted uptime.

Two consecutive samples confirm receiver/queue/provider faults. Repeated poll failures require distinct poll attempts. Quiet rooms never imply a fault. Missing collector coverage is unknown, not a device crash. Notifications are deduplicated and recoveries need two healthy samples; ambiguous notification delivery may be retried, not guaranteed exactly once.

Evidence is written before any recovery. A missing/failed receiver may trigger one targeted reconnect. If that fails to restore the receiver after five minutes, one SwitchBot-app-only restart is permitted per trial. No entire-hub restart, device actuation, provider re-pair, credential change, or Flow modification is permitted. Provider errors, blocked capability queues and missing polling alone are alert-only.

Run with Node `--env-file` using the existing local Homey token and `SWITCHBOT_EVIDENCE_DIR` on the external SSD. A launchd job supplies scheduling. The heartbeat reviews coverage, significant failures and completion, then unloads the collector and deletes itself. Secrets are neither copied into evidence nor logged.
