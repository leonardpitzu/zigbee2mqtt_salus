// Stopgap for zigbee-herdsman-converters 26.125.0: Salus SQ610RFNH and SQ610RF thermostats that keep their mode across off and on.
//
// The built-in SQ610RFNH definition turns a thermostat on in permanent hold, as the Salus gateway does, and that switches the
// thermostat's own schedule off. This keeps the built-in definition and changes three things:
// 1. preset: schedule, manual (the thermostat's permanent hold) or away, read from the thermostat and settable. A temporary hold (a
//    setpoint changed while the schedule runs, which the schedule's next step replaces) shows as schedule.
// 2. Turning on (system_mode heat or cool) after off goes back to the preset the thermostat had before it was turned off. While it is
//    off, preset keeps that last value. With no preset seen yet it turns on in manual, as before.
// 3. Turning on while the thermostat is already on in that mode writes nothing, so an automation that turns the heating on cannot
//    knock a running schedule into manual.
// hold_type shows what the thermostat reports, including temporary_hold and standby (off). schedule_setpoint is the setpoint the
// thermostat's own schedule asks for now. Both come from the status records the thermostat sends by itself: nothing here polls it.
// Commands to one thermostat run one after the other. A command that had to wait decides on what the converter learned while it
// waited (status records, finished writes), not on zigbee2mqtt's state from before, so an on right after an off is not skipped.
//
// Both models: SQ610RFNH, and SQ610RF (zigbeeModel SQ610RF, SQ610RF(WB)), which zigbee2mqtt does not know yet. This file replaces
// salus_sq610rf.mjs; do not load both.
//
// Commands from mikkelke/salus-zigbee (PROTOCOL.md sections 5.2 and 6.3): B20 07 off, B20 02 then B48 04 on (as the Salus gateway),
// B20 00 schedule, B20 06 away. Each write waits for the thermostat's 0x33 echo before the next one is sent.
// The echo is taken both as a raw frame (zigbee2mqtt 2.14) and as a parsed command, in case a later zigbee2mqtt declares 0x33. Exposes
// that a later built-in definition has too are not added twice.
// Remove once zigbee2mqtt's built-in definition does all this (presets, turning on in the preset it had, the SQ610RF).
import { definitions } from "zigbee-herdsman-converters/devices/salus_controls";
import * as exposes from "zigbee-herdsman-converters/lib/exposes";
import { logger } from "zigbee-herdsman-converters/lib/logger";
import * as utils from "zigbee-herdsman-converters/lib/utils";

const NS = "zhc:salus_it600_thermostats";
const e = exposes.presets;
const ea = exposes.access;

const CLUSTER = "manuSpecificSalusIt600";
const RECORD_STATUS = 0x71;
const STATUS_HOLD_TYPE = 3;
const STATUS_SYSTEM_MODE = 15;
const STATUS_SCHEDULE_SETPOINT = 11;
// The thermostat answers each B-command write with a 0x33 echo of its handle and code. The built-in cluster of zigbee2mqtt 2.14
// does not declare 0x33, so herdsman hands it over as a raw message.
const ECHO = 0x33;
const ECHO_TIMEOUT_MS = 30_000;

const HOLD_TYPES = { 0: "schedule", 1: "temporary_hold", 2: "manual", 6: "away", 7: "standby" };
const PRESETS = { 0: "schedule", 1: "schedule", 2: "manual", 6: "away" };
const HOLD_TYPE_SET = { schedule: 0, manual: 2, away: 6 };
// The preset to go back to. Anything else, such as a value saved by an older version of this file, is manual, as the built-in on.
const resumePreset = (preset) => (HOLD_TYPE_SET[preset] === undefined ? "manual" : preset);
const STANDBY = 7;
const SYSTEM_MODE_SET = { cool: 3, heat: 4 };

const base = definitions.find((definition) => definition.model === "SQ610RFNH");
if (!base) {
    throw new Error("No built-in SQ610RFNH definition in this zigbee-herdsman-converters; remove salus_it600_thermostats.mjs");
}
if ((base.toZigbee ?? []).some((converter) => converter.key?.includes("preset"))) {
    logger.info("The built-in SQ610RFNH definition has presets now: check whether salus_it600_thermostats.mjs is still needed", NS);
}

// Writes wait for their echo, so each thermostat gets one write at a time; the handle (1-127) tells the echoes apart.
const pendingEchoes = new Map();
const lastHandle = new Map();
const queues = new Map();

function nextHandle(ieeeAddr) {
    for (let tried = 0; tried < 0x7f; tried++) {
        const handle = ((lastHandle.get(ieeeAddr) ?? 0) % 0x7f) + 1;
        lastHandle.set(ieeeAddr, handle);
        if (!pendingEchoes.has(`${ieeeAddr}/${handle}`)) {
            return handle;
        }
    }
    throw new Error(`All 127 handles of ${ieeeAddr} wait for an echo`);
}

