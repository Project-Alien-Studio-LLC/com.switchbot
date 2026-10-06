# K11+ guarded schedules — 2026-09-04

## September 8 debug correction

Native logs proved that DND ending at 06:00 blocked the September 6–8 05:00 runs. Restored native DND to 21:00–04:00 daily. The verified morning scene is now configured privately in `k11_morning_scene`, not hardcoded in source. The premature undefined-start-marker warning is fixed; actual unresolved alerts remain. See `k11-debug-2026-09-08.md` for deployment evidence and pending natural-run verification. This amendment supersedes older DND guidance.

## September 5 amendment: Quiet morning at home

The user authorized the 05:00 morning clean while Home. The morning Flow now has no presence condition and uses `quiet_morning`, an exception restricted to schedule `morning`, time `05:00`, and native scene `9b0b88f4-766b-4a67-8943-508e6ef843c9`. Other schedules retain both the Homey Away condition and 30-minute continuous-away requirement. Pause/Skip, slot reservation, status freshness, battery, idle state and no-retry checks still apply to morning cleaning. The visible presence text now explains the morning exception.

Reopened the native Morning Clean Homey editor and verified Quiet mode followed by room vacuuming. Installed the update from `/tmp/switchbot-morning-home.bBD4Eh`, preserving the previously deployed cumulative-energy changes and excluding the unrelated global fan label change. All 83 tests passed, verified-level validation passed, the new runtime presence label read back, and all four Flows were enabled and unbroken after the morning-only update. No cleaning command was issued. The September 5 skipped morning reservation remains intact; the next eligible morning is September 6 at 05:00 America/New_York. The sections below describe the original September 4 implementation.

## Live implementation

The existing four enabled Homey schedule IDs were updated in place from direct SwitchBot Start Scene cards to the K11+-specific guarded action. Their trigger times, weekday selections, folder, enabled state and native scene identities were preserved. Every schedule now uses the Homey presence condition for George: the Then branch requests a guarded clean and the Else branch records a quiet home skip. The original definitions are saved outside the app source in `../homey-automation/k11-before-guarded-schedules-2026-09-04.json`.

The 30-minute-away update was installed from an isolated candidate at `/tmp/switchbot-k11-away.mm9cHA/candidate`. It was based on the previously isolated guarded-schedule candidate and received only the presence-gate files. This excluded unrelated working-tree changes and preserved device identities, OAuth sessions, pairings and stores. All 72 SwitchBot device IDs were preserved.

## Schedule behavior

- Every invocation validates its stable schedule key, exact Homey-local weekday and a three-minute time window. A Flow Test outside the approved slot fails before reserving or contacting SwitchBot.
- Every schedule requires Homey to report George away and the app to have recorded that Away state continuously for at least 30 minutes. Unknown presence, a missing/future Away timestamp, Home, or less than 30 minutes away skips that scheduled slot without sending a robot command. A Home transition clears eligibility immediately.
- Homey's Away and Home transitions are recorded by two enabled tracking Flows. Duplicate Away events preserve the original continuous-away timestamp. The app rechecks the 30-minute gate after refreshing robot status and immediately before submitting the scene, closing the return-home race.
- Each local date and schedule key is persisted before status refresh or scene submission. A duplicate trigger, DST clock repeat, app restart or ambiguous response cannot replay that slot.
- The preflight requires a fresh non-future status received within two minutes, explicit online status, idle/docked state, no unfinished run, known battery of at least 30%, and an available paired native scene.
- Status refresh and scene submission are bounded to 20 seconds. Missing, rejected or uncertain acceptance is never retried automatically. Raw provider error text is not copied to the visible run log or alert.
- The existing multiple scheduled slots are deliberately independent; the older global once-per-day quota and 22:00–09:00 app-level quiet-hours setting do not block this approved schedule, including 05:00.
- `Pause all vacuum schedules` and `Skip next cleaning` are persistent Robot Vacuum K11+ controls. Skip is consumed and reset at the next invoked scheduled slot before presence or pause evaluation. Pause/resume and skip/cancel control Flows are enabled in the Cleaning folder.
- A bounded 30-entry run history distinguishes requested, cleaning observed, docked observed, skipped, unconfirmed and uncertain. SwitchBot acceptance is only `requested`; reported cleaning does not prove the room route; reported docking does not assert every room was completed. Pause and standby never become completion.
- Run status is visible as `Last scheduled run`. All run stages go to a quiet Homey timeline Flow. Safety failures also use the existing deduplicated K11 attention route. Intentional presence, pause and skip outcomes do not send attention alerts.

