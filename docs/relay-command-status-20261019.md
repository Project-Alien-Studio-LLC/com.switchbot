# Relay command/status mismatch — October 19

The bedroom-closet relay remained physically on while Homey reported off. Native
Mac SwitchBot refreshed On/24.8W; one native Off at 10:41AM Eastern was logged as
App Control, refreshed Off/0W and physically confirmed by Sensei Geo. Pairing ID
matches Homey's device. The native Wi-Fi screen reports Connected. No pairing,
network, credential or Flow changes were made in this source repair.

With credentials/settings/devices/Flows backed up privately on SSD, bounded GETs
using the existing API-token and OAuth routes both returned statusCode100 with
the old On/25.2W report. One controlled idempotent Off per existing documented
v1.1 authentication route returned code161; neither was retried and no On command
was sent. These are observations of the provider's status/command disagreement,
not proof of physical On after the native Off or a proven networking root cause.
The native third-party-services page says a Hub is required, while its Wi-Fi page
says Connected. Neither authorizes new pairing/access or a broad reset.

The shared hub driver previously retried code161 and could treat it as completed
if a status GET succeeded. The relay now opts into the existing strict acceptance
path: explicit rejection/missing acknowledgement throws immediately without retry
or a success-producing cached-status probe. An accepted command additionally needs
matching explicit integer0/1 source readback before the capability listener resolves.
Malformed webhook/poll state retains the previous value, not manufactured Off.
A failed-command warning survives ordinary status polling; only a subsequently
accepted matching command clears it. No secret-bearing diagnostics are added.

This patch prevents false command success; it cannot repair provider rejection or
prove a cached GET is fresh. Offline tests are not restored automatic-control
acceptance. Installation replaces/restarts the shared SwitchBot app and briefly
affects its other devices; not performed without a reviewed maintenance window.
Current build remains2.0.100; no version/release claim or merge. Restore prior app
source/package only for rollback; preserve settings, tokens, pairings and Flow IDs.

Next: resolve existing provider cloud-control reachability without new credentials
or re-pairing; obtain approval for shared-app install window. After source/runtime
verification, use one bounded genuine door event and independent native/physical
readback, no forced ON/repeated OFF loop. Keep automatic acceptance open.

Vendor contract: https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/plugs-switches/relay-switch-1pm.md
