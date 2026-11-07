// Stopgap for zigbee-herdsman-converters 26.125.0: lets the Salus KL08RF wiring centre report its zone table.
//
// The built-in KL08RF definition greets the wiring centre but cannot read which thermostat holds which zone. This keeps
// that definition as it is and adds zone_1 to zone_8: the IEEE address of the thermostat in each zone, its short address
// when no device has it, null while the zone is free. The table is asked for when zigbee2mqtt starts and on a get of any
// zone; the wiring centre also sends it by itself at boot and after each pairing. Only reads, never pairs or changes zones.
//
// It talks to the wiring centre only, which is mains powered; it never sends anything to a thermostat.
// The reply is taken both as a raw frame (zigbee2mqtt 2.14) and as a parsed command, in case a later zigbee2mqtt declares 0x33.
// Zone sensors that a later built-in definition has are not added twice.
//
// Protocol from mikkelke/salus-zigbee (converters/salus_sq610rfnh.mjs, PROTOCOL.md section 8).
// Remove once zigbee2mqtt's built-in KL08RF definition has the zone table.
import { definitions } from "zigbee-herdsman-converters/devices/salus_controls";
import * as exposes from "zigbee-herdsman-converters/lib/exposes";
import { logger } from "zigbee-herdsman-converters/lib/logger";

const NS = "zhc:salus_kl08rf_zones";
const e = exposes.presets;
const ea = exposes.access;

const CLUSTER = "manuSpecificSalusIt600";
const ENDPOINT = 8;
const ZONE_KEYS = Array.from({ length: 8 }, (_, index) => `zone_${index + 1}`);

// The wiring centre answers B70 with command 0x33: the handle, "B70", five zero bytes and a count byte, then from byte 10
// one 3-byte slot per zone: the short address of the thermostat (big-endian) and a flag byte. 0xFFFF marks a free zone.
// The built-in cluster does not declare 0x33, so herdsman hands the frame over as a raw message.
const ECHO = 0x33;
const FIRST_SLOT = 10;
const SLOT_LENGTH = 3;
const TABLE_LENGTH = FIRST_SLOT + SLOT_LENGTH * ZONE_KEYS.length;
const FREE_ZONE = 0xffff;

// The Salus gateway's request for the table, sent as a B-command write (0x32) with a handle in front. Nothing else
// writes to the wiring centre, so a fixed handle is safe.
const HANDLE = 0x70;
const REQUEST = Buffer.from([HANDLE, ...Buffer.from("B70", "latin1"), 0x7e, 0xaa, 0xaa, 0xa8, 0x80, 0x00, 0x00, 0x00, 0x78]);

// The request at zigbee2mqtt start waits this long, and is dropped if zigbee2mqtt stops first.
const START_DELAY_MS = 10_000;
const startTimers = new Map();

const base = definitions.find((definition) => definition.model === "KL08RF");
if (!base) {
    throw new Error("No built-in KL08RF definition in this zigbee-herdsman-converters; remove salus_kl08rf_zones.mjs");
}
const baseExposes = Array.isArray(base.exposes) ? base.exposes : [];
const builtInZones = new Set(baseExposes.map((expose) => expose.name).filter((name) => ZONE_KEYS.includes(name)));
if (builtInZones.size > 0) {
    logger.info("The built-in KL08RF definition has zone sensors now: check whether salus_kl08rf_zones.mjs is still needed", NS);
}

const shortAddress = (address) => `0x${address.toString(16).padStart(4, "0")}`;

// herdsman does not export its Device class, but that is the class of `device`, and it finds a device by network address.
const zoneName = (device, address) => device.constructor.byNetworkAddress?.(address)?.ieeeAddr ?? shortAddress(address);

const requestZoneTable = (endpoint) =>
    endpoint.commandResponse(CLUSTER, "write", { payload: REQUEST }, { disableDefaultResponse: true, sendPolicy: "immediate" });

// The 0x33 payload: the handle, "B70", then the table. Anything else is not a zone table.
function zoneTable(device, payload) {
    if (!Buffer.isBuffer(payload) || payload.subarray(1, 4).toString("latin1") !== "B70") {
        return;
    }
    if (payload.length < TABLE_LENGTH) {
        logger.warning(`Short zone table (${payload.length} bytes) from ${device.ieeeAddr}: ${payload.toString("hex")}`, NS);
        return;
    }
    const table = {};
    ZONE_KEYS.forEach((key, index) => {
        const address = payload.readUInt16BE(FIRST_SLOT + SLOT_LENGTH * index);
        table[key] = address === FREE_ZONE ? null : zoneName(device, address);
    });
    logger.info(`Zone table from ${device.ieeeAddr}: ${JSON.stringify(table)}`, NS);
    return table;
}

const fzZoneTable = {
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
            return zoneTable(msg.device, frame.subarray(headerLength));
        }
    },
};

// The same reply once the cluster declares 0x33 as "echo".
const fzZoneTableParsed = {
    cluster: CLUSTER,
    type: "commandEcho",
    convert: (model, msg) => zoneTable(msg.device, msg.data?.payload),
};

const tzZoneTable = {
    key: ZONE_KEYS,
    // A get on any zone asks for the whole table.
    convertGet: async (entity) => {
        await requestZoneTable(entity);
    },
};

export default {
    ...base,
    fromZigbee: [...(base.fromZigbee ?? []), fzZoneTable, fzZoneTableParsed],
    toZigbee: [...(base.toZigbee ?? []), tzZoneTable],
    exposes: [
        ...baseExposes,
        ...ZONE_KEYS.filter((key) => !builtInZones.has(key)).map((key) =>
            e
                .text(key, ea.STATE_GET)
                .withDescription(
                    `IEEE address of the thermostat in zone ${key.slice(5)}, its short address while no device has it, null while the zone is free`,
                ),
        ),
    ],
    onEvent: async (event) => {
        await base.onEvent?.(event);
        if (event.type === "stop") {
            clearTimeout(startTimers.get(event.data.ieeeAddr));
            startTimers.delete(event.data.ieeeAddr);
        } else if (event.type === "start") {
            // This handler runs before the built-in extends, which add the Salus cluster to the device on start, so wait a little.
            const { device } = event.data;
            clearTimeout(startTimers.get(device.ieeeAddr));
            startTimers.set(
                device.ieeeAddr,
                setTimeout(() => {
                    startTimers.delete(device.ieeeAddr);
                    const endpoint = device.getEndpoint(ENDPOINT);
                    if (!endpoint) {
                        return;
                    }
                    requestZoneTable(endpoint).catch((error) =>
                        logger.warning(`Zone table request to ${device.ieeeAddr} failed (${error.message})`, NS),
                    );
                }, START_DELAY_MS),
            );
        }
    },
};
