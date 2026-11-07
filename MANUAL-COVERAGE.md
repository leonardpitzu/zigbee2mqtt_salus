# SQ610RF manual coverage

Every user and installer feature the manufacturer documents for the SQ610RF, checked against
PROTOCOL.md and `converters/salus_sq610rfnh.mjs`.

## Sources

| Key | Document | Notes |
|---|---|---|
| QG19 | SQ610RF Quick Guide, IX 2019, 52 p, EN/DE/FR/NL (baddepot.de `SQ610RF_QG.pdf`) | EN pages 2–13 and 50; DE pages 24–25 cross-checked |
| QG25 | SQ610RF/SQ610BRF Quick Guide V01 04/2025, EN (vasco.eu `SQ610RF_QG_A3_EN_V01_250425.pdf`) | Premium Lite era |
| SPEC-UK | SQ610RF UK spec sheet 005, 2019 (ecowizard.co.uk) | |
| SPEC-DK | SQ610RF Danish data sheet, 2019 (res.cloudinary.com/evoleska `pmwygcva5y2ikbxuwtdo.pdf`) | |
| QG-W | SQ610 wired (230 V) manual, IX 2019 (theunderfloorheatingstore.com) | The heizman24 URL it replaced now redirects to the shop's home page. Used only for RF-relevant features and for the wired-only rows |
| QG-NO / QG-PL / QG-DK | Norwegian (bad.no, Arjonsmart, 2020), Polish SQ610BRF (afriso.pl, 2023), Danish/Swedish (evoleska, 2019) quick guides | Translations of QG19; cited only where they differ |
| FULL | **Salus QUANTUM SQ610RF Full User Manual, version 16, 68 p** (`SQ610RF_Full_manual_EN_v16.pdf`, also manualslib.com/manual/1806489), page numbers as `FULL pNN` | The only full manual found. Every FULL value in the table was checked against the v16 PDF (column v16). Its text layer holds every value cited, so no page images are kept. The PDF is not in the repo |
| KB-UK | support.salus-tech.com SQ610 knowledge base (29 articles via the Zoho portal API) | "Restart and Reset", "Incorrect Temperature Displayed", "Activating Cooling Mode", "Exit Standby", "Firmware Update", "Disabling COMFORT MODE", SQ610 and SQ610RF FAQs |
| KB-FR | salusfr.zohodesk.eu `kb/sq610` (the URL given) | Only 9 public articles, French translations of the KB-UK ones. The "Installation and setup", pairing and "Features and Functions" sections (4.1–4.17) are empty shells on both portals |

Search for an installer manual with menu codes: none exists. All guides say "full manual at
salus-controls.eu"; that full manual is FULL. The admin menu is a named list (FULL p61–64), with no
numeric parameter codes, so no menu codes appear below.

## Coverage table

Status: **P / I / U** = PROTOCOL.md mark of the bytes the feature maps to; **not found** = no byte or
command located; **n/a** = not a thermostat-protocol feature (gateway, app, hardware or wired-only).
Converter: **rw** read/write, **r** read-only, **–** not exposed, **w** write-only.
v16: **✓** every FULL value in the row matches the v16 PDF; **fixed** the row was corrected to it; **–** no
FULL value in the row.