function serialized(ieeeAddr, task) {
    const run = (queues.get(ieeeAddr) ?? Promise.resolve()).then(task, task);
    queues.set(
        ieeeAddr,
        run.catch(() => {}),
    );
    return run;
}

// system_mode and preset as last learned from each thermostat's status records and finished writes. seq counts the updates, so a
// command can tell whether anything was learned between its arrival and its turn in the queue.
const learned = new Map();

function learn(ieeeAddr, update) {
    const previous = learned.get(ieeeAddr) ?? { seq: 0 };
    learned.set(ieeeAddr, { ...previous, ...update, seq: previous.seq + 1 });
}

const learnedSeq = (ieeeAddr) => learned.get(ieeeAddr)?.seq ?? 0;

// zigbee2mqtt's state when the command arrived, or, if something was learned since, that state updated with what was learned.
function currentState(ieeeAddr, meta, seqAtArrival) {
    const state = meta.state ?? {};
    const known = learned.get(ieeeAddr);
    if (!known || known.seq === seqAtArrival) {
        return state;
    }
    const { seq, ...fields } = known;
    return { ...state, ...fields };
}

// Sends '<handle> <code> <args>' and resolves once the thermostat echoes the same handle and code.
async function writeB(endpoint, code, ...args) {
    const ieeeAddr = endpoint.deviceIeeeAddress;
    const handle = nextHandle(ieeeAddr);
    const key = `${ieeeAddr}/${handle}`;
    let resolveEcho;
    const echoed = new Promise((resolve) => {
        resolveEcho = resolve;
    });
    pendingEchoes.set(key, { code, resolve: resolveEcho });
    let timer;
    try {
        const payload = Buffer.from([handle, ...Buffer.from(code, "latin1"), ...args]);
        await endpoint.commandResponse(CLUSTER, "write", { payload }, { disableDefaultResponse: true, sendPolicy: "immediate" });
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`No ${code} echo from ${ieeeAddr} within ${ECHO_TIMEOUT_MS / 1000} s`)), ECHO_TIMEOUT_MS);
        });
        await Promise.race([echoed, timeout]);
    } finally {
        clearTimeout(timer);
        pendingEchoes.delete(key);
    }
}

// On is manual (permanent hold) plus the system mode, the pair the Salus gateway sends; another preset is written after it.
async function turnOn(endpoint, mode, preset) {
    await writeB(endpoint, "B20", HOLD_TYPE_SET.manual);
    await writeB(endpoint, "B48", SYSTEM_MODE_SET[mode]);
    if (preset !== "manual") {
        await writeB(endpoint, "B20", HOLD_TYPE_SET[preset]);
    }
}

// Two BCD bytes, value x100 (PROTOCOL.md section 5.1); undefined when they are not BCD.
function bcdCelsius(record, offset) {
    const value = Number(record.subarray(offset, offset + 2).toString("hex"));
    return Number.isFinite(value) ? value / 100 : undefined;
}

const fzStatus = {
    cluster: CLUSTER,
    type: "commandRecord",
    convert: (model, msg) => {
        const record = msg.data.payload;
        if (!Buffer.isBuffer(record) || record[0] !== RECORD_STATUS || record.length <= STATUS_HOLD_TYPE) {
            return;
        }
        const holdType = record[STATUS_HOLD_TYPE];
        if (HOLD_TYPES[holdType] === undefined) {
            logger.debug(`Unknown hold type ${holdType} from ${msg.device.ieeeAddr}`, NS);
            return;
        }
        // No preset while off (standby), so the cached preset stays the one to go back to.
        const result = { hold_type: HOLD_TYPES[holdType] };
        const scheduleSetpoint = record.length > STATUS_SCHEDULE_SETPOINT + 1 ? bcdCelsius(record, STATUS_SCHEDULE_SETPOINT) : undefined;
        if (scheduleSetpoint !== undefined) {
            result.schedule_setpoint = scheduleSetpoint;
        }
        const update = {};
        if (PRESETS[holdType] !== undefined) {
            result.preset = PRESETS[holdType];
            update.preset = result.preset;
        }
        // system_mode as the built-in status converter reads it.
        if (holdType === STANDBY) {
            update.system_mode = "off";
        } else if (record.length > STATUS_SYSTEM_MODE) {
            update.system_mode = record[STATUS_SYSTEM_MODE] === SYSTEM_MODE_SET.cool ? "cool" : "heat";
        }
        learn(msg.device.ieeeAddr, update);
        return result;
    },
};

// An echo is the write's payload: the handle, the code, the arguments.
function receivedEcho(device, echo) {
    if (!Buffer.isBuffer(echo) || echo.length < 4) {
        return;
    }
    const pending = pendingEchoes.get(`${device.ieeeAddr}/${echo[0]}`);
    if (pending?.code === echo.subarray(1, 4).toString("latin1")) {
        pending.resolve();
    }
}

