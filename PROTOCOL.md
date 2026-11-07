# Salus / Computime iT600 Zigbee protocol: SQ610RFNH thermostat and it600WC wiring centre

This is a working specification of the manufacturer-specific traffic between a Salus SQ610RFNH
("Quantum") thermostat, an it600WC / KL08RF wiring centre and the Salus gateway (SAU2AG1). It is
meant to be enough to build a zigbee2mqtt external converter that runs these devices without the
Salus gateway.

## Sources and confidence

Evidence comes from these sources:

1. **Captures**: decrypted 802.15.4 captures of one live Salus network (channel 15), which held six
   paired SQ610RFNH thermostats, one it600WC and a factory-new SQ610RFNH.
   - **Pairing** (4 min): the new thermostat joins, is assigned to a wiring-centre zone and
     receives app commands.
   - **Baseline** (15 min): no user action.
   - **Demand** (33 s): taken right after the new thermostat's setpoint was raised to 28 °C in
     the app.
2. **Ground truth**: the gateway's own JSON state for every device (local API `readall`), read
   right after the pairing and baseline captures. It holds the parsed fields (`LocalTemperature_x100`, `HoldType`, ...)
   and the raw record they came from (`Status_d`, `Status_2_d`, `CommandResponse_d`).
3. **Gateway code**: the SAU2AG1 gateway userland, as shipped inside the Salus Android app.
   - `libit600transfer_mips.so` converts records to JSON (`Transfer_Thermostat_Status_To_Cloud`)
     and JSON writes to commands (`Transfer_Set_Thermostat_Properties`).
   - `mips_zigbee` builds the greeting reply (`CT_It600DeviceCommand_GetSynchronizationResponseData`).
   - The per-model `zigbee_config/*.cfg` files hold the gateway's frame templates.
4. **Thermostat firmware**: the SQ610RFNH OTA image shipped with the app (file version 0x47; the
   tested units run 0x50 and 0x54), decompiled. Its B-command dispatcher, settings-write parser and
   0x72 record builder are the basis of sections 5.3 and 6. The builder reproduces the factory 0x72
   record byte for byte from the firmware's default table. Layout changes in later firmware are
   possible but not seen: the 0x50 units' records match it.
5. **App**: the Salus Android app's settings labels and property names. The app lists the Quantum
   settings in the same order as the 0x72 bytes, which names several fields.
6. **Manual**: the SQ610RF full user manual, version 16 (68 pages), cited as "manual pNN". It
   gives menu names, option lists, ranges and defaults. It says what a setting means and which
   values it takes, not which byte holds it, so on its own it never raises a byte's mark.
7. **Live tests on zigbee2mqtt** (version 2.14.2, no Salus gateway): the wiring centre, six
   thermostats over seven zones and a seventh thermostat ran on the converter in this repo.
   Watched on the devices, in the zigbee2mqtt log, with the sniffer and, for section 7.6, on a
   power meter on the wiring centre's mains supply.

Every field carries one of three marks:

| Mark | Meaning |
|---|---|
| **P** | Proven: matched to ground truth (gateway JSON or capture timestamps) on more than one device or frame, or observed on air with a known value. |
| **I** | Inferred: consistent with the capture and/or the gateway code, but not independently matched. |
| **U** | Unknown. |

The examples use placeholder addresses: thermostat `0x1234`, wiring centre `0x5678`, IEEE
`00:1e:5e:00:00:00:00:01`. Real addresses and keys are not published.

## 1. Devices

| # | Device | Endpoint | Profile / device ID | Clusters |
|---|---|---|---|---|
| 1 | SQ610RFNH thermostat | 9 | 0x0104 / 0x0301 | in: 0x0000, 0x0003, 0x000A, 0x0B05, 0xFC00, 0xFC09; out: 0x0003, 0x0019, 0xFC00 (P, Simple Descriptor) |
| 2 | it600WC wiring centre | 8 | 0x0104 | in: 0x0000, 0xFC00; out: includes 0x0019, the OTA client (P, zigbee2mqtt interview) |
| 3 | Salus gateway (coordinator) | 1 | 0x0104 | FC00 traffic is addressed to endpoint 1 (P) |

Further device facts:

1. The thermostat is a sleepy end device: its MAC capability is 0x80, and it is battery powered.
   Paired thermostats poll their parent about every 7 s. The new thermostat polled every 0.25–0.8 s
   for at least 2 min after joining (P).
2. Both devices identify with manufacturer code 0x1078 (Computime) and IEEE OUI 00:1e:5e (P).
3. The thermostat's Basic `modelId` is `SQ610RFNH`; the wiring centre's `manufacturerName` is
   `Computime` (P).
4. Joining uses the default TC link key `ZigBeeAlliance09`, with no install code (P: the capture
   decrypts with it).
5. The wiring centre sends a ZDO Match Descriptor for an OTA server at boot, as the thermostat does
   after joining (section 3, row 6) (P). zigbee2mqtt matches it to the zigbee-OTA image
   SAL6DW1_20230222, the version it already runs (P). Whether it takes a transfer is untested (I).

## 2. Frame format

All manufacturer traffic is ZCL on cluster **0xFC00**, profile 0x0104, manufacturer code
**0x1078**, with an APS ack requested.

| Byte | Field | Value | Mark |
|---|---|---|---|
| 0 | ZCL frame control | `0x1D` from the thermostat and from the gateway: cluster-specific, manufacturer-specific, direction server→client, default response disabled. `0x15` from the wiring centre: same, but direction client→server. | P |
| 1–2 | Manufacturer code | `78 10` (0x1078 LE) | P |
| 3 | TSN | Sender's ZCL sequence number; the gateway uses one counter for all its ZCL frames to a device | P |
| 4 | Command | See table below | P |
| 5.. | Payload | Per command | |

Command map:

| Cmd | Direction | Meaning | Mark |
|---|---|---|---|
| 0x10 | device → coordinator | Sync request (greeting) | P |
| 0x81 | coordinator → device | Sync response: device number, time and time zone | P |
| 0x37 | wiring centre → coordinator | Acknowledges an accepted 0x81, payload `11 00 00` (section 4.3) | P |
| 0x16 / 0x86 | device → coordinator / coordinator → device | Get wiring centre: request with a number, answer with its short address (section 4.3) | I (gateway code, not seen on air) |
| 0x30 | coordinator → thermostat | Record request (refresh), payload `00 30` | I (gateway cfg only, not seen on air) |
| 0x31 | thermostat → coordinator | Status/settings record, 77 bytes | P |
| 0x32 | coordinator → device | "B-command" write | P |
| 0x33 | device → coordinator | B-command echo or report | P |
| 0x12 | thermostat → wiring centre | Zone temperature/setpoint report | P |
| 0x18 / 0x88 | thermostat → WC / WC → thermostat | Zone pairing request / ack | P |
| 0x14 / 0x84 | thermostat → WC / WC → thermostat | Zone pairing confirm / done | P |
| 0x1a | wiring centre → coordinator | Replaced thermostat: payload `01 00 <short address, uint16 LE>` of the thermostat whose zone a pairing with the replace flag took over (sections 7.4 and 7.6) | P |
| 0xA9 | wiring centre → coordinator | Empty payload. Seen once, about 15 s before the network leave of a factory reset (section 7.5); probably the Pair button | I |

The three zone frames 0x12, 0x18 and 0x14 also work from the coordinator in the thermostat's place
(section 7.6).

## 3. Join and greeting sequence

This is what the new thermostat did after joining, with time offsets from the Device Announce.
Rows 1–2 are a normal interview by the gateway; rows 3–9 are the thermostat's own greeting.

| # | t (s) | Frame | Notes |
|---|---|---|---|
| 1 | 0.00 | ZDO Device Announce | capability 0x80 |
| 2 | 0.04–0.40 | Gateway: Active Endpoints, Simple Descriptor (ep 9), Basic read `modelId` | standard interview |
| 3 | 2.56 | Thermostat → coordinator ep 1: **FC00 0x10** sync request | |
| 4 | 2.93 | Thermostat: ZDO **Node Descriptor Request** for 0x0000 | The coordinator's reply carries manufacturer code **0x1078** |
| 5 | 3.12 | Coordinator → thermostat: **FC00 0x81** sync response | 555 ms after the request |
| 6 | 3.19 | Thermostat: ZDO Match Descriptor (profile 0x0104, in-cluster 0x0019 OTA) | Coordinator answers with ep 1 |
| 7 | 3.24 | Thermostat reads the **coordinator's** Basic attr 0x0005 (`modelId`) | Gateway answers `SAU2AG1` |
| 8 | 3.43–7.52 | Thermostat sends FC00 0x31 records 0x75, 0x76, 0x72, then 0x71 | Status starts flowing |
| 9 | 5.22 | Thermostat: OTA Query Next Image (mfg 0x1078, image type 0x007A, file version 0x00000050) | Gateway answers with a Default Response |

Coordinator identity checks (**U**): the thermostat firmware contains a list of Salus gateway
model IDs (SAU2AG1, SAL3AG1, CTLG630, …). Rows 4 and 7 show it reads both the coordinator's
manufacturer code and its `modelId` during the greeting. Whether a mismatch blocks anything is not
known. A non-Salus coordinator should answer:

- the Node Descriptor with manufacturer code 0x1078;
- the Basic `modelId` read with `SAU2AG1` (ZCL string, `42 07 53 41 55 32 41 47 31`).

That is the safe assumption until a test proves otherwise.