## Homey Flow IDs

Schedules:

- Morning daily 05:00, away at least 30 minutes: `986d7814-376d-4206-ab8a-56fa465f9613`
- Kitchen + Bathroom Mon/Tue/Thu 13:00, away at least 30 minutes: `f5c43c5f-7425-4de8-9e6c-2969d775711a`
- Kitchen + Bathroom Sun/Mon/Wed/Thu 19:30 away: `ec162005-7418-4943-8b69-de83cfe95f24`
- Entire Home weekends 13:00 away: `c1b62324-466e-439b-b227-3c96c0dd8813`

Controls and logs:

- Skip next: `69e76bbc-5cc3-4737-af67-fef61140cdb3`
- Cancel skip: `b597846f-84d9-41b4-8cca-8a14e08e35c2`
- Pause schedules: `fa84c2d6-c7f0-4852-8a62-2799a2f4ce15`
- Resume schedules: `d04e8747-40bb-4991-98f2-a30dc9ce0de8`
- Scheduled cleaning history: `648e915b-8982-4b2a-b74f-3df21ea67ac6`
- Presence verification away: `eea7829a-6cf4-4bbd-90b1-12cb5caf8c06`
- Presence verification home: `e2d1d52f-a1cd-4451-888a-75cde06389f3`

## Verification

- 81/81 local and isolated-candidate tests passed.
- ESLint passed on every changed K11 runtime JavaScript file.
- Homey validation passed at verified level before and after candidate preparation.
- Live app installation succeeded. The app is not crashed and the new action/trigger cards are registered.
- All four schedules read back enabled, unbroken, with George-away conditions, exact guarded Then actions and explicit Home-skip Else actions.
- The Away and Home tracking Flows read back enabled and unbroken, with the presence-state recorder first and the original user notification second.
- After the update, the live control state was restored to schedules active / no pending skip. Homey reported George Home, and the robot's visible gate read `Home — scheduled cleaning blocked`.
- A live setup-only invocation used the home-skip decision while schedules were paused and skip-next was set. It consumed skip once, recorded a timeline entry, and a duplicate invocation did not produce another event. An outside-slot live invocation was rejected. Robot status remained Charge Done; no scene or device command was sent.
- Homey's rendered Robot Vacuum K11+ view visibly showed Pause all vacuum schedules, Skip next cleaning and Last scheduled run.

## Noise configuration and physical validation

The SwitchBot K11+ Do Not Disturb schedule is enabled every day from 21:00 to 06:00, so the 05:00 Homey Morning Clean uses reduced voice prompts and indicator-light brightness. During this window, automatic dust emptying and automatic cleaning resumption are also suppressed; their normal behavior resumes outside DND. The robot's live Homey voice-volume value is 65%. Automatic robot dust emptying remains enabled at Regular (after 75 minutes), and Auto-Resume Cleaning remains enabled outside DND.

The native `Morning Clean Homey` scene was saved with Quiet suction followed by a room clean of Kitchen, Bathroom and Living room; Master bedroom was not selected. Its paired Homey scene remains `SB Morning Clean` with the same native scene ID. No Play or Test control was used while editing it.

No physical cleaning, Pause, Dock, room-routing, auto-emptying, or real leave/return event was triggered during implementation. The two enabled presence-verification Flows will record George's next real Away and Home transitions. The supervised living-room Start → Pause → Dock and routing check is waiting for the user's confirmation that they are home and the floor is clear.

## Test strategy

Unit coverage emphasizes business-critical and fail-closed behavior: malformed slots, local weekday/time, DST repeated time, persistence failure, duplicate/concurrent/restarted calls, skip/pause semantics, Home/unknown/under-30-minute/future-away blocking, exactly-30-minute eligibility, duplicate Away timestamp preservation, Home reset, return-home during refresh, stale/future/offline/low-or-unknown-battery/busy/unfinished status, missing scene/auth, provider rejection, timeouts, token and OAuth acceptance, provider-error redaction, truthful telemetry transitions, bounded retention, and multiple legitimate slots in one day. Live tests were deliberately non-actuating.
