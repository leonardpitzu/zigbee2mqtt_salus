# zigbee-herdsman-converters patch

`0001-feat-Salus-SQ610RFNH-presets-add-SQ610RF.patch` is what the thermostat converter in this repo does, written into zigbee2mqtt's own `src/devices/salus_controls.ts`, plus a test file. It lived on a fork branch that has been deleted; the patch keeps it. It has not been submitted.

| | |
|---|---|
| Based on | zigbee-herdsman-converters 26.127.0 (`1e18d50`) |
| In it | presets (schedule, manual, away) and `hold_type`; on goes back to the preset the thermostat had before off, on while on writes nothing; mode writes wait for the thermostat's echo (declared as cluster command 0x33) and run one at a time per thermostat; the SQ610RF as a white label of the SQ610RFNH; `test/salus_controls.test.ts` |
| Checked | the full test suite, `biome check` and the build passed on 26.127.0 |
| Not in it | `schedule_setpoint` and the wiring-centre zone table (that one needs the thermostats' IEEE addresses from their short addresses, which has no clean way in zigbee-herdsman-converters) |

## Use it

```sh
git clone https://github.com/Koenkk/zigbee-herdsman-converters.git
cd zigbee-herdsman-converters
git checkout -b salus-it600-presets 1e18d50
git am /path/to/0001-feat-Salus-SQ610RFNH-presets-add-SQ610RF.patch
git rebase master
```

The repo's pre-commit hook runs `pnpm run build`, `pnpm run check` and `pnpm run test`, so pnpm has to be on the PATH (`npx pnpm@<version from package.json>` works through a small wrapper script).

## Before a pull request

Their `AI_POLICY.md` asks for three things: permission from a maintainer on an issue before an AI-assisted pull request is posted, the AI involvement disclosed in the pull request, and the pull request text and every reply in your own words.