On zigbee2mqtt the `modelId` answer is already in effect. zigbee-herdsman answers a device's Basic
reads from the attribute defaults of the cluster definition, and the converter's `genBasic`
definition defaults `modelId` to `SAU2AG1` (and `manufacturerName` to `Computime`), so the
thermostat is told `SAU2AG1` there. What is open is only whether it needs that at all (**U**): no
run has answered anything else. The Node Descriptor cannot be set from a converter (the known risk
in the converter's header).

## 4. Sync request (0x10) and sync response (0x81)

### 4.1 Request, thermostat → coordinator

Example payload: `ff 42 ff 50 00 00 00`

| Byte | Field | Mark |
|---|---|---|
| 0 | Device number the device holds now, `0xFF` while it has none (section 4.3) | P |
| 1 | Device type, 0x42 = 66 (gateway JSON `DeviceSubType` 66) | P |
| 2 | `0xFF` | U |
| 3–6 | Firmware version, uint32 LE: 0x00000050 (gateway JSON `FirmwareVersion` / `SyncResponseVersion_d` "00000050") | P |

### 4.2 Response, coordinator → thermostat

The response is 15 bytes. It was sent twice in the capture:

```
20 00 aa f7 63 32 03 0e 01 ff ff ff ff 31 00
20 00 da f7 63 32 03 0e 01 ff ff ff ff 31 00   (47.97 s later; the time field is +48)
```

| Byte | Field | How to build it | Mark |
|---|---|---|---|
| 0 | **Device number** | The number the coordinator assigns; the gateway copies it from its device record. It was 0x20 in both frames, and the gateway JSON shows `DeviceIndex` 32 for every SQ610RFNH. Send 0x20 to a thermostat and 1 to a wiring centre (section 4.3). | **P** (0x20 thermostat, 1 wiring centre), I (the record copy) |
| 1 | Status | 0x00 normal. The gateway code sends 0x01 (with no further fields) in an alternative path, probably "device not registered". | I |
| 2–5 | **Local time** (not UTC, unlike the ZCL Time cluster), uint32 LE, seconds since **2000-01-01 00:00 local** | `unix_utc − 946684800 + tz_offset_s + (dst_active ? dst_hours × 3600 : 0)` | P: both frames decode to wall-clock CEST minus 24 s; the gateway clock ran slow and its log shows NTP failures. The formula is from the gateway code. |
| 6 | Flags: bit 0 = DST currently active, bit 1 = 24-hour clock | 0x03 = DST active + 24 h | I (code: `TimeFormat24Hour << 1 \| dst_active`; value matches) |
| 7 | Time-zone index (table below) | 0x0E = 14 = UTC+1 | P (gateway table lookup gives 14 for 3600 s) |
| 8 | DST offset in hours | 0x01 | I |
| 9–10 | Short ID of paired receiver RX1, `ff ff` if none | `ff ff` | I (code: `GetReceiveShortID(8)`) |
| 11–12 | Short ID of paired receiver RX2, `ff ff` if none | `ff ff` | I (code: `GetReceiveShortID(9)`) |
| 13 | Cloud online flag, ASCII `'1'` (0x31) or `'0'` (0x30) | 0x31 | I (code: `'0' + online`) |
| 14 | 0x00 | | U (not written by the builder; zero) |

Time-zone index, from the gateway's `zigbee_device_timezone.ini`, as UTC offset in seconds:

| Index | Offset (s) |
|---|---|
| 0–12 | −46800, −43200, −39600, −36000, −32400, −28800, −25200, −21600, −18000, −14400, −10800, −7200, −3600 |
| 13–27 | 0, 3600, 7200, 10800, 14400, 18000, 21600, 25200, 28800, 32400, 36000, 39600, 43200, 46800, 50400 |
| 28–41 | −34200, −16200, −12600, −11220, 12600, 16200, 19800, 20700, 23400, 31500, 34200, 37800, 41400, 45900 |

The time zone is the **standard** offset; DST is carried separately in bytes 6 and 8. Europe/Copenhagen
in summer is index 14 with DST 1, so local time is UTC+2.

The gateway also sends 0x81 without a new 0x10. In the capture this happened during zone pairing,
0.55 s after the B47 pairing command. A converter can answer every 0x10 and may resend
0x81 periodically to keep the clock right. The converter in this repo resends it with the first 0x71
after it starts, then once a day and whenever the local offset from UTC changes, so that summer time
follows (I, not tested yet).

Example response for 2026-10-15 20:44:26 CEST:

```
ZCL: 1d 78 10 <tsn> 81  20 00 aa f7 63 32 03 0e 01 ff ff ff ff 31 00
```

### 4.3 Device number and the wiring centre

Byte 0 of the 0x81 is the device number the coordinator assigns. Byte 0 of every 0x10 carries the
number the device holds now, `0xFF` while it has none (P).

1. **Numbers.** A thermostat got 0x20 in every capture (P). The gateway code gives a wiring centre
   the first free slot of 1–9 (I). The converter in this repo supports one wiring centre, gives it
   number 1 and does not assign 2–9.
2. **A wiring centre keeps the first number it receives** and ignores later ones until a factory
   reset (P). Ours was given 0x20 first, and its 0x10 from then on always started with 0x20. After
   a factory reset and a 0x81 with 0x01 it started with 0x01.
3. **Zone pairing needs a valid number.** Holding 0x20, the wiring centre answered every 0x18 zone
   request with 0x88 status 01 (section 7.2). Holding 1, it answered status 00 and the pairing
   completed (P). B47 bytes 2–3 made no difference (section 7.1): the refusal came from the wiring
   centre's own number.
4. **Acknowledgement.** A wiring centre that accepts a 0x81 answers with FC00 **0x37**, payload
   `11 00 00` (P; the meaning of the bytes is U). It came with the Salus gateway as coordinator,
   and with zigbee2mqtt once the number was 1. It did not come while the wiring centre held 0x20.
5. **Get wiring centre, 0x16 / 0x86 (I: gateway code `CT_It600DeviceCommand_HandleGetWCRequest`,
   not seen on air).** A device sends FC00 0x16 with the payload `<number>`, the number of the
   wiring centre it wants. The gateway answers with FC00 0x86, sent in the direction of 0x81, with
   `01 <short address, uint16 LE>` if it knows a wiring centre with that number, else `00 ff ff`.
   The converter remembers the wiring centre it greeted as number 1, also after zigbee2mqtt has
   restarted, reads its short address when asked, and answers `00 ff ff` for any other number.
   What makes a device send 0x16 is U.

## 5. Status records (0x31)

The thermostat pushes records as cmd 0x31 to coordinator ep 1. Every record is **77 bytes**:
byte 0 is the record type and byte 1 a per-type report counter (P). After the greeting it sent 0x75, 0x76, 0x72 and 0x71. After that it sent 0x71 whenever
something changed, every 5–25 s while being set up, and every 2–7 min once settled.

The six paired thermostats sent one 0x71 between them in 19 minutes. They report sparsely when
idle; the trigger is unknown (**U**). Their regular heartbeat is the 0x12 report to the wiring
centre (section 7.3), which does not reach the coordinator.

The gateway stores 0x71 as `Status_d` and 0x72 as `Status_2_d` (also `Schedule`). It sets bit 7 of
byte 0 (`f1`, `f2`) when a record carried no change; that is a gateway artefact, not on air (I, code).

### 5.1 Encodings

- **BCD x100**: two bytes, four BCD digits, value × 100. `22 90` = 22.90 °C. A first nibble ≥ 0xB
  gives raw ≥ 11000, which encodes a negative value as `11000 − raw` (`b5 00` = −5.00)
  (P for positive values; negative values from code).
- **Humidity**: one BCD byte, `53` = 53 % (P).

### 5.2 Record 0x71: live status (`Status_d`)

Ground truth: 7 devices, each record compared field by field with the JSON parsed from it.

| Byte | Field | Encoding | Mark | Evidence |
|---|---|---|---|---|
| 0 | Record type 0x71 | | P | |
| 1 | Report counter | uint8 | P | Increments per report; it matches the stored `Status_d` counter (e.g. 164 on one thermostat, 16 on the new one) |
| 2 | Status code | 0x0D or 0x0E | U | 0x0E before WC pairing, 0x0D after. Gateway maps low nibble D→0, E→2, other→1 into an unnamed field. |
| 3 | **HoldType** | 0 schedule, 1 temporary hold, 2 permanent hold, 6 away, 7 standby (off), 10 eco | **P** for 2 and 7, I for 0, 1, 6 and 10 | 07 on 6 devices, 02 on 1, matches JSON. 0 and 6 are the B20 arguments `schedule` and `away`, written on air and echoed (section 6.3), but byte 3 afterwards is not recorded here. 1 and 10 have not been seen (1 is what the gateway sets after a setpoint change in schedule mode, section 6.3). |
| 4–5 | **LocalTemperature** | BCD x100 | **P** | 2290, 2370, 2340, 2180, 2350, 2340, 2800 all match. Rounded to the display resolution, 0x72 byte 11: 0.1 °C on the paired units, 0.5 °C on the new one. The 0x12 report carries 0.01 °C. For the placeholder `12 34` and the offset see the notes below the table. |
| 6–7 | External/floor sensor temperature | BCD x100 | I | Read only when `OUTSensorProbe` is 1 or 2 (gateway and HA client); `00 00` here |
| 8 | Unknown | | U | 0x01 on all |
| 9–10 | **Active setpoint** (`HeatingSetpoint_x100` in heat mode, `CoolingSetpoint_x100` in cool mode) | BCD x100 | **P** | 1500 ×6, 2100, then 2800 after the app change. The heating and cooling setpoints are stored separately and byte 15 says which one is shown here: in cool mode the bytes showed 21.00, then 30.00 after `B33 5c`, and back in heat mode they showed the heating setpoint 21.00. |
| 11–12 | **Schedule heating setpoint** (`AutoHeatingSetpoint_x100`) | BCD x100 | **P** | 1900, 2300, 2150, 2100, 2150, 2100, 2100 |
| 13–14 | Schedule cooling setpoint (`AutoCoolingSetpoint_x100`) | BCD x100 | I | 2400 on all 7 |
| 15 | **SystemMode** | 4 heat, 3 cool | **P** | 04 on all. `B48 03` made it 03 and `B48 04` made it 04 again in the next 0x71 of a real thermostat. The gateway treats 3/4 as cool/heat when choosing write commands |
| 16 | Unknown, changes with demand | | U | 00 idle, 04 while heating |
| 17 | **RunningState** (0 idle, 1 heating) | uint8 | **P** | 00 on 7 idle devices, 01 at setpoint 28 °C; JSON `RunningState` 0 / 1 |
| 18–21 | Error flags | Four ASCII hex digits; bits 0–3 of each byte are flags, `'0'` (0x30) = none | I | Gateway decodes 16 flag bits; mapping to `ErrorNN` unknown. Manual p65–67 numbers 32 errors; the thermostat's display shows them as text, not numbers |
| 22 | Unknown boolean | | U | 00 |
| 23 | **LockKey** | 0/1 | **P** | B03 lock (`00 00 41`) and unlock (`00 00 42`) on air were followed by byte 23 = 1 and 0 (section 6.3). The static match alone (1 ×6, 0 ×1, JSON LockKey) was not enough: CoolingControl has the same values on these devices. The gateway code agrees: its LockKey write updates the field decoded from this byte. |
| 24 | **Humidity** | BCD % | **P** | 53, 53, 53, 56, 52, 52, 47 all match |
| 25 | Unknown | 0x04; gateway maps 1/2/3/14/15 → 101–105, else value−3 | U | 0x00 before WC pairing, 0x04 after |
| 26–37 | Paired TRV short IDs, 6 × 2 bytes | `ff ff` = empty | I | JSON `PairedTRVShortID` "FFFF…" (24 hex chars) |
| 38 | TimeFormat24Hour | 0/1 | I | 01 on all; the B21 write targets it |
| 39 | Unknown, changes with demand | | U | 00 idle (04 on one unit), 06 while heating |
| 40–41 | Unknown; possibly battery voltage BCD (`03 87` ≈ 3.87 V) | | U | Ranks with BatteryLevel: ≥4.00 → level 5, ≤3.87 → level 4 |
| 42 | Unknown | | U | 00 before WC pairing, 06 after, 01 while heating |
| 43–44 | **Frost (standby heating) setpoint** | BCD x100 | **P** | 1500 / 500. A B11 write of 7.00 to 0x72 bytes 6–7 showed here (and in bytes 9–10 while the thermostat was off). In standby the gateway shows this as the heating setpoint. |
| 45–46 | Standby cooling setpoint | BCD x100 | I | 4050 on all |
| 47–48 | Unknown | | U | `00 01` |
| 49 | **BatteryLevel** | 0–5 | **P** | 5, 4, 5, 5, 5, 4, 4 all match. Same as `Status_d[99]` in the HA client. |
| 50 | LQI | uint8 | I | 0xFF; the gateway copies it to `LastMessageLQI_d` |
| 51 | RSSI | int8 dBm | I | −36 vs gateway's −38 for the same device |
| 52–76 | Unknown | | U | Bytes 54 and 66–76 differ between devices |

Notes on 0x71:

1. **Placeholder temperature (P).** The thermostat sends a 0x71 whose bytes 4–5 are `12 34` about
   every 5 minutes (159 times in 11 hours on one thermostat), also without a B74. 12.34 °C is not a
   multiple of the 0.1 or 0.5 °C display resolution, so it is a placeholder and not a reading. The
   other fields of such a record (setpoint, humidity, running state, hold type, lock, battery)
   matched a neighbouring record in every case, so a converter leaves out the temperature and keeps
   the rest. In the three raw records seen, byte 68 was 02 where the 24 others had 01 (U).
2. **Offset (U).** After the room-temperature offset (0x72 bytes 3–4, section 5.3) was changed with
   B11, bytes 4–5 of the 0x71 did not change within 2 minutes. It is unknown whether 0x71 reports
   the raw sensor reading or the calibrated one.

### 5.3 Record 0x72: settings (`Status_2_d`)

Record 0x72 holds every setting of the thermostat's user and admin menus. The thermostat sends it
after the greeting and on a B74 request (P). After a B11 write it sent none by itself (P), so a
writer has to ask with B74. The firmware keeps a copy of the settings and should also send a 0x72
when one is changed in its own menu (I, firmware; not tested). The same layout is the payload of
the B11 settings write (section 6.4).

Ground truth: the gateway JSON of the 6 paired thermostats, the factory record of the new
thermostat (captured three times), and the firmware's default table. The 6 paired units share one
record except bytes 1, 22 and 40–41.

A 0x72 from a thermostat on factory settings, bytes 0–47 (report counter 7, no PIN; bytes 48–74 are
`ff` and 75–76 `00 00`):

```text
72 07 01 00 00 01 05 00 40 50 00 00 00 01 04 00 27 00 10 00 06 00 35 00 05 00 40 00 05 00
01 00 00 00 01 01 80 00 00 00 0d fe 00 00 00 00 01 00
```

Bytes 40–41 `0d fe` are the no-PIN value 0xFFFF scrambled with counter 7 (note 2).

Encodings:

1. **BCD x100**: as in 0x71, `27 00` = 27.00 °C.
2. **Signed BCD x100** (byte 3–4 only): bit 7 of the first byte is the sign, the rest is BCD:
   `00 50` = +0.50, `80 50` = −0.50. This differs from the 0x71 negative encoding (11000 − raw).
3. **BCD integer**: `01 80` = 180.
4. **Flag**: 0 or 1.

The "Range" column is the firmware's clamp when it loads settings; the B11 parser itself does not
range-check (except byte 15), so a converter must.

| # | Byte | Setting (app label) | Encoding | Values and UI names | Range | Default | Paired units | Mark | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | Record type 0x72 | | | | | | P | |
| 2 | 1 | Report counter. Also the key of the PIN obfuscation, bytes 40–41 | uint8 | | | | | P | Increments per report on air. Key of the PIN scrambling: note 2 |
| 3 | 2 | Display time on the LCD | flag | 0 hide, 1 show | 0–1 | 1 | 1 | I | App order; in the user-settings group (reset by B03 arg5) |
| 4 | 3–4 | Measured temperature calibration (room-temperature offset) | signed BCD x100 | e.g. `80 50` −0.50 °C | −3.50 – +3.50 | 0 | 0 | P (bytes, write), I (range), U (effect on the reading) | Only signed field; the B11 parser negates on bit 7. B11 writes of `00 50` and `80 50` were read back in the next 0x72. The 0x71 temperature did not follow (note 2 under section 5.2). Range: manual p58 (device menu) −3.5 to +3.5 °C, and the firmware's menu editor for it runs from −3.50 to +3.50 in 0.10 °C steps. The app offers −3.0 to +3.0 in 0.5 °C steps (manual p39). |
| 5 | 5 | Display humidity on the LCD. **Gateway JSON calls this `HeatingControl`** | flag | 0 hide, 1 show | U | 1 | 1 | P (gateway mapping), I (meaning) | JSON `HeatingControl` 1 = byte 01 on all 7; app order; user-settings group |
| 6 | 6–7 | **Standby temperature for heating** (frost setpoint, `FrostSetpoint_x100`) | BCD x100 | °C | 5.00 – 35.00 | 5.00 | 15.00 | **P** (byte), I (range) | 15.00 ×6, 5.00 ×1; equals 0x71 bytes 43–44 and 0x12 bytes 16–17 on all 7. The gateway JSON has no frost field for this model. A B11 write of 7.00 showed in 0x71 bytes 43–44 and 9–10 while the thermostat was off. Range: manual p59, 5–35 °C. The firmware's menu editor bounds it by the heating setpoint limits (bytes 22–25), capped at 35.00, and allows one 0.5 °C step below a minimum of 5.00; what the display shows at 4.50 is U. |
| 7 | 8–9 | Standby temperature for cooling | BCD x100 | °C | 5.00 – 40.50 | 40.50 | 40.50 | I | Equals 0x71 bytes 45–46 on all 7 (one value only). Range: manual p59, 5–40 °C; not available with TRVs or an RX10RF. The firmware's menu editor bounds it by the cooling setpoint limits (bytes 26–29) and allows one 0.5 °C step above a maximum of 40.00, which is how the factory 40.50 is reachable; what the display shows there is U |
| 8 | 10 | Temperature scale | uint8 | 0 Celsius, 1 Fahrenheit | U | 0 | 0 | I | App order; firmware validates it separately. The firmware's admin menu shows CELSIUS for 0 and FAHRENHEIT otherwise; manual p61 default °C |
| 9 | 11 | **Display temperature resolution. Gateway JSON calls this `CoolingControl`** | flag | 0 = 0.5 °C, 1 = 0.1 °C | 0–1 | 0 | 1 | **P** | 1 on the 6 paired units, which report 0.1 °C steps; 0 on the new unit, which reports 0.5 °C steps; JSON `CoolingControl` = byte on all 7. A B11 `'s'` write of 1 on 7 thermostats that had come back from a factory reset at 0 was read back as 1, and their temperatures then came in 0.1 °C steps (zigbee2mqtt) |
| 10 | 12 | **Heat control algorithm** | uint8 | 0 ITLC UFH, 1 ITLC RAD, 2 ITLC ELECT, 3 SPAN ±0.25 °C, 4 SPAN ±0.5 °C, 5 THB ACTUATOR (note 1) | 0–5 | 0 | 0 | P (byte, write), I (names) | Clamp 0–5; app: 0 "ITLC for Underfloor", 1 "ITLC for Radiators", 2 "ITLC for Electrical Heating", 5 "THB Actuator". B11 `'s'` writes of 1 and 5 were read back in the next 0x72. 0 is the factory value. Names: the firmware's admin menu, which agrees with the app and with the option order and default of manual p61 |
| 11 | 13 | Cool control algorithm | uint8 | 1 SPAN ±0.25 °C, 2 SPAN ±0.5 °C | 1–2 | 1 | 1 | I | The firmware's admin menu shows COOL CONTROL from this byte: SPAN ±0.5 for 2, SPAN ±0.25 for anything else (note 1). Manual p61: these two options, default ±0.25, which matches the factory 1 |
| 12 | 14 | TRV advanced calibration | uint8 | 3 OFF, 4 AUTO SELECT, 5 ON | 3–5 | 4 | 4 | I | The firmware's admin menu shows CALIBRATION from this byte: AUTO SELECT for 4, OFF for 3, ON otherwise. It skips its self-learning loop when this is 3. Manual p61–62: OFF / AUTO SELECT / ON, default AUTO SELECT, only with TRVs paired |
| 13 | 15 | S1/S2 input (`OUTSensorProbe`) | uint8 | 0 none, 1 floor sensor, 2 external sensor, 3 occupancy sensor, 4 OneTouch, 5 changeover | hardware bitmask | 0 | 0 | P (0), I (values) | JSON 0 = byte 0 on all 7. Menu order FLOOR/EXT/OCCUP SENSOR, ONE TOUCH, CHANGEOVER; firmware treats 1–2 as temperature probes (0x71 bytes 6–7) and blocks B48 when 5 |
| 14 | 16–17 | Maximum floor temperature for heating | BCD x100 | °C | floor min + 0.5 – 80.00 | 27.00 | 27.00 | I | Firmware clamp pairs it with bytes 18–19; app order |
| 15 | 18–19 | Minimum floor temperature for heating | BCD x100 | °C | 0 – floor max − 0.5 | 10.00 | 10.00 | I | As above |
| 16 | 20–21 | Minimum floor temperature for cooling | BCD x100 | °C | 0–80.00 | 6.00 | 6.00 | I | App order |
| 17 | 22–23 | **Maximum heating setpoint** (`MaxHeatSetpoint_x100`) | BCD x100 | °C | min + 0.5 – 40.00 | 35.00 | 25.00 / 40.00 | **P** | JSON 2500 ×5, 4000 ×1, 3500 new. A B34 outside min–max is ignored (I, firmware, not tried on a device); for B31 see section 6.3 (U). |
| 18 | 24–25 | **Minimum heating setpoint** (`MinHeatSetpoint_x100`) | BCD x100 | °C | 5.00 – max − 0.5 | 5.00 | 15.00 | **P** | JSON 1500 ×6, 500 new |
| 19 | 26–27 | Maximum cooling setpoint (`MaxCoolSetpoint_x100`) | BCD x100 | °C | min + 0.5 – 40.00 | 40.00 | 40.00 | P | JSON 4000 on all 7 (one value). Manual p63 gives one default, 35 °C, for the heating and the cooling maximum; the firmware's default and these units have 40.00 |
| 20 | 28–29 | Minimum cooling setpoint (`MinCoolSetpoint_x100`) | BCD x100 | °C | 5.00 – max − 0.5 | 5.00 | 5.00 | P | JSON 500 on all 7 (one value) |
| 21 | 30 | Valve protection | flag | 0 off, 1 on | 0–1 | 1 | 1 | I | Gates a periodic valve-exercise timer in the firmware; app order |
| 22 | 31 | Internal relay | uint8 | 0 disabled, 1 heat and cool, 2 heat only, 3 cool only | 0–3 | 0 | 0 | I | App labels `internalRelay.disabled/enabled01–03`; app order |
| 23 | 32 | Relay type | uint8 | 0 NO-COM, 1 NC-COM (menu order) | 0–1 | 0 | 0 | I | App order |
| 24 | 33–34 | Minimum off time for heating | BCD integer | units U (menu says SECOND) | 0–999 | 1 | 1 | I | App order |
| 25 | 35–36 | Minimum off time for cooling | BCD integer | seconds | 0–300 | 180 | 180 | I | App order. Manual p63: range 0–999 for both off times, defaults 1 and 180, no unit; the firmware clamps this one at 300 |
| 26 | 37 | Optimum start | flag | 0 off, 1 on | 0–1 | 0 | 1 | I | App order |
| 27 | 38 | Optimum stop | flag | 0 off, 1 on | 0–1 | 0 | 1 | I | App order |
| 28 | 39 | Comfort warm floor | uint8 | 0 off, 1–3 level | 0–3 | 0 | 0 | I | Firmware: level 1/2/3 sets a timer of 0x2c/0x3c/0x4c |
| 29 | 40–41 | PIN code, obfuscated with byte 1 | see note 2 | 0xFFFF = no PIN | | FFFF | | P (no PIN), I (PIN set) | B11 parser decodes it with the counter it receives. The no-PIN formula held in 9 B11 writes (note 2) |
| 30 | 42 | Language | uint8 | 0 ENGLISH, 1 DANSK, 2 POLSKI, 3 DEUTSCH, 4 FRANCAIS, … (27 values, app list) | 0–26 | 0 | 0 | I | Firmware selects string table base + 1000 × value |
| 31 | 43 | PIN enabled (read). Gateway JSON calls this `OUTSensorType` | flag | | 0–1 | 0 | 0 | I | On a B11 write this byte goes to a different flag; copy it unchanged |
| 32 | 44 | Always 00 | | | | | | I | Builder writes 0 |
| 33 | 45 | Display floor temperature on the LCD | flag | 0 hide, 1 show | 0–1 | 0 | 0 | I | Firmware clears it unless byte 15 = 1; user-settings group |
| 34 | 46 | Unknown | flag | | 0–1 | 1 | 0 | U | Written only by B11 's' |
| 35 | 47 | Unknown | flag | | 0–1 | 0 | 0 | U | Written only by B11 's' |
| 36 | 48–74 | Unused | `ff` | | | | | P | |
| 37 | 75–76 | Cloud override | 2 × uint8 | each 1–200, or both 0 | | 0 0 | 0 0 | I | Set by BA1; gateway reads them as uint16 BE (`CloudOverride` 0) |

Note 1, control algorithm values: the firmware's string table has seven labels, ITLC UFH, ITLC RAD,
ITLC ELECT, SPAN ±0.25, SPAN ±0.5, SPAN ±1.0 and THB ACTUATOR, for six values (clamp 0–5). The
admin menu's display code in the 0x54 image settles it (I, firmware): heat values 0–2 show the ITLC
labels, 3 shows SPAN ±0.25, 4 SPAN ±0.5 and 5 THB ACTUATOR. With the scale (byte 10) on Fahrenheit,
3 shows SPAN ±0.5 and 4 SPAN ±1.0: the same spans in °F, as manual p61 lists them (±0.5 °F, ±1 °F).
So SPAN ±1.0 is a Fahrenheit label and not a seventh value. This agrees with the app's label for 5
and with the manual's order. The cooling span is byte 13 (1 = ±0.25 °C, 2 = ±0.5 °C, same °F
labels); byte 14 is TRV advanced calibration. The labels on a real display are still to be read:
write each value with B11 and look at the admin menu.