| # | Feature | Range / default per manual | Manuals | v16 | Protocol location | Status | Converter | Conflict / note |
|---|---|---|---|---|---|---|---|---|
| 1 | Schedule mode ("Follow schedule", calendar icon) | – | QG19 p5, QG25, FULL p27, p54, KB-UK | ✓ | 0x71 b3 HoldType 0; B20 00 | P (write) / I (byte) | rw (`preset: schedule`) | |
| 2 | Temporary override (setpoint changed while on schedule, until next program) | until next program | QG19 p4–5, FULL p31, p55 | ✓ | 0x71 b3 = 1 | P (field), value 1 not yet seen on air | r (`hold_type`; preset shows schedule) | |
| 3 | Permanent hold / manual mode | manual is the offline default (FULL p53) | FULL p31, p53, KB-UK | ✓ | 0x71 b3 = 2; B20 02 | P | rw (`preset: permanent_hold`) | |
| 4 | Standby (frost / overheat protection) | hold ✓ 3 s (QG19 p5, FULL p55) | QG19 p5, FULL p32, p55, KB-UK | ✓ | 0x71 b3 = 7; B20 07 | P | rw (`system_mode: off`) | KB-UK says hold ~5 s; UI only |
| 5 | Holiday mode: number of days + setpoint, plane icon, days-left countdown | days; setpoint | QG19 p4, p12, FULL p57, QG25 (OneTouch "Holiday Mode") | ✓ | HoldType 6 ("away", B20 06 echoed) is the candidate; day count and holiday setpoint **not found** | not found (U for the HoldType link) | partial (`preset: away`, no days, no setpoint) | FULL p39 (app) says holiday shares the standby setpoint; FULL p57 (device) asks for its own setpoint |
| 6 | Heat / cool mode | heat, cool; only with SPE600/SR600 online (FULL p60) or set by the KL08RF changeover terminals (KB-UK) | QG19 p12, FULL p26, p60, KB-UK | ✓ | 0x71 b15; B48 03/04 | P | rw (`system_mode`) | |
| 7 | Setpoint | 5–40 °C (QG19 p50, FULL p68, SPEC-DK), **5–35 °C (SPEC-UK)**; 0.5 °C steps | all | ✓ | 0x71 b9–10; B34 heat, B33 cool | P | rw 5–40, step 0.5, clamped to the device's own min/max | SPEC-UK's 5–35 is the default range: FULL p63 gives max setpoint default 35, settable 5.5–40, and min setpoint default 5 |
| 8 | Schedule (program) setpoint | – | FULL p27 | – | 0x71 b11–12 (P); B31 (I) | P / I | r (`schedule_setpoint`, the heating setpoint) | |
| 9 | Schedule programs: 5+2, 7-day, single days; 6 periods/day; default schedule | 6 programs | QG19 p12, QG25, FULL p27–30, p54 | ✓ | **not found**: only the current program setpoint is known. Records 0x70, 0x73, 0x74 never seen | not found | – | |
| 10 | Key lock | ▲+▼ 3 s (QG19 p5, FULL p55); KB-UK FAQ says 5 s | QG19, QG25, FULL p33, p55, KB-UK | ✓ | 0x71 b23; B03 `'A'`/`'B'` | P | rw (`child_lock`) | |
| 11 | App lock that the device cannot undo ("lock thermostat by PIN") | – | FULL p33 | ✓ | B22 `SetAllowUnlockFromDevice` (gateway), no firmware handler | U | – | |
| 12 | PIN code: disable/enable; locks admin menu only, or the whole thermostat; "Landlord PIN" | default DISABLE (FULL p64) | QG19 p12, FULL p33, p64, SPEC-UK, SPEC-DK, KB-UK (forgotten PIN = return to Salus) | ✓ | 0x72 b40–41 (obfuscated), b43 PIN enabled; the admin-only/full-lock variant **not found** | P (no PIN) / I (set) / variant not found | – (converter refuses settings writes when a PIN is set, on purpose) | |
| 13 | Time / date, automatic in online mode | – | QG19 p12, FULL p56 | ✓ | 0x81 b2–5, DST b6 bit 0, b8 | P (time) / I (DST) | automatic (sync, in the time zone of the zigbee2mqtt host) | |
| 14 | 12/24 h clock (AM/PM icon) | – | QG19 p4 (icon), QG25 (icon), FULL p9 (icon) | ✓ | 0x71 b38; B21; 0x81 b6 bit 1 | P (B21 write) / I (byte) | – (always 24 h) | |
| 15 | Show/hide time on LCD | show/hide | FULL p39 (app) | ✓ | 0x72 b2 | I | – | |
| 16 | Temperature calibration (offset) | device menu −3.5…+3.5 °C (FULL p58, KB-UK); app −3.0…+3.0 in 0.5 steps (FULL p39); default 0 | QG19 p12, FULL p39, p58, KB-UK | ✓ | 0x72 b3–4, signed BCD | P (write/read-back), I (range), U (whether 0x71 b4–5 includes it) | rw −3.5…+3.5, step 0.5 | Resolved: both ranges are in v16, one per interface. The thermostat's own menu allows ±3.5 (firmware: ±3.50 in 0.1 steps), so the converter does too; the app stops at ±3 |
| 17 | Show/hide humidity | show/hide | QG19 p12, FULL p39, p58, KB-FR FAQ | ✓ | 0x72 b5 (gateway "HeatingControl") | P (mapping) / I (meaning) | – | |
| 18 | Show/hide floor temperature (only with a floor sensor, 1 °C resolution) | show/hide | QG19 p12, FULL p59 | ✓ | 0x72 b45 | I | – | Missing in QG-NO's menu |
| 19 | Standby setpoint, heating (frost) | 5–35 °C (FULL p59) | QG19 p12, FULL p39, p59, KB-UK | ✓ | 0x72 b6–7 | P | rw 5–35 | Resolved: the converter's old cap of 17 had no source. The firmware menu also keeps it inside the heating setpoint limits |
| 20 | Standby setpoint, cooling (overheat); not with TRV/RX10RF | 5–40 °C (FULL p59) | QG19 p12, FULL p59 | ✓ | 0x72 b8–9 | I | – | Resolved: the factory 40.50 is one step above the 40.00 cooling maximum, which the firmware menu allows; what it shows there (probably off) is U |
| 21 | Reset user settings | – | QG19 p12, FULL p60, KB-UK | ✓ | B03 arg5 `'1'` | I | – | KB-UK says it also resets schedules and names; firmware resets 0x72 b2–9, b45, time format, DST, mode |
| 22 | Language | English, Danish, Polish, … (first-power-up choice) | QG19 p7, p12, QG25, FULL p39 | ✓ | 0x72 b42 (0–26) | I | – | |
| 23 | Temperature scale | °C / °F, default °C (FULL p61) | QG19 p12, FULL p61, KB-FR FAQ | ✓ | 0x72 b10 | I | – | QG19 lists it under user settings; FULL and KB under admin. PROTOCOL writes it with B11 's' (admin), as FULL |
| 24 | Display temperature resolution | 0.5 / 0.1 °C (1 / 0.2 °F), default 0.5 °C (FULL p61) | QG19 p13, p50, FULL p61, p68 | ✓ | 0x72 b11 (gateway "CoolingControl") | P (byte; written and read back on 7 thermostats) | rw (`display_resolution`) | Default matches the factory 0 |
| 25 | Heat control algorithm | ITLC UFH / ITLC RAD / ITLC ELECT / SPAN ±0.25 °C / SPAN ±0.5 °C / THB ACTUATOR, in that order; default ITLC UFH (FULL p61) | QG19 p13, p50, QG-W p15, FULL p61, p68, KB-UK FAQ, SPEC-UK, SPEC-DK | fixed | 0x72 b12: 0–2 ITLC, 3 ±0.25, 4 ±0.5, 5 THB | P (byte; 0, 1, 5 written and read back) / I (names) | rw | Resolved: the manual's order, the app's label for 5 and the firmware's menu code agree. The firmware's SPAN ±1.0 is the °F label of 4. Value 5 renamed `span_1.0` → `thb_actuator` |
| 26 | Cool control algorithm | SPAN ±0.25 / ±0.5 °C, default ±0.25 (FULL p61) | QG19 p12, FULL p61 | ✓ | 0x72 b13: 1 ±0.25, 2 ±0.5 (factory 1) | I | – | Resolved: the firmware menu reads it from byte 13, not 14; the factory 1 is the manual's default ±0.25 |
| 27 | TRV advanced calibration (self-learning, for TRVs without RX10RF) | OFF / AUTO SELECT / ON, default AUTO SELECT; only with TRVs (FULL p61–62) | FULL p61–62 | ✓ | 0x72 b14: 3 OFF, 4 AUTO SELECT, 5 ON (factory 4) | I | – | Found in the firmware's admin menu; the factory 4 is the manual's default |
| 28 | S1/S2 input | DISABLE / FLOOR SENSOR / EXT SENSOR / OCCUP SENSOR / ONE TOUCH / CHANGEOVER, default DISABLE; probe FS300 NTC 10 kΩ | QG19 p3, p13, p50, QG25, FULL p62, KB-UK FAQ | ✓ | 0x72 b15 (0–5 in the same order) | P (0) / I (1–5) | – | Order matches PROTOCOL |
| 29 | Floor max / min temperature for heating, floor min for cooling (S1/S2 floor sub-settings) | not stated in the pages read | FULL p62, p65 (error 2 fix) | ✓ | 0x72 b16–17 / 18–19 / 20–21 (27 / 10 / 6 °C) | I | – | |
| 30 | Floor / external sensor reading (EXT replaces the internal sensor) | – | QG19 p4 (icon 16), FULL p62 | ✓ | 0x71 b6–7 | I | – | |
| 31 | Occupancy (hotel card) input state; closed = normal operation | – | QG19 p3, p4 (icon 8), FULL p62 | ✓ | **not found** | not found | – | |
| 32 | OneTouch trigger input (NO volt-free contact) | – | QG19 p13, FULL p62 | ✓ | **not found** (the rule runs on the gateway; the thermostat must report the contact) | not found | – | |
| 33 | Heat/cool changeover input | – | QG19 p13, p50, FULL p62 | ✓ | b15 = 5 blocks B48 (I); mode in 0x71 b15 (P) | I | r (via `system_mode`) | |
| 34 | Minimum setpoint, heating and cooling | default 5 °C (FULL p63) | QG19 p12, FULL p63, KB-UK FAQ | ✓ | 0x72 b24–25 heat, b28–29 cool | P (bytes) / I (write) | heat rw (`min_heat_setpoint`), cooling r (`min_cool_setpoint`) | |
| 35 | Maximum setpoint, heating and cooling | default 35 °C, range 5.5–40 (FULL p63, KB-UK FAQ) | QG19 p12, FULL p63, KB-UK FAQ | ✓ | 0x72 b22–23 heat, b26–27 cool | P / I (write) | heat rw (`max_heat_setpoint`), cooling r (`max_cool_setpoint`) | PROTOCOL cooling default 40.00; FULL gives one default (35) |
| 36 | Valve protection | ON/OFF, default ON; actuators run once a week 5 min (QG19 p13) / after 7 days without heat (FULL p63) | QG19 p13, FULL p63 | ✓ | 0x72 b30 | I | – | |
| 37 | Minimum turn-off time, heating / cooling | default 1 / 180; range 0–999 (FULL p63); unit not stated | QG19 p13, FULL p63 | ✓ | 0x72 b33–34 / b35–36 (BCD) | I | – | PROTOCOL clamps cooling at 0–300 |
| 38 | Optimum start | ON/OFF, default OFF | QG19 p13, FULL p63, SPEC-UK, SPEC-DK | ✓ | 0x72 b37 | I | – | Paired units have 1 |
| 39 | Optimum stop | ON/OFF, default OFF | same | ✓ | 0x72 b38 | I | – | Paired units have 1 |
| 40 | Comfort warm floor | DISABLE / L1 / L2 / L3 = 11 / 15 / 19 min on, once an hour, heating only; default DISABLE | QG19 p13, FULL p63–64, KB-UK "disabling COMFORT MODE", SPEC-DK | ✓ | 0x72 b39 | I | – | The firmware timers 0x2c / 0x3c / 0x4c = 44 / 60 / 76 × 15 s = 11 / 15 / 19 min: an independent match. "Once an hour" is not in v16 |
| 41 | Internal relay NO/NC, enable/disable | wired SQ610 only, default enabled (QG-W p14–15) | QG-W | – | 0x72 b31 / b32 | I | – | RF default 0 (disabled); RF has no relay. n/a for SQ610RF |
| 42 | Device info: software version | – | QG19 p13, FULL p64 | ✓ | 0x10 b3–6; OTA Query Next Image file version | P | – | Cheap to expose |
| 43 | Device info: battery level | % | QG19 p4, FULL p64 | ✓ | 0x71 b49 (0–5) | P | r (`battery`, 6 steps) | |
| 44 | Device info: RF range / RSSI (3 s refresh, LOST LINK); app signal scale −50/−75/−85/−95 dB | – | FULL p46, p64 | ✓ | 0x71 b50 LQI, b51 RSSI | I | – (z2m's own `linkquality` only) | |
| 45 | Device info: paired with (WC zones, TRVs, receivers) | up to 6 TRVs (FULL p51) | QG19 p11, FULL p51, p64, KB-FR FAQ | ✓ | 0x71 b26–37 TRV shorts (I); WC B70 table (P); 0x81 b9–12 RX shorts (I) | I | – | |
| 46 | Identify mode: "IDENTIFY" flashes 10 min | 10 min | QG19 p13, FULL p37, p64 | ✓ | Identify cluster 0x0003 is an in-cluster (P, descriptor); behaviour untested | U | – | |
| 47 | Factory reset (leaves the Zigbee network, clears PIN) | – | QG19 p13, QG25, FULL p47–48, p65, KB-UK | ✓ | **not found** as a remote command | not found | – | v16 confirms it leaves the Zigbee network; "clears PIN" is not in v16 |
| 48 | Error / notification codes 1–32 | 1 TRV hardware problem; 2 floor overheated (heat) / overcooled (cool); 3 floor sensor broken; 4 floor sensor shorted; 5 lost coordinator / gateway; 6 lost WC; 7 lost TRV; 8 / 9 lost RX10RF (RX1 / RX2); 10–17 WC lost zone 1–8; 18 WC lost coordinator; 19 WC lost RX10RF; 20 TRV lost coordinator; 21 TRV low battery; 22 unpaired TRV within range; 23 rejected by WC; 24 lost nearest 230 V device; 25–28 WC lost zone 9–12; 29 TRV gear defect; 30 TRV failed adaptation; 31 thermostat low battery (app only); 32 lost RX10RF (app only) | FULL p45, p65–67, KB-UK FAQ | fixed | 0x71 b18–21, 16 flag bits | I (bytes) / U (bit map) | – | Resolved: v16 has the numbering above (2 floor, 6 lost WC); KB-UK's 02 / 06 follow another list. The display shows the text, not the number (FULL p45, firmware strings). v16's zone examples are off by one (11 = zone 1, 26 = zone 9, 29 = zone 12) |
| 49 | Heating demand (animated flame / waves) | – | QG19 p4, FULL p53, KB-UK FAQ | ✓ | 0x71 b17 = 1; 0x12 b2 to the WC | P | r (`running_state: heat`) | |
| 50 | Cooling demand (snowflake) | – | QG19 p4, FULL p53 | ✓ | 0x71 b17 in cool mode | U | – (converter knows 0 idle / 1 heat only) | |
| 51 | Room temperature | 0.5 / 0.1 °C display | all | – | 0x71 b4–5 (placeholder `12 34` filtered) | P | r | |
| 52 | Humidity | % | QG19 p4, QG25, SPEC-DK, KB-FR FAQ | – | 0x71 b24 | P | r | |
| 53 | Online / RF connection icons | – | QG19 p4, QG25 | – | 0x81 b13 cloud flag | I | always "online" | |
| 54 | Pair with KL08RF: one or more zones, ZONE OCCUPIED, replace | zones 1–8 | QG19 p10, QG25, FULL p49–50 | ✓ | B47; 0x18/0x88/0x14/0x84; 0x88 status 02 | P | w (`wiring_centre_zones` on the wiring centre) | |
| 55 | Pair with TRVs (system type RADIATORS, up to 6) | 6 | QG19 p11, FULL p51 | fixed | B36; 0x71 b26–37 | I | – | |
| 56 | Pair with RX10RF receiver | 2 receivers | QG19 p2, FULL p51–52 | fixed | 0x81 b9–12 | I | – | |
| 57 | Firmware update (gateway "Scan my home") | – | KB-UK, KB-FR FAQ | – | OTA cluster 0x0019, image type 0x007A, mfg 0x1078 | P | `ota: true` (no image source) | |
| 58 | "GO TO SMART HOME APP" (joined, not assigned) | – | QG25, KB-UK FAQ | – | pairing state, cleared by zone pairing | P | – | |
| 59 | Service mode (boiler service reminder, landlord access) | – | SPEC-UK only | – | **not found** | not found | – | No other manual mentions it |
| 60 | Pair with SR600 / SPE600 / OS600 / SW600; OneTouch rules (Party, Comfort, Holiday); lock keys while a window is open | – | QG25, FULL p34–36, p41–44, KB-UK | – | gateway logic | n/a | – | |
| 61 | Copy settings / duplicate schedule to other thermostats | – | QG25, KB-UK FAQ | – | app | n/a | – | |
| 62 | Soft restart (✓ 6 s), rear RESET button, power on/off | – | QG19 p5, KB-UK | – | local | n/a | – | |
| 63 | Delete offline device (CO10RF coordinator only) | – | FULL p64 | ✓ | CO10RF | n/a | – | |
| 64 | Connect with gateway; standalone wired operation | – | QG-W p7, p14 | – | wired SQ610 | n/a | – | |
| 65 | Battery and charging (Li-ion 3.7 V, micro-USB 5 V, ≤24 h) | – | QG19 p3, p50, QG25, FULL p10, p68, KB-UK | ✓ | candidate voltage 0x71 b40–41 | U | – | |

Other conflicts between manuals, outside the protocol: SPEC-UK says ErP class V, SPEC-DK says IV. QG-NO
drops "show/hide floor", "standby setpoint" and "heat/cool" from the user menu. QG19 says the
operating-mode button cycles schedule / permanent / temporary override; KB-UK says schedule / manual.

## Ranked gaps

Ranked by value to a floor-heating user first, then to the community. A gap can be tried on a
thermostat with `salus_command`, reading the 0x71/0x72 payloads from the zigbee2mqtt debug log
(PROTOCOL.md section 6.4).

| # | Gap | Why it matters |
|---|---|---|
| 1 | Heat control 3–5 (#25), cool span (#26) and TRV calibration (#27) come from the firmware's menu code; no display has shown them yet | A wrong label would set the wrong algorithm on a UFH zone |
| 2 | Floor sensor: S1/S2 input, floor temperature, floor limits (#28–30, #18) | Core of UFH with a floor probe; overheat protection of wood floors |
| 3 | Error code bit map (#48) | Lost WC link (6), floor sensor defect (3/4), low battery (31) are the alarms a floor-heating user needs |
| 4 | Comfort warm floor, valve protection, optimum start/stop, min off time (#36–40): bytes inferred, writes untested | UFH comfort and actuator health; all inside the 0x72 'admin' write |
| 5 | Holiday mode and schedule storage (#5, #9) | Holiday is a standard thermostat feature; the schedule is what makes a standalone UFH zone useful without HA |
| 6 | Calibration at ±3.5 (#16), and whether 0x71 includes it (open question 7) | Floor-mounted rooms often need >3 °C offset; the converter allows ±3.5, the device menu's range, but no write beyond ±0.5 has been tried |
| 7 | Standby heating above 17 (#19); what standby cooling 40.50 shows (#20) | Standby at 18–20 °C is common in bathrooms; the converter allows 5–35, but no write above 7.0 has been tried |
| 8 | 0x72 bytes 46 and 47, the last unnamed admin bytes | Complete the settings map |
| 9 | Identify (#46) | Cheap community feature: find a thermostat on the wall |
| 10 | Cooling demand value (#50) | Community: cooling users; `running_state` knows only idle and heat |
| 11 | PIN variant and app lock (#11–12) | Community; a PIN written wrongly locks the keys |
| 12 | Display/user flags, °F, language, 12 h (#14–15, #17, #22–23) | Low for UFH; complete the settings map |
| 13 | Firmware version and RSSI not exposed (#42, #44); the schedule setpoint is (#8) | Converter change only; the bytes are P/I |
| 14 | Occupancy / OneTouch contact state (#31–32) | Hotel-card and OneTouch users |
| 15 | Factory reset over the air (#47), service mode (#59) | Low |
