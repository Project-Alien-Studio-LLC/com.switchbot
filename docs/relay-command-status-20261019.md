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
The initial source-only build was2.0.100; the authorized maintenance deployment
below supersedes that installation status. No merge or public release was made.

## Authorized maintenance deployment

Sensei Geo authorized the brief shared-app maintenance window. A fresh private SSD
backup retains settings/credentials, all devices and Flows, the prior2.0.100 build
and environment for rollback. Isolated locked production dependencies were packaged
without modifying the original dirty checkout. Version2.0.101 passed158 offline
tests and Homey's verified-level validation, then installed without clean/reset.

At11:13AM Eastern, independent API readback showed2.0.101 running, not crashed,
all71 SwitchBot devices available, and unchanged device identities/settings,
credential settings and all119 Advanced plus27 standard Flows. Cloud status had
changed to Off/0W before the verification command. One bounded Homey Off at
11:13:51AM returned HTTP200 through the strict patched path and read back Off.
The Mac SwitchBot app independently shows an11:13AM Turn off / API log entry,
alongside the earlier10:41AM App Control entry, and Off/0W device detail.

Cloud command reachability is now observed working; its recovery mechanism is
not independently established. No credential, permission, network or pairing
changes were needed. No On command, blind retry, merge or Caesar worker start
was used. A genuine subsequent door-triggered cycle with physical confirmation
remains the automatic-control acceptance gate; the successful idempotent Off
does not establish that complete cycle or durable provider reliability.

Vendor contract: https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/plugs-switches/relay-switch-1pm.md