Note 2, PIN obfuscation: the record carries `b40 = (pin >> 8) + 2·b1` and `b41 = (pin & 0xFF) − (b1 >> 2)`,
both mod 256, where `b1` is byte 1. The B11 parser inverts this with the byte 1 it receives. So "no
PIN" (0xFFFF) means `(b40 − 2·b1) mod 256 = 0xFF` and `(b41 + (b1 >> 2)) mod 256 = 0xFF`.

1. **No PIN (P).** The thermostat's own reports fit the formula, and it held in 9 B11 writes that
   sent `b1 = 01, b40–41 = 01 ff`. That triple decodes to no PIN whatever counter the thermostat
   has, and the thermostat stayed at no PIN each time.
2. **Gateway records (U).** The gateway's stored records for five paired units carry counter 0 with
   `01 ff`, which decodes to 0x01FF: a PIN, or a stale counter in the gateway's copy.
3. **A PIN that is set (I).** Neither writing nor reading back a real PIN has been tried. A writer
   must send bytes 1, 40, 41 and 43 exactly as last reported; the converter in this repo does not
   write at all then.

Fields **not** in 0x72: time format (0x71 byte 38, B21), a probable DST flag, system mode (0x71
byte 15, B48) and key lock (0x71 byte 23, B03). Those three and bytes 2–9 and 45 above form the
firmware's "user settings" block, which B03 arg5 = `'1'` resets (section 6.3).