const fzEcho = {
    cluster: CLUSTER,
    type: "raw",
    convert: (model, msg) => {
        const frame = msg.data;
        // A raw message is the whole ZCL frame. Cluster-specific frames only; the header is 5 bytes with a manufacturer code, else 3.
        if (!Buffer.isBuffer(frame) || frame.length < 3 || (frame[0] & 0x03) !== 0x01) {
            return;
        }
        const headerLength = (frame[0] & 0x04) !== 0 ? 5 : 3;
        if (frame[headerLength - 1] === ECHO) {
            receivedEcho(msg.device, frame.subarray(headerLength));
        }
    },
};

// The same echo once the cluster declares 0x33 as "echo".
const fzEchoParsed = {
    cluster: CLUSTER,
    type: "commandEcho",
    convert: (model, msg) => {
        receivedEcho(msg.device, msg.data?.payload);
    },
};

const tzSystemMode = {
    key: ["system_mode"],
    convertSet: async (entity, key, value, meta) => {
        utils.assertEndpoint(entity);
        if (value !== "off" && SYSTEM_MODE_SET[value] === undefined) {
            throw new Error(`system_mode must be off, heat or cool, got ${value}`);
        }
        const ieeeAddr = entity.deviceIeeeAddress;
        const seqAtArrival = learnedSeq(ieeeAddr);
        return await serialized(ieeeAddr, async () => {
            const state = currentState(ieeeAddr, meta, seqAtArrival);
            if (value === "off") {
                await writeB(entity, "B20", STANDBY);
                learn(ieeeAddr, { system_mode: "off" });
                return { state: { system_mode: "off", hold_type: "standby" } };
            }
            if (state.system_mode === value) {
                logger.debug(`${ieeeAddr} is already ${value}, nothing written`, NS);
                return { state: { system_mode: value } };
            }
            const preset = resumePreset(state.preset);
            await turnOn(entity, value, preset);
            learn(ieeeAddr, { system_mode: value, preset });
            return { state: { system_mode: value, preset, hold_type: preset } };
        });
    },
};

const tzPreset = {
    key: ["preset"],
    convertSet: async (entity, key, value, meta) => {
        utils.assertEndpoint(entity);
        if (HOLD_TYPE_SET[value] === undefined) {
            throw new Error(`preset must be one of ${Object.keys(HOLD_TYPE_SET).join(", ")}, got ${value}`);
        }
        const ieeeAddr = entity.deviceIeeeAddress;
        const seqAtArrival = learnedSeq(ieeeAddr);
        return await serialized(ieeeAddr, async () => {
            const mode = currentState(ieeeAddr, meta, seqAtArrival).system_mode;
            // A preset turns a thermostat that is off (or not reported yet) on in heat.
            if (SYSTEM_MODE_SET[mode] === undefined) {
                await turnOn(entity, "heat", value);
                learn(ieeeAddr, { system_mode: "heat", preset: value });
                return { state: { system_mode: "heat", preset: value, hold_type: value } };
            }
            await writeB(entity, "B20", HOLD_TYPE_SET[value]);
            learn(ieeeAddr, { preset: value });
            return { state: { preset: value, hold_type: value } };
        });
    },
};

// The built-in climate expose, with the preset added.
const climate = e
    .climate()
    .withSetpoint("current_heating_setpoint", 5, 40, 0.5, ea.STATE_SET)
    .withLocalTemperature(ea.STATE)
    .withSystemMode(["off", "heat", "cool"], ea.STATE_SET)
    .withRunningState(["idle", "heat"], ea.STATE)
    .withPreset(
        Object.keys(HOLD_TYPE_SET),
        "schedule follows the thermostat's own program (a changed setpoint holds until its next step), manual keeps the " +
            "setpoint, away uses the away setpoint. Turning on after off goes back to the preset the thermostat had",
    );

const holdType = e
    .enum("hold_type", ea.STATE, Object.values(HOLD_TYPES))
    .withDescription("Hold type the thermostat reports; temporary_hold is the schedule with a changed setpoint, standby is off")
    .withCategory("diagnostic");

const scheduleSetpoint = e
    .numeric("schedule_setpoint", ea.STATE)
    .withUnit("°C")
    .withDescription("Setpoint the thermostat's own schedule asks for now; on schedule the active setpoint differs only in a temporary hold");

const ownExposes = [holdType, scheduleSetpoint];
const ownNames = new Set(ownExposes.map((expose) => expose.name));

const thermostat = {
    ...base,
    fromZigbee: [...(base.fromZigbee ?? []), fzStatus, fzEcho, fzEchoParsed],
    toZigbee: [tzSystemMode, tzPreset, ...(base.toZigbee ?? [])],
    exposes: [climate, ...base.exposes.filter((expose) => expose.type !== "climate" && !ownNames.has(expose.name)), ...ownExposes],
};

export default [
    thermostat,
    {
        ...thermostat,
        zigbeeModel: ["SQ610RF", "SQ610RF(WB)"],
        model: "SQ610RF",
        description: "Quantum wireless thermostat (SQ610RF)",
    },
];
