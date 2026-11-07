# Salus iT600 for zigbee2mqtt

Two [zigbee2mqtt](https://www.zigbee2mqtt.io/) external converters for Salus iT600 underfloor heating — the SQ610RF and SQ610RFNH thermostats and the KL08RF wiring centre — on top of zigbee2mqtt's built-in Salus support.

**Switching a thermostat off and on again no longer throws its schedule away.** zigbee2mqtt's built-in definition switches a thermostat on in permanent hold, exactly as the Salus gateway does, and that quietly turns the thermostat's own weekly program off. Here, on puts the thermostat back in the mode it was in, and on while it is already on sends nothing at all — so the automation that switches the heating on in the morning cannot knock a running schedule into manual.

> **Built on mikkelke's work.** The protocol, the greeting that lets the thermostats finish pairing, the capture tools and most of the documentation are Mikkel Eskildsen's, from [mikkelke/salus-zigbee](https://github.com/mikkelke/salus-zigbee); zigbee2mqtt's built-in Salus support came from him too. This repo adds two small overlays on that built-in support and keeps a copy of his protocol notes and tools next to them.

## Features

### Presets that follow the thermostat

| Entity | What it shows |
|---|---|
| climate `preset` | `schedule`, `manual` or `away`, read from the thermostat and settable. A temporary hold — a setpoint changed while the schedule runs — shows as `schedule`, because the schedule's next step takes over again |
| `hold_type` | What the thermostat reports: `schedule`, `temporary_hold`, `manual`, `away` or `standby` (off). Diagnostic |
| `schedule_setpoint` | The setpoint the thermostat's own program asks for right now. On schedule, the active setpoint differs from it only during a temporary hold |

### On means "back to how it was"

| zigbee2mqtt sets | The thermostat gets |
|---|---|
| `system_mode: off` | `B20 07`, standby. The preset it had is kept |
| `system_mode: heat`, after off | `B20 02` + `B48 04` — the pair the Salus gateway sends — then `B20 00` for schedule or `B20 06` for away |
| `system_mode: heat`, while on | nothing |
| a `preset`, while off | on in heat, in that preset |

The thermostats sleep and pick up a write when they next poll their parent, about every 7 s. Each write waits for the thermostat's echo before the next one goes out, and fails after 30 s without one. Commands to one thermostat run one after the other, and a command that had to wait decides on what was learned in the meantime, so an on that arrives right behind an off is not skipped.

### The SQ610RF too

zigbee2mqtt 2.14 only knows the SQ610RFNH. The RF-only SQ610RF reports its own model ID, gets a generic definition, never receives the greeting and stays on its "connect" screen. It speaks the same protocol, so here it gets the same definition. Two SQ610RF run next to four SQ610RFNH on one wiring centre. Reported as [mikkelke/salus-zigbee#1](https://github.com/mikkelke/salus-zigbee/issues/1).

### The wiring centre's zone table

`zone_1` … `zone_8` on the KL08RF: the IEEE address of the thermostat in each zone, its short address while no known device has it, `null` while the zone is free. The table is asked for once when zigbee2mqtt starts and whenever a zone is read; the wiring centre also sends it by itself after every pairing. It is read only — pairing a zone stays with the built-in `wiring_centre_zones` of the thermostat.

### Battery first

Nothing here polls a thermostat. Everything shown comes from the status records the thermostats send by themselves, and a thermostat only receives something when you change its mode, preset or setpoint. The one request these converters make on their own is for the zone table, and it goes to the wiring centre, which is mains powered.

### Ready for zigbee2mqtt to catch up

Once zigbee2mqtt's built-in definition grows the same features, these converters must not get in its way. They take the thermostat's echo both as a raw frame (zigbee2mqtt 2.14) and as a parsed command, do not add an entity twice when the built-in definition has it, and log a hint to remove them when it has presets or zone sensors. CI runs the tests against the converter library zigbee2mqtt 2.14.3 ships and against its latest release, so a release that would break them fails there before you update.

## What it does not do

- **Edit the weekly program.** The thermostats store it, but how a program is sent or read over Zigbee is unknown ([MANUAL-COVERAGE.md](MANUAL-COVERAGE.md) #9, "not found"); only the setpoint of the current step is, which is `schedule_setpoint`. Finding the rest needs a capture of a Salus gateway while a program is changed in the app, see [Capture it yourself](#capture-it-yourself).
- **Settings, zone unpairing and the other extras of mikkelke's own converter** — frost setpoint, temperature offset, heat control algorithm, min/max setpoints. If you need those, use [his converter](https://github.com/mikkelke/salus-zigbee/blob/main/converters/salus_sq610rfnh.mjs) instead of these. Not both.

## Use the converter

1. Copy `converters/salus_it600_thermostats.mjs` and `converters/salus_kl08rf_zones.mjs` to `external_converters/` in the zigbee2mqtt data folder. If an older `salus_sq610rf.mjs` is there, remove it: the thermostat file replaces it.
2. Restart zigbee2mqtt.

Pairing is zigbee2mqtt's built-in one:

1. Factory reset the thermostat.
2. Permit join on the whole network — `{"time": 254}` to `zigbee2mqtt/bridge/request/permit_join` — with the thermostat close to a router or the coordinator. Not on the wiring centre only: mikkelke saw a thermostat associate with it 50+ times without ever getting the network key.
3. Start pairing on the thermostat.
4. Pair it with its zone: `{"wiring_centre_zones": [1]}` to `zigbee2mqtt/<thermostat>/set`, which also takes the zone over from another thermostat. The zone table on the wiring centre shows the result.

The thermostats take their clock from zigbee2mqtt, in the time zone of the host it runs on. In Docker that is UTC unless `TZ` is set, for example `TZ=Europe/Bucharest`.

## Firmware updates

zigbee2mqtt can update the thermostats over the air. The images are standard Zigbee OTA files (manufacturer 0x1078, image type 0x7A) and are not in this repo; [docs/ota/README.md](docs/ota/README.md) has where they come from and how to add one to zigbee2mqtt's local OTA index. mikkelke's update from 0x50 to 0x54 took about 1.5 h per thermostat.

## Capture it yourself

Everything in [PROTOCOL.md](PROTOCOL.md) came from decrypted captures of a Salus network, and the tools for doing the same with a Sonoff ZBDongle-P are in `tools/`:

1. Back up the dongle's flash with [cc2538-bsl](https://github.com/JelmerT/cc2538-bsl) (`--bootloader-sonoff-usb -r -l 360448`).
2. Take `sniffer_fw/bin/cc1352p2lp/sniffer_fw.hex` from TI's SmartRF Packet Sniffer 2 installer (free TI account, the installer opens with 7-Zip).
3. `tools/fix_ccfg.py sniffer_fw.hex sniffer-dongle.hex <your backup>` keeps the dongle re-flashable; flash `sniffer-dongle.hex`.
4. `tools/ti_sniff.py -c <channel> -w capture.pcap` records a pcap for Wireshark.
5. Pair a thermostat to the Salus gateway while recording. The network key travels during the join, encrypted with the standard Zigbee link key, so Wireshark can recover it.
6. `SALUS_NWK_KEY=<key> tools/decode_capture.py capture.pcap` prints the Salus frames as a timeline.

Restore the backup with cc2538-bsl afterwards. `pip install -r tools/requirements.txt` gets the tools' Python packages. Captures and keys are kept out of git by `.gitignore`. [PROTOCOL.md section 11](PROTOCOL.md#11-open-questions) lists what is still unknown and which capture would answer it.

## Development

```sh
npm ci --ignore-scripts
npm test
```

The tests run both converters against a simulated thermostat and wiring centre with the real zigbee-herdsman-converters: that the definitions win over the built-in ones, the exact B-command sequences, echoes both raw and parsed, the off/on races, and that nothing is sent unless something is set. The pins — zigbee-herdsman-converters 26.125.0 and zigbee-herdsman 11.2.0 — are what zigbee2mqtt 2.14.3 ships; they move when zigbee2mqtt does, which is why Dependabot leaves them alone.

## Files

| Path | What |
|---|---|
| `converters/salus_it600_thermostats.mjs` | SQ610RFNH and SQ610RF |
| `converters/salus_kl08rf_zones.mjs` | KL08RF zone table |
| `tests/` | `node --test` suites for both |
| `PROTOCOL.md` | The protocol, every field marked proven, inferred or unknown (mikkelke) |
| `MANUAL-COVERAGE.md` | Every feature in Salus' manuals and where it sits in the protocol (mikkelke) |
| `docs/wiring-centre.md` | The wiring centre on zigbee2mqtt (mikkelke) |
| `docs/ota/` | Getting the 0x54 firmware into the zigbee-OTA index (mikkelke) |
| `tools/` | Sniffer host, capture decoder, CCFG check and fix (mikkelke) |
| `upstream/zigbee-herdsman-converters/` | The thermostat changes as a patch for zigbee2mqtt itself, not submitted |

## Licence

MIT, see [LICENSE](LICENSE). `PROTOCOL.md`, `MANUAL-COVERAGE.md`, `docs/` and `tools/` are copied unchanged from [mikkelke/salus-zigbee](https://github.com/mikkelke/salus-zigbee) (commit `29ccc72`), MIT, © Mikkel Eskildsen; where they say "the converter in this repo" they mean his `salus_sq610rfnh.mjs`. Salus' product photos are not included. Not affiliated with Salus.