### 5.4 Records 0x75 and 0x76

| # | Record | Content | Mark |
|---|---|---|---|
| 1 | 0x75 | All `ff` after the header; stored verbatim as `IRConfig` | P (stored), U (meaning) |
| 2 | 0x76 | `76 00 01 f4 00 ff… 02 ff…`; 0x01F4 = 500 | U; not parsed by the gateway |

### 5.5 Polling (not observed on air)

The gateway's `SQ610RFNH.cfg` defines two polls:

1. `refresh` / `reboot`: FC00 cmd 0x30 with payload `00 30`, expecting a cmd 0x31 reply.
2. ZCL Read Attributes on cluster **0xFC09** ep 9, attributes 0x8000–0x8006, one per frame.

Neither appeared in the capture: the thermostat pushed everything unprompted. Seven attributes
match seven record types (0x70–0x76), so FC09 0x800N probably returns record 0x7N (**I**).

## 6. B-commands (0x32 write, 0x33 echo)

### 6.1 Envelope

```
0x32 payload: <handle> 'B' <d1> <d2> <args...>
0x33 payload: same bytes echoed by the device
```

| # | Element | Mark |
|---|---|---|
| 1 | `handle`: one byte from a gateway-global counter (07, 08, 09 in the capture). Echoes are matched on it. | P (observed), I (code) |
| 2 | The 3-character ASCII code, e.g. `B34`, then the arguments. | P |
| 3 | The thermostat echoes the whole payload as 0x33 within ~100 ms of receiving it. It also sends later 0x33 updates with the same handle when a long operation progresses (B47). | P |
| 4 | Retry policy in `SQ610RFNH.cfg`: repeat every 15 s, up to 3 times. | I |
| 5 | The thermostat sleeps, so writes wait in its parent's indirect queue until it polls: about every 7 s when settled, under 1 s right after joining. A converter must allow for that latency; the one in this repo waits up to 30 s for the echo (section 10). | I |
| 6 | The gateway stores the last echo as `sIT600I.CommandResponse_d`, without the handle. | P |

