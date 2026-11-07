# Wiring centre (KL08RF / it600WC) on zigbee2mqtt

The wiring centre switches the floor-heating zones from its thermostats' demand. Running it on zigbee2mqtt, next to the thermostats, lets a whole Salus floor-heating system run without the Salus gateway. This works: a wiring centre with six thermostats over seven zones and a seventh thermostat ran on zigbee2mqtt 2.14.2 with the converter in this repo. This page is how to add one, how it works and where the limits are. The frames and their marks are in [PROTOCOL.md](../PROTOCOL.md).

## Add a wiring centre

The converter file has the wiring centre as its second definition, model KL08RF. It matches a router with `manufacturerName` `Computime` that reports no `modelId` and has endpoint 8 alone, on the home automation profile (260); the definition then uses endpoint 8 as the device's default.

1. **Factory reset it.** Hold Pair for 15 s until G1 and G2 turn red and go off. A wiring centre keeps the first device number it receives, and a reset is what clears a wrong one (PROTOCOL.md section 4.3). **All its paired thermostats leave the network too**, so they have to join and be paired again.
2. **Cut its mains power and wait until the network LED has gone dark.** After a reset it does not look for a network by itself. Its radio keeps running through a short cut (the LED keeps blinking for 10 s with the power off); only a cut until the LED is dark reboots it.
3. **Permit join on the whole network, then switch it on.** Publish `{"time": 254}` to `zigbee2mqtt/bridge/request/permit_join`. The wiring centre joins at once, sends its sync request and gets a 0x81 with device number 1. zigbee2mqtt recognises it as KL08RF, and the converter asks it for its zone table.
4. **Join the thermostats** as in the [README](../README.md#use-the-converter), with permit join on the whole network again.
5. **Pair each zone** from the thermostat: publish `{"wiring_centre_zones": "8"}` to `zigbee2mqtt/<thermostat>/set`. The value is the zone numbers 1 to 8 separated by commas, for example `"1,4"`, and the word `replace` in front takes over a zone that another thermostat holds, for example `"replace 1,4"`; that is also what a thermostat that rejoined under a new short address needs. The converter sends B47 with the number and the short address of the wiring centre it knows, and the call is done when the wiring centre's zone table shows the thermostat in all the zones. It fails after 20 s per zone if the table does not, which is what a refused pairing looks like (0x88 status 02 for a zone that is taken). With `replace` it sends the reset form of B47 first and waits for its echo, see below.

   The B47 is the one that was tested on a real wiring centre as raw hex through `salus_command`, which still sends it. `wiring_centre_zones` sends the same frame and has been run on a real wiring centre too: a zone that the coordinator held was refused, and `replace` took it over. Its fields, with the placeholder short address 0x5678 for the wiring centre:

   | Bytes | Example | Meaning |
   |---|---|---|
   | 3 | `42 34 37` | the code B47 |
   | 2 | `00 11` | fixed |
   | 2 | `01 00` | wiring centre number 1, little-endian |
   | 2 | `78 56` | short address of the wiring centre, little-endian |
   | 1 | `fe` | pair request |
   | 1 | `00` | replace: `01` takes over a zone that another thermostat holds |
   | 8 | `00 00 00 00 00 00 00 01` | one flag per zone, zone 1 first; here zone 8 |
   | 17 | `00 ...` | zeros |

   Zone 8:

   ```text
   423437001101007856fe0000000000000000010000000000000000000000000000000000
   ```

   Zones 1 and 4 together have the flags `01 00 00 01 00 00 00 00`. The thermostat pairs zone 1, then zone 4.

   A thermostat whose zone the coordinator took over most likely still believes it holds it: `replace` alone did not make it pair (it never sent 0x18). It paired on the first try after the reset form of B47, which has `ff ff` for the wiring centre number, `ff ff` for its short address, state `fd` and zeros (PROTOCOL.md section 7.7). `wiring_centre_zones` with `replace` sends it first, waits for its echo and then sends the pairing form:

   ```text
   4234370011fffffffffd0000000000000000000000000000000000000000000000000000
   ```
6. **Check.** The thermostat's display leaves "go to the Smart Home app", and `zone_1` to `zone_8` on the wiring centre show the IEEE address of the thermostat in each zone (its short address when no device has it, null while the zone is free). It reports the table after each pairing; publish `{"zone_1": ""}` to `zigbee2mqtt/<wiring centre>/get` to ask again. A zone taken over with replace is reported as `replaced_thermostat`.

## How it works

Section numbers are PROTOCOL.md's.

1. **Device.** Endpoint 8, profile 0x0104, clusters Basic and 0xFC00, and the OTA client 0x0019 among the output clusters. Manufacturer code 0x1078, `manufacturerName` `Computime`. Its 0xFC00 frames use frame control `0x15` (sections 1 and 2).
2. **Greeting and device number.** It sends the same sync request (0x10) as the thermostat and stays once it gets a 0x81. [Koenkk/zigbee-herdsman-converters#3354](https://github.com/Koenkk/zigbee-herdsman-converters/issues/3354) shows it leaving a standard network after a few seconds when nobody answers. Byte 0 of the 0x81 is the device number the wiring centre gets. It keeps the first one it receives, and refuses every zone pairing (0x88 status 01) unless that number is a wiring centre's: 0x20 was refused, 1 works. With 1 it acknowledges the 0x81 with a 0x37 (section 4.3).
3. **Zone pairing.** The coordinator sends B47 to the thermostat, then thermostat and wiring centre pair directly: 0x18 request, 0x88 ack, 0x14 confirm, 0x84 done. The coordinator only relays, as the thermostat's parent (sections 7.1 and 7.2). B47 has one flag byte per zone; zones 2, 3, 5, 6, 7 and 8, and zones 1 and 4 together, were paired.
4. **Occupied zone and replace.** A zone held by another thermostat answers 0x88 with status 02. B47 with the replace flag takes it over, and the wiring centre reports the replaced thermostat to the coordinator with 0x1a (section 7.4).
5. **Zone reports and relays.** Each paired thermostat sends 0x12 straight to the wiring centre about every 615 s and soon after a setpoint change. Byte 2 is the heat demand, byte 3 the zone, then room temperature and setpoint. With a thermostat on zone 8 and its setpoint raised to 30 °C over a room at 22.5 °C, the demand was 01 within 7 s, the zone 8 LED came on, and the pump and boiler outputs followed. This runs without the coordinator, as long as all devices stay in one network (section 7.3).
6. **Zone table.** The wiring centre reports which thermostat holds which zone as a B70 record: unsolicited at boot and after pairing, or on request with `01 'B70' 7e aa aa a8 80 00 00 00 78`. The table survives mains cuts (section 8).

## Seen on zigbee2mqtt

1. **Mains cuts.** A short cut reboots the main controller only. It re-sends its zone table, sends a 0x10 and re-sends 0x84 to every zone thermostat. The zone table survives.
2. **Factory reset.** It broadcasts a NWK Leave, and its thermostats leave with it: three were seen leaving within 8 s, and all six had left. The manual says the reset button does not remove the wiring centre itself from the network. No beacon requests followed in 20+ minutes. A power cycle that reboots the radio makes it join an open network at once.
3. **Thermostats joining.** With permit join limited to the wiring centre, a thermostat associated with it 50+ times and never received a Transport Key. With permit join on the whole network they joined (5 of 6; one joined through the coordinator directly). The cause is not known; permit join on all routers.
4. **Factory-reset thermostats** come back at 21 °C permanent hold with a frost setpoint of 5 °C. With heat control ITLC UFH they may call for heat slightly above their setpoint (one bedroom unit at 22 °C over 21 °C).

## Limits

1. **One wiring centre per network.** The converter gives every wiring centre device number 1. Gateway code uses slots 1-9, but how a second wiring centre gets its number and how B47 picks it has not been seen on air.
2. **No unpairing.** `wiring_centre_zones` only pairs: the unpair form of B47 is not known (PROTOCOL.md section 11).
3. **A thermostat's request for the wiring centre (0x16)** is answered with the wiring centre's short address, from gateway code. It has not been seen on air. The converter remembers the wiring centre when it joins or greets and when zigbee2mqtt starts.
4. **Relays follow the demand flag.** Whether the wiring centre also compares temperature and setpoint is open (PROTOCOL.md section 11).

## Firmware updates

The index match works; a transfer is untested. What is known:

1. Salus ships the wiring centre firmware as standard Zigbee OTA files. Salus app 0.121.1 carries `sch_it600WC.json`, a tar archive with `SAL6DW1_20230222.ota`: manufacturer 0x1078, image type 0x12, file version 0x20230222, header string `EBL IT600_Tstat`, 152 770 bytes, MD5 matching the bundle's `networkinfo.json`.
2. `sch_it600WCNH.json` in the same app holds `it600WCNH_00090005.ota` (image type 0x84, version 0x00090005, header `EBL SAL6DIA`). That is the NH variant, a different model.
3. A live it600WC reports firmware `20230222`, the same as the app's image. The gateway's `readall` has an `sOTA` section for it but no `OTAFirmwareURL_d`, so the gateway has never updated it. There is no newer image today.
4. The zigbee-OTA index already has both images (`SAL6DW1_20230222.ota` and `it600WCNH_00090005.ota`), tagged `manufacturerName: ["SalusControls"]`. The wiring centre reports `Computime`, so the definition has `ota: {manufacturerName: "SalusControls"}` for those entries to match. They do: zigbee2mqtt matched the wiring centre to `SAL6DW1_20230222.ota`, and as that is the installed version it has nothing newer to offer.
5. On zigbee2mqtt the wiring centre's interview lists the OTA client cluster (0x0019) among its output clusters, and it asks for an OTA server at boot. With the firmware coming as Zigbee OTA images, zigbee2mqtt should be able to update it given a newer image. That is inferred; no transfer has been tried.

When Salus releases a newer image:

1. **Get it.** After the Salus gateway has updated a wiring centre, `readall` shows the download link in `sOTA.OTAFirmwareURL_d`. Or take it from a newer Salus app on an Android phone:

   ```bash
   adb shell pm path com.salus.eu.smarthome          # take the base.apk path
   adb pull /data/app/.../base.apk salus.apk
   unzip -o salus.apk 'assets/flutter_assets/packages/local_wifi_manager_old/assets/ota/salus/firmware/sch_it600WC*.json' -d salus-app
   tar xf salus-app/assets/flutter_assets/packages/local_wifi_manager_old/assets/ota/salus/firmware/sch_it600WC.json
   ```

2. **Check the header.** Manufacturer 0x1078, image type 0x12, file version above 0x20230222:

   ```bash
   python3 -c "import struct,sys; b=open(sys.argv[1],'rb').read(); mc,it,fv=struct.unpack_from('<HHI',b,10); print(hex(mc),hex(it),hex(fv),b[20:52].rstrip(b'\0'))" SAL6DW1_*.ota
   ```

3. **Check the device.** On zigbee2mqtt, the wiring centre's endpoint must list 0x0019 among its output clusters. The tested one does.
4. **Install it** through zigbee2mqtt's local OTA index, as for the thermostat ([README](../README.md#firmware-updates), [docs/ota](ota/README.md#until-it-is-merged)), then start the update from zigbee2mqtt.