### 6.2 Setpoint byte encoding

`byte = setpoint_x100 / 50 + 0x20`, i.e. 0.5 °C steps offset by 32. The gateway first rounds to
the nearest 0.5 °C.

| # | Setpoint | Byte |
|---|---|---|
| 1 | 5.0 °C | 0x2A |
| 2 | 15.0 °C | 0x3E |
| 3 | 21.0 °C | 0x4A |
| 4 | 21.5 °C | 0x4B |
| 5 | 35.0 °C | 0x66 |

### 6.3 Command table

Each row gives the JSON property the gateway converts, then the command it emits. Marks: P = seen
on air or in ground truth; I = from `Transfer_Set_Thermostat_Properties` or from the thermostat
firmware's dispatcher, which knows B20, B21, B22, B30–B34, B36, B47, B48, B01–B03, B05, B06, B11,
B74 and BA1. Of these, B22, B32, B01, B02, B05 and B06 are recognised and echoed but have no
handler in the main dispatcher (**U**: ignored, or handled elsewhere).

| Code | Args | JSON property | Condition in gateway | Mark |
|---|---|---|---|---|
| **B34** | 1 setpoint byte | `SetHeatingSetpoint_x100` | Only if SystemMode is heat (4). In schedule mode (HoldType 0) a value ≠ schedule setpoint switches HoldType to 1. | **P**: two stored echoes match JSON. `42 33 34 3e` = 15.0 °C (HeatingSetpoint 1500), and after the app change to 28 °C, `42 33 34 58` = 28.0 °C (HeatingSetpoint 2800, then 0x71 bytes 9–10 = `28 00`). On air: `0b 42 33 34 42` = 17.0 °C, `0c 42 33 34 4b` = 21.5 °C, `0d 42 33 34 2a` = 5.0 °C, each echoed as 0x33 within 70 ms and followed by a 0x71 with the new setpoint. Lowering the setpoint below room temperature also sent an immediate 0x12 to the wiring centre with demand 00. |
| **B33** | 1 setpoint byte | `SetCoolingSetpoint_x100` | Only if SystemMode is cool (3). Firmware: ignored unless system mode is cool and the value is within min/max cooling setpoint (0x72 bytes 26–29). | **P**: `B33 5c` = 30.0 °C in cool mode was echoed and the next 0x71 showed 30.00 in bytes 9–10. |
| B31 | 1 setpoint byte | `SetAutoHeatingSetpoint_x100` (schedule heat setpoint, 0x71 bytes 11–12) | heat mode. A value outside min/max heating setpoint (0x72 bytes 22–25) is either clamped or ignored: both readings of the firmware exist (B34 is read as ignored, section 5.3), and it has not been tried on a device. | I (command), **U** (out of range) |
| B30 | 1 setpoint byte | `SetAutoCoolingSetpoint_x100` (0x71 bytes 13–14) | cool mode. Out of range as for B31 (min/max cooling setpoint, 0x72 bytes 26–29). | I (command), **U** (out of range) |
| **B20** | 1 raw byte | `SetHoldType`: 0 schedule, 1 temporary, 2 permanent, 7 standby (off) | none | **P** on air: `B20 07` off, `B20 02` permanent, `B20 00` schedule, `B20 06` away, each echoed. Turning on from off is `B20 02` followed by `B48 04`. |
| **B21** | 1 raw byte | `SetTimeFormat24Hour` | none | **P**: `09 'B21' 01` seen on air and echoed. The gateway sent it 30 s after zone pairing as part of setup. |
| B22 | 1 raw byte | `SetAllowUnlockFromDevice` | none. Firmware: recognised, no handler found. | I (gateway), U (effect) |
| B36 | 24 ASCII chars, space-padded (payload `B36` + 24 bytes) | `SetPairedTRVShortID` | none | I |
| **B48** | 1 raw byte | `SetSystemMode` (3 cool, 4 heat) | none | **P**: `B48 04` on air, sent right after `B20 02` when switching on. `B48 03` (cool) and `B48 04` (heat) were each echoed and the next 0x71 showed byte 15 = 3 and 4. |
| **B03** | `'B' '0' '3' 00 00 X` + 10 × 00, X = `'B' − value` (`'E'` for 99, `'F'` for 98) | `SetLockKey` | none | **P**: lock `00 00 41`, unlock `00 00 42` on air, each echoed; status byte 23 followed (1 locked, 0 unlocked). Firmware: arg2 `'A'` locks, `'B'` unlocks, anything else leaves the lock alone. |
| B03 | 16-byte `'B' '0' '3' 00 00 ('D' − value)` | `SetShutOffDisplay` | none | I (gateway). Firmware: arg2 `'C'`/`'D'` is not handled, so **no effect expected** on this model. |
| B03 | 16-byte composite, built from the stored record bytes 16–31 and 59 with one field replaced (table below) | HeatingControl, TemperatureOffset, OUTSensorProbe/Type, CoolingControl, ValveProtection, FrostSetpoint, Max/Min setpoints, floor limits, TemperatureDisplayMode | none | I. Firmware: **ignores every composite field** except arg2 (lock) and arg5. The gateway takes its source bytes from the stored **0x71** record, so on this model the composite carries status bytes, not settings. |
| B03 | arg5 = `'1'` (0x31), other args 00 | none (side effect of the composite: `SetValveProtection` 1 puts `'1'` here) | n/a | I. Firmware: **resets the user settings** to defaults: 0x72 bytes 2–9 and 45, time format, DST, system mode heat. |
| B11 | `'r'` or `'s'` (0x72 / 0x73), then 0x72 record bytes 1–47 | none; the app sends it raw (`SetCommand_d`), its templates are `42313172` and `42313173` | n/a | **P** for the frost setpoint (bytes 6–7), temperature offset (3–4), display resolution (11) and heat control algorithm (12): written and read back. I (firmware) for the rest. **The only write path for the 0x72 settings.** Section 6.4. |
| B74 | `00 00 00 00 00` (args ignored) | Raw template in the app | n/a | **P**: the thermostat echoes it and sends a 0x72 right after, also after a B11 write, when it sends none by itself. |
| BA1 | 2 bytes | `SetCloudOverride`, value split high/low | none | I (firmware): both 1–200 sets 0x72 bytes 75–76; a 0 in either clears both. The visible effect is **U** |
| B47 | 33 bytes | Wiring-centre zone pairing, composed by the **app**, not the gateway (section 7) | n/a | P (on air) |
| any | raw | `sIT600I.SetCommand_d`: the gateway passes an arbitrary hex string through as a 0x32 payload; this is how B47 is sent | n/a | I |

"Turn off" in Salus terms is `B20 07` (standby). Turning back on is `B20 02` (permanent hold)
followed by `B48 04`; both sequences are on air (P, the B20 and B48 rows above). `B20 00`
(schedule) was also sent and echoed. The pairing capture has no setpoint write, although the user
changed the setpoint around 20:45:17; that action did not reach the thermostat during the capture
(**U**).

Gateway B03 composite layout (`Transfer_Set_Thermostat_Properties`, I). Args follow `'B' '0' '3'`;
"src" is the byte the gateway copies from its stored record when that field is not being set.
Setpoint bytes use the section 6.2 encoding. Listed for completeness: the SQ610 firmware ignores
all of it except args 2 and 5.

| # | Arg | Field | Encoding when set | src |
|---|---|---|---|---|
| 1 | 0 | HeatingControl | `'0'` + value | 16 |
| 2 | 1 | TemperatureOffset | offset_x100 / 50 + 0x27 (0x21 = −3.0, 0x27 = 0, 0x2D = +3.0) | 17 |
| 3 | 2 | OUTSensorProbe; also lock (`'A'`/`'B'`) and display (`'C'`/`'D'`) in the short forms | `'0'` + value | 18 |
| 4 | 3 | OUTSensorType | `'0'` + value | 19 |
| 5 | 4 | CoolingControl | `'0'` + value | 20 |
| 6 | 5 | ValveProtection | `'0'` + value; firmware: `'1'` = reset user settings | 22 |
| 7 | 6 | FrostSetpoint | setpoint byte | 23 |
| 8 | 7 | MaxHeatSetpoint (gateway also copies it to MaxCool) | setpoint byte | 27 |
| 9 | 8 | MinHeat / MinCool | setpoint byte | 28 |
| 10 | 9 | FloorHeatingMax | setpoint byte | 29 |
| 11 | 10 | FloorHeatingMin | setpoint byte | 30 |
| 12 | 11 | FloorCoolingMin | setpoint byte | 31 |
| 13 | 12 | TemperatureDisplayMode | `'0'` + value | 59 |

The gateway also has three `B03 'a'` forms (first arg 0x61, `0x7E` = no change) for MinTurnOffTime,
AllowAdjustSetpoint and DelayStart, and B76 for ScheduleOffset. The SQ610 firmware has no handler
for them (I).

### 6.4 Settings write (B11)

```
0x32 payload: <handle> 'B' '1' '1' <kind> <0x72 record bytes 1..47>
kind 0x72 ('r'): writes the user settings only
kind 0x73 ('s'): writes the user and the admin settings
```

The firmware parses the record at the same offsets as the 0x72 it sends (section 5.3), so a writer
takes the device's latest 0x72, changes one field and sends bytes 0–47 back with byte 0 set to
`'r'` or `'s'`. Bytes 48–76 are not read. The thermostat echoes the payload as usual and applies the
change (P for frost, offset, display resolution and heat control, I for the rest), but sends no
0x72 by itself afterwards (P): B74 makes it send one. The echo came 5–15 s after the write, because
the thermostat sleeps between polls (P).

| # | Kind | 0x72 bytes written | Mark |
|---|---|---|---|
| 1 | `'r'` and `'s'` | 2, 3–4, 5, 6–7, 8–9, 42, 45 | I (P for 3–4 and 6–7) |
| 2 | `'s'` only | 10–39, 40–41 (PIN, decoded with byte 1), 43, 46, 47 | I (P for bytes 11 and 12, and for 40–41 with no PIN) |
| 3 | neither | 1 (used only as the PIN key), 44, 48–76 | I |

Rules for a writer (I, firmware):

1. With no PIN set (note 2 of section 5.3), send `b1 = 01, b40–41 = 01 ff` whatever the last report
   said (P), and copy byte 43. With a PIN set, send bytes 1, 40, 41 and 43 exactly as last reported.
   A different byte 1 decodes bytes 40–41 to another PIN, and a PIN locks the keys.
2. Keep values inside the "Range" column of 5.3. Only byte 15 (S1/S2 input) is checked on
   write, against what the hardware supports; out-of-range values are stored and clamped at the
   next boot.
3. Prefer `'r'` for the user settings: it cannot touch the admin block.
4. Request a fresh 0x72 with B74 afterwards: none follows by itself (P).

Setting → write path, for a converter:

| # | Setting | 0x72 bytes | Write | Legacy B03 arg (ignored by SQ610) | Mark |
|---|---|---|---|---|---|
| 1 | Heat control algorithm | 12 | B11 `'s'` | (HeatingControl, arg0, is another field) | **P** |
| 2 | Temperature offset (calibration) | 3–4 | B11 `'r'` | 1 | **P** |
| 3 | Frost (standby heat) setpoint | 6–7 | B11 `'r'` | 6 | **P** |
| 4 | Min / max heating setpoint | 24–25 / 22–23 | B11 `'s'` | 8 / 7 | P (byte), I (write) |
| 5 | Min / max cooling setpoint | 28–29 / 26–27 | B11 `'s'` | 8 / 7 | P (byte), I (write) |
| 6 | S1/S2 input (floor / external probe) | 15 | B11 `'s'` | 2 | I |
| 7 | Floor limits | 16–21 | B11 `'s'` | 9–11 | I |
| 8 | Valve protection | 30 | B11 `'s'` | 5 (dangerous, see 6.3) | I |
| 9 | Cooling control algorithm, TRV advanced calibration | 13, 14 | B11 `'s'` | | I |
| 10 | Display resolution (gateway "CoolingControl") | 11 | B11 `'s'` | 4 | **P** |
| 11 | Display humidity / time / floor temperature | 5 / 2 / 45 | B11 `'r'` | | I |
| 12 | Temperature scale | 10 | B11 `'s'` | 12 | I |
| 13 | Language | 42 | B11 `'r'` | | I |
| 14 | Optimum start / stop, comfort warm floor | 37 / 38 / 39 | B11 `'s'` | | I |
| 15 | Relay, minimum off times | 31–36 | B11 `'s'` | | I |
| 16 | Key lock | 0x71 byte 23 | B03 arg2 `'A'`/`'B'` | 2 | **P** |
| 17 | Time format | 0x71 byte 38 | B21 0/1 | | **P** (write on air) |
| 18 | Display off (`ShutOffDisplay`) | none found | B03 arg2 `'C'`/`'D'` | 2 | U: firmware has no handler |
| 19 | Schedule setpoints | 0x71 bytes 11–14 | B31 (heat), B30 (cool) | | I |

## 7. Wiring-centre zone pairing

### 7.1 B47: coordinator → thermostat

The app composes B47; its code contains `sendB47FDCommand`, `wcRequestedPairZoneMask` and
`_wcPairZoneMaskFromWcB47Command`. Two B47 writes were captured (WC short replaced by the 0x5678
placeholder, LE `78 56`):

```
07 'B47' 00 11 ff ff ff ff fd 00 00 00 00 00 00 00 00 00 00 ... (33 arg bytes, rest 00)
08 'B47' 00 11 01 00 78 56 fe 00 00 00 00 00 00 00 00 01 00 ... (33 arg bytes, rest 00)
```

| Arg byte | Field | Mark |
|---|---|---|
| 0–1 | `00 11`; candidates from the app's symbol names: device type/code | U |
| 2–3 | Wiring-centre number, uint16 LE: `01 00` in every successful pairing (JSON `PairedWCNumber` 1); `ff ff` in the reset form | **P** (`01 00`), I (`ff ff`). `00 00` did not help: a wiring centre that held 0x20 refused all the same, so the refusal came from its own number (section 4.3), not from B47 |
| 4–5 | **Wiring-centre short address, LE** | **P** (matches the WC's short) |
| 6 | State: 0xFD = reset/prepare (the app's "FD command"), 0xFE = pair request | I |
| 7 | **Replace flag**: 0x00 = pair to a free zone, 0x01 = take over a zone already held by another thermostat | **P** (see 7.4) |
| 8–15 | **Zone flags, one byte per zone 1–8**: zone n is byte 7 + n, 01 = pair it, 00 = leave it | **P**: zone 2 → byte 9, zone 3 → byte 10, zones 5, 6, 7 and zone 8 → byte 15 each made the thermostat request that zone. With bytes 8 and 11 (zones 1 and 4) both 01 it sent 0x18 and 0x14 for zone 1, got 0x84, then sent 0x18 and 0x14 for zone 4 |
| 16–32 | 00 | U |

The thermostat echoes B47 at once (0x33, state unchanged). It then sends two more 0x33 frames
with the same handle as the pairing progresses: state 0xFE → **0x07** (3.1 s after the B47, after the
WC's 0x84) → **0x00** (8.3 s after the B47). 0x00 most likely means success (**I**).

The app sent the 0xFD form 20 s before the 0xFE form, at the moment the user changed the
setpoint. It is most likely the app's pairing screen clearing the old link, not a setpoint write
(**I**).

### 7.2 Thermostat ↔ wiring centre (direct, coordinator only relays)

Times are seconds after the 0xFE B47 reached the thermostat.

| # | t (s) | Frame | Payload | Mark |
|---|---|---|---|---|
| 1 | 0.37 | thermostat → WC: FC00 **0x18** | `01 08 00 00 ff 00 00`; byte 1 = zone (8) | P (zone), U (rest) |
| 2 | 0.96 | WC → thermostat: ZDO IEEE_addr_req for the thermostat's short | answered by the coordinator as its parent | P |
| 3 | 0.97 | WC → thermostat: FC00 **0x88** | `00 ff 00 00 00 00 00`; byte 0 = status (table below) | P |
| 4 | 1.11 | thermostat → WC: ZDO IEEE_addr_req for the WC | answered by the WC | P |
| 5 | 1.16 | thermostat → WC: FC00 **0x14** | `00 08`; byte 1 = zone | P (zone) |
| 6 | 1.21 | WC → broadcast: ZDO NWK_addr_req for the thermostat's IEEE | answered by the coordinator for its child | P |
| 7 | 1.23 | WC → thermostat: FC00 **0x84** | `00 08 00`; zone 8, status 0 | I |
| 8 | 2.15 | thermostat repeats 0x18; WC repeats 0x88 | | P |

The WC looks the thermostat up by IEEE while pairing (rows 2, 4 and 6), but its zone table holds
the short address (section 8). A thermostat that rejoins under a new short address is not
followed: its zone has to be paired again with the replace flag (**P**, section 7.4). The
coordinator's role is standard Zigbee: it routes as parent and answers address requests for its
sleepy child.

0x88 status, byte 0:

| # | Status | Meaning | Mark |
|---|---|---|---|
| 1 | 00 | Accepted; 0x14 / 0x84 follow | P |
| 2 | 01 | Refused: the wiring centre holds no valid device number (section 4.3). It answered every 0x18 with it while it held 0x20. The gateway app has a string "Thermostat rejected by Wiring Centre" (Error24) | P (this cause), U (others) |
| 3 | 02 | Zone already taken (section 7.4) | P |

### 7.3 Ongoing zone reports: thermostat → WC, FC00 0x12

Every paired thermostat sends its temperature and setpoint straight to the wiring centre (APS
unicast to the WC's endpoint 8), about every **615 s**. A thermostat assigned to two zones sends
one frame per zone, 150 ms apart. The gateway does not take part, apart from relaying at the MAC
layer as the thermostat's parent.

Examples from the baseline capture:

```
02 01 00 07 00 ff 00 00 00 00 00 ff 90 08 dc 05 dc 05   zone 7, 21.92 °C, 15.00, 15.00 (standby)
02 01 00 08 00 ff 00 00 00 00 00 ff df 09 34 08 f4 01   zone 8, 25.27 °C, 21.00, 5.00 (new unit)
02 01 01 08 00 ff 00 00 00 00 00 ff 98 09 f0 0a f4 01   zone 8, 24.56 °C, 28.00, 5.00 (heating)
```

| Byte | Field | Encoding | Mark | Evidence |
|---|---|---|---|---|
| 0–1 | `02 01` | | U | Same on all 7 |
| 2 | **Heat demand** | 00 = idle, 01 = heating | **P** | 00 on all 7 while idle; 01 on the new unit after its setpoint was raised to 28 °C above a 24.56 °C room |
| 3 | **Zone number (1–8)** | uint8 | **P** | Matches the B70 slot for all 7 thermostats (8 zones) |
| 4 | 00 | | U | Same on all 7 |
| 5 | ff | | U | |
| 6–10 | 00 | | U | |
| 11 | ff | | U | |
| 12–13 | **Room temperature** | int16 LE x100 (binary, not BCD), 0.01 °C | **P** | The 6 standby units are within 0.15 °C of JSON `LocalTemperature_x100`, which is rounded and can be minutes old. The new unit's 25.27 lies between its 0x71 reports before and after (25.50, 25.00). |
| 14–15 | **Current heating setpoint** | int16 LE x100 | **P** | 1500 on the 6 standby units (JSON HeatingSetpoint 1500), 2100 on the new unit (JSON 2100 at the time) |
| 16–17 | Frost / standby setpoint | int16 LE x100 | I | 1500 on the 6, 500 on the new unit; equals 0x71 bytes 43–44 on all 7. MinHeatSetpoint has the same values here, so it is not ruled out. |

The thermostat decides demand itself and sends it in byte 2; the wiring centre follows it
(**P** for the flag; whether it acts on the flag alone or also compares temperature and setpoint
is open, section 11). The first 0x12 after a setpoint change came about 2 minutes later, before
the regular 615 s period, so a setpoint change triggers an early report (**I**, one sample).

Relay (P, zigbee2mqtt): with a thermostat paired to zone 8 and its setpoint raised to
30 °C over a room at 22.5 °C, its 0x12 to the wiring centre carried demand 01 within 7 s, the
zone 8 LED came on and the pump and boiler outputs followed.

A factory-reset thermostat is in permanent hold at 21 °C with a frost setpoint of 5 °C (P). With
heat control ITLC UFH (0x72 byte 12 = 0, the factory value) a thermostat may call for heat
slightly above its setpoint (P: one bedroom unit at 22 °C over a 21 °C setpoint).

Once paired, this link works without the coordinator. A WC keeps driving its zones from its
thermostats whichever coordinator they are on, provided all of them stay in the same network
(P: the whole system runs on zigbee2mqtt).

### 7.4 Occupied zone and replace

Captured when a thermostat that had rejoined under a new short address was paired again to its
old zone:

| # | Frame | Payload | Mark |
|---|---|---|---|
| 1 | coordinator → thermostat: B47 0xFE, replace flag 0 | as 7.1 | P |
| 2 | thermostat → WC: 0x18 | `01 08 00 00 ff 00 00` | P |
| 3 | WC → thermostat: 0x88 | `02 ff 00 00 00 00 00`: status **0x02 = zone already taken** | P |
| 4 | coordinator → thermostat: B47 0xFE, **replace flag 1** | arg byte 7 = 01 | P |
| 5 | thermostat → WC: 0x18 | `01 08 00 00 ff 00 01`: last byte = replace | P |
| 6 | WC → coordinator: FC00 **0x1a** | `01 00 <old short LE>`: the replaced thermostat | P |
| 7 | WC → thermostat: 0x88 status 0, then 0x14 / 0x84 as in 7.2 | | P |
| 8 | WC → coordinator: 0x33 B70 zone table with the new short in the zone's slot | | P |

So the wiring centre does not follow a thermostat to a new short address: it keeps the old one in
the zone table, refuses the new pairing with status 02, and hands the zone over only with the
replace flag (P).

After every B47 the thermostat also sends a 0x10 sync request, and the coordinator answers with
0x81 as at join.

A thermostat that is joined but not paired to any wiring centre (or other receiver) shows "go to
the Smart Home app" and ignores its buttons, on the Salus gateway as well. The display returns to
normal once the zone pairing in 7.2 completes (**P**). It is a pairing state, not a coordinator
problem.

### 7.5 Wiring centre: joining, reset and power cycles

All P. Item 4 is from the Salus capture, the rest from the live tests on zigbee2mqtt.

1. **Scanning.** After a factory reset the wiring centre does not scan for a network by itself: no
   beacon requests on any channel in 20+ minutes.
2. **Joining.** Its radio survives a short mains cut: the network LED keeps blinking for 10 s with
   the power off. A cut that lasts until the network LED is dark reboots the radio, and it then
   joins an open network at once.
3. **Factory reset.** Holding Pair for 15 s turns G1 and G2 red, then off. The wiring centre
   broadcasts a NWK Leave and **all its paired thermostats leave the network too**: three were seen
   leaving within 8 s, and all six had left. It also clears its device number (section 4.3).
   According to the manual the reset button does not remove the wiring centre itself from the
   network (I).
4. **Short mains cut.** It reboots the main controller only. The wiring centre re-sends its B70
   zone table (section 8), sends a 0x10 and re-sends 0x84 to every zone thermostat. The zone table
   survives mains cuts.
5. **Thermostats joining through it.** With permit join limited to the wiring centre, a thermostat
   associated with it (association successful, repeated 50+ times) but never received a Transport
   Key, so it never joined. With permit join on the whole network they joined (5 of 6; one joined
   through the coordinator directly). The cause is U. Permit join on all routers, not on the
   coordinator or the wiring centre alone.

### 7.6 Coordinator as a zone's thermostat

All P, from the live tests on zigbee2mqtt. The coordinator sent these frames to the
wiring centre as raw 0xFC00 frames (the converter's `salus_frame`), for zone 8. A thermostat held
zone 8 until then, and the zone had no actuator. The wiring centre took the coordinator for the
thermostat of the zone: on the coordinator's report it switched its pump and boiler outputs on,
with no thermostat involved.

| # | Coordinator → WC | Payload | Seen after it | Mark |
|---|---|---|---|---|
| 1 | FC00 **0x18** | `01 08 00 00 ff 00 01`: zone 8, replace flag 1 (as 7.4 row 5) | WC → coordinator **0x1a** with the short address of the replaced thermostat (as 7.4 row 6); **0x88** status 00; an unsolicited **B70** with zone 8 = `0x0000`, the coordinator's own short address | P |
| 2 | FC00 **0x14** | `00 08`: zone 8 | WC → coordinator **0x84** `00 08 00` | P |
| 3 | FC00 **0x12** | `02 01 01 08 00 ff 00 00 00 00 00 ff d0 07 b8 0b dc 05`: demand 01, zone 8, 20.00 °C, setpoint 30.00 °C, frost 15.00 °C (section 7.3) | The pump and boiler outputs switched on exactly 3 min 00 s after the frame | P |

The switch-on was seen as a step on a power meter on the wiring centre's mains supply, from about
1.6 W to about 13 W. Zone 8 had no actuator, so the step is the pump and boiler outputs.

Failsafe (P): the 0x12 of row 3 was the only report. It was sent at 17:23:10.8, the outputs
switched on at 17:26:10.8 and off at 17:55:44, 32 min 33 s after the frame, with no further report
in between. The outputs run on for 3 min, so the wiring centre dropped the zone by itself about
29.5 min after the last 0x12 from its holder. The time was measured from a single report; a
coordinator that keeps a zone on should report at least every 25 min or so (I).

The consequence: a zone the coordinator holds goes cold about 30 min after zigbee2mqtt stops
reporting for it. Direct control is not a fail-safe way to heat a room. Zones that thermostats hold
are not affected: the thermostats keep reporting on their own, about every 615 s (section 7.3),
with or without a coordinator.

### 7.7 Giving a zone back to its thermostat

From the live tests on zigbee2mqtt. After the coordinator had taken zone 8 over from
its thermostat (section 7.6), that thermostat was paired to the zone again with the B47 of section
7.1, replace flag 1. It did not pair at once:

| # | B47 sent | Seen | Mark |
|---|---|---|---|
| 1 | FE with the replace flag | The echo came within 1 s with state 00, and no 0x18 followed: most likely the thermostat still believed it held the zone | P (echo), I (cause) |
| 2 | FD (the reset form of section 7.1), then FE with the replace flag | The echo of the FE came 40 s late with state 07, and no 0x18 was seen | P |
| 3 | FE with the replace flag again, about 2.5 min later | The full sequence of sections 7.2 and 7.4: 0x18 with the replace flag, 0x88 status 00, an unsolicited B70 with the thermostat in zone 8, then the B47 states 07 and 00 | P |
| 4 | FE without the replace flag, while the coordinator held zone 8 | Refused: the zone table never showed the thermostat, and `wiring_centre_zones` failed after 20 s | P |
| 5 | FD, 20 s later FE with the replace flag | Paired on the first try: 0x18, and the zone table showed the thermostat in zone 8 | P |

So a thermostat whose zone the coordinator took is not simply paired again: it needs the FD form
before the FE form with the replace flag (P, rows 1 and 5), and a plain FE for a taken zone is
refused (P, row 4). Row 2 had the FD form before the FE form too and did not pair; row 5 had 20 s
between them, the gap of the app (section 7.1). The converter's `wiring_centre_zones` sends the FD
form first when the value starts with replace, waits for its echo and sends the FE form at once. If
that does not pair, a pause between the two is what to try.

## 8. Wiring centre zone table (B70)

Right after the pairing request, the WC sent an unsolicited 0x33 to the coordinator with handle
**0x8A** (high bit set = unsolicited report, **I**). The gateway's join template for the WC
(`it600WC.cfg`) requests the same thing with
`0x32: 01 'B70' 7e aa aa a8 80 00 00 00 78`. The gateway stores it as `CommandResponse_d`.

| Byte (after `B70`) | Field | Mark |
|---|---|---|
| 0–4 | 00 | U |
| 5 | 0x08 = zone count (also present in the app's empty template) | I |
| 6–41 | 12 × (short ID **big-endian**, flag 00), one per zone 1–12; `ff ff` = empty | **P** (all 7 thermostat shorts in the right zones; one thermostat in zones 1 and 4) |
| 42 | LQI (0xFF) | P (code + JSON `LastMessageLQI_d` 255) |
| 43 | RSSI int8 (0xDB = −37) | P (JSON `LastMessageRSSI_d` −37) |
| 44 | 00 | U |
| 45–49 | `7e aa aa a8 80`, also in the query template | U |
| 50–53 | 00 00 00 00 | U |
| 54 | 0x78, also in the query template | U |

The WC builds this table itself from thermostat pairing (0x18/0x14). The gateway does not push the
zone map; it only reads it (**I**).

The WC also sends the table unprompted when it boots, with handle 00 (P, section 7.5), and the
table survives mains cuts (P). The converter requests it with the gateway's template and a handle
from the allocator of its B-commands, because a reply is taken to carry the handle of its request,
as the thermostat's echoes do (I).

## 9. Other periodic gateway traffic

| # | What | Interval | Mark |
|---|---|---|---|
| 1 | Read Basic 0x0005 (`modelId`) on each SQ610RFNH, as keep-alive | 900 s (`SQ610RFNH.cfg` `check_device_keep_alive`) | P (908 s measured on 2 thermostats) |
| 2 | Read Basic 0x0004 (`manufacturerName`) on the it600WC | 300 s | P (308 s measured) |
| 3 | At join: Read Basic 0x0005, then 0x0003 + 0x0005 on the new thermostat | once | P |
| 4 | OTA: the thermostat sends Query Next Image; the gateway answered with a ZCL Default Response, status 0x85 | on join | P |
| 5 | Pairing window: Mgmt_Permit_Joining 200 s, closed after the join, then an Identify (stop) broadcast to 0xFFFF ep 0xFF | user action | P |

No ZCL reads on FC00/FC09, no 0x30 polls and no new 0x81 were seen in 19 minutes of capture.

## 10. What a converter needs

| # | Need | Detail | Confidence |
|---|---|---|---|
| 1 | Greeting | Answer FC00 0x10 with the 15-byte 0x81 of section 4, fc `0x1D`, mfg 0x1078, from coordinator ep 1, with device number 0x20 for a thermostat and 1 for a wiring centre. The gateway answered in 0.56 s. | Proven on zigbee2mqtt for both devices; unknown how strict the timing is. |
| 2 | Coordinator identity | Answer Basic `modelId` reads from the thermostat with `SAU2AG1`, and if possible report manufacturer code 0x1078 in the node descriptor. In zigbee2mqtt the first part is done by the `genBasic` attribute defaults of the converter's definition (section 3); the node descriptor cannot be set from a converter. | Unknown whether required. |
| 3 | Reading | Parse FC00 0x31 record 0x71: temperature, active setpoint, schedule setpoint, system mode, humidity, battery and lock are proven, and HoldType for permanent hold and standby (section 5.2). A 0x71 with `12 34` as the temperature has a placeholder there: leave out the temperature and use the rest (section 5.2). | Proven |
| 4 | Writing | Send FC00 0x32 `<handle> 'B34' <sp>` for setpoint, `B20 07` for off, `B20 02` followed by `B48 04` for on, and match the 0x33 echo. The converter in this repo sends each write once and waits 30 s for the echo, one write at a time for each thermostat. It bypasses herdsman's request queue on purpose, so that a write is never replayed late with a stale value; the sleepy thermostat's parent holds the frame until it polls (section 6.1). No echo in 30 s is reported to the user as an error, and the converter does not retry. | B34, B33, B20, B48, B21 and the B03 lock are proven on air (section 6.3; B34 at 17.0, 21.5 and 5.0 °C). B31, B30 and the rest are from gateway or firmware code and have not been tried on a device. |
| 5 | Zone pairing | Send B47 as in section 7.1 to start thermostat ↔ WC pairing; the WC handles the rest. To take over a zone, send the FD form before the FE form with the replace flag (section 7.7). | Proven on zigbee2mqtt with one wiring centre, also the refusal of a taken zone and the replace; the unpair form is unknown |
| 6 | Settings | Parse 0x72 (section 5.3); before each write ask for a fresh 0x72 with B74 and change that one; write it with B11 (section 6.4) and wait up to 30 s for the echo; then request another 0x72 with B74, as none follows by itself. | Frost setpoint, temperature offset, display resolution and heat control algorithm proven; the rest is layout from firmware, writes untested |
| 7 | Wiring centre lookup | Answer FC00 0x16 `<number>` with 0x86 `01 <short address LE>` for the wiring centre that holds the number, and `00 ff ff` for any other (section 4.3). | Inferred from gateway code; no device has been seen to send it |

## 11. Open questions

1. Does the thermostat need the coordinator to identify as `SAU2AG1` / 0x1078? zigbee2mqtt
   already answers `SAU2AG1` to its `modelId` read, from the converter's attribute defaults
   (section 3), so only a run without that answer settles it.
2. Status bytes 2, 8, 16, 22, 25, 39–42, 47–48 and 52–76, the 0x76 record, and the meaning of
   the error-flag bits.
3. B47 bytes 0–1 and the unpair form. Removing a thermostat from a zone in the Salus app while
   sniffing would show the unpair form and what the wiring centre reports.
4. Whether the WC switches on the 0x12 demand flag alone, or also checks temperature against
   setpoint. It followed a flag of 01 with the room 7.5 °C under the setpoint (section 7.3); no
   case where the flag and the temperatures disagree is recorded.
5. What triggers an idle 0x71 report, and whether a 0x30 or FC09 poll is needed. A capture of two
   hours with no action on the thermostat would show what it sends on its own.
6. Settings: the control-algorithm and TRV calibration labels on a real display, 0x72 bytes 46
   and 47, the PIN encoding of the paired units, and B11 for the settings other than frost, offset,
   display resolution and heat control (those work). Each can be tried with `salus_command`: take
   the thermostat's latest 0x72, change the one field, send it back as B11 and ask for a new 0x72
   with B74 (section 6.4).
7. Whether the 0x71 temperature is the raw sensor reading or includes the offset in 0x72 bytes 3–4.
8. What makes a device send 0x16 (get wiring centre), and which numbers it asks for. The answer in
   section 4.3 is from gateway code only. Sniffing a Salus gateway network while a thermostat boots
   (battery pulled) and while a zone is paired in the app would show the request and the gateway's
   real 0x86 answer.
9. Wiring centre numbers 2–9: how the gateway assigns them, what B47 bytes 2–3 and 0x16 then
   carry, and how a thermostat picks one. The converter gives every wiring centre number 1, so a
   second one on the same network is not supported. Adding a second wiring centre to a Salus
   gateway and pairing a thermostat to it, with the sniffer running, would show it.
10. Whether the wiring centre takes a firmware update over the air through the standard OTA
    cluster. It lists the OTA client cluster 0x0019, asks for an OTA server at boot, and zigbee2mqtt
    matches it to the zigbee-OTA image SAL6DW1_20230222, the version it already runs. No newer
    image exists, so no transfer has been tried.
11. B31 and B30 with a value outside the min/max setpoint of the mode: clamped or ignored. Both
    readings of the firmware exist (section 6.3). B34 and B33 are read as ignored. None of the four
    has been tried on a device.
12. The 12-hour clock: B21 `00`, 0x71 byte 38 = 0 and bit 1 of 0x81 byte 6 = 0 are expected, but
    only the 24-hour form has been seen on air. Switching the Salus gateway to 12-hour time and
    back would show them.
13. How a change made on the thermostat's own buttons reaches the coordinator: which record it
    sends and how soon. A capture while the + button is pressed twice would show it.
