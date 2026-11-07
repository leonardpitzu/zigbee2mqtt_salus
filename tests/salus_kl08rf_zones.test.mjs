// Mock test of salus_kl08rf_zones.mjs against zigbee-herdsman-converters 26.125.0 / zigbee-herdsman 11.2.0.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as zhc from "zigbee-herdsman-converters";
import { Zcl } from "zigbee-herdsman";
import overlay from "../converters/salus_kl08rf_zones.mjs";

const CLUSTER = "manuSpecificSalusIt600";
const KNOWN = new Map([
    [0x1111, "0x001e5e090902bb5c"],
    [0x4444, "0x001e5e090902b6ba"],
]);

const sent = [];
class MockDevice {
    static byNetworkAddress(address) {
        const ieeeAddr = KNOWN.get(address);
        return ieeeAddr ? { ieeeAddr } : undefined;
    }
    constructor() {
        this.type = "Router";
        this.manufacturerName = "Computime";
        this.manufacturerID = 0x1078;
        this.modelID = undefined;
        this.ieeeAddr = "0x001e5e090902467b";
        this.customClusters = {};
        const endpoint = {
            ID: 8,
            profileID: 260,
            deviceIeeeAddress: this.ieeeAddr,
            commandResponse: async (...args) => {
                // Like herdsman, the cluster has to exist on the device when the command is made.
                assert.ok(this.customClusters[args[0]], `cluster ${args[0]} not added yet`);
                sent.push(args);
            },
        };
        this.endpoints = [endpoint];
    }
    getEndpoint(id) {
        return this.endpoints.find((e) => e.ID === id);
    }
    addCustomCluster(name, definition) {
        this.customClusters[name] = definition;
    }
}

const device = new MockDevice();
const eventData = { device, deviceExposesChanged: () => {}, state: {}, options: {} };

// 0x33 reply: fc 0x15 (specific, manufacturer specific, client to server, no default response), code 0x1078, tsn, command.
function echoFrame(payload, command = 0x33) {
    return Buffer.from([0x15, 0x78, 0x10, 0x42, command, ...payload]);
}
const slot = (address) => [address >> 8, address & 0xff, 0x00];
const tablePayload = Buffer.from([
    0x70, ...Buffer.from("B70"), 0, 0, 0, 0, 0, 0x08,
    ...slot(0x1111), ...slot(0xffff), ...slot(0x2222), ...slot(0x4444),
    ...slot(0xffff), ...slot(0xffff), ...slot(0xffff), ...slot(0xffff),
]);

let builtIn;
let definition;

test("built-in definition matches the wiring centre without the overlay", async () => {
    builtIn = await zhc.findByDevice(device);
    assert.equal(builtIn.model, "KL08RF");
    assert.ok(!builtIn.exposes.some?.((e) => e.name === "zone_1"));
});

test("overlay wins over the built-in definition", async () => {
    zhc.addExternalDefinition(overlay);
    definition = await zhc.findByDevice(device);
    assert.equal(definition.model, "KL08RF");
    assert.equal(definition.description, builtIn.description);
    const names = definition.exposes.map((e) => e.name);
    for (let i = 1; i <= 8; i++) assert.ok(names.includes(`zone_${i}`), `zone_${i} exposed`);
    // The built-in greeting converter is still there.
    assert.ok(definition.fromZigbee.some((c) => c.type === "commandSyncRequest"));
    assert.ok(definition.fromZigbee.some((c) => c.type === "raw" && c.cluster === CLUSTER));
    assert.ok(definition.toZigbee.some((c) => c.key.includes("zone_5") && c.convertGet));
});

test("start adds the Salus cluster and asks for the table after the delay", { timeout: 15000 }, async () => {
    await definition.onEvent({ type: "start", data: eventData });
    assert.ok(device.customClusters[CLUSTER], "built-in extend added the cluster");
    assert.equal(sent.length, 0, "nothing sent right away");
    await new Promise((resolve) => setTimeout(resolve, 10_500));
    assert.equal(sent.length, 1);
    const [cluster, command, { payload }, options] = sent[0];
    assert.equal(cluster, CLUSTER);
    assert.equal(command, "write");
    assert.equal(payload.toString("hex"), "704237307eaaaaa88000000078");
    assert.deepEqual(options, { disableDefaultResponse: true, sendPolicy: "immediate" });
});

test("stop drops a pending start request", { timeout: 15000 }, async () => {
    sent.length = 0;
    await definition.onEvent({ type: "start", data: eventData });
    await definition.onEvent({ type: "stop", data: { ieeeAddr: device.ieeeAddr } });
    await new Promise((resolve) => setTimeout(resolve, 10_500));
    assert.equal(sent.length, 0);
});

test("herdsman can build the request frame with the built-in cluster", () => {
    const frame = Zcl.Frame.create(
        Zcl.FrameType.SPECIFIC, Zcl.Direction.SERVER_TO_CLIENT, true, 0x1078, 5, "write", CLUSTER,
        { payload: Buffer.from("704237307eaaaaa88000000078", "hex") }, device.customClusters,
    );
    assert.equal(frame.toBuffer().toString("hex"), "1d781005327042373" + "07eaaaaa88000000078");
});

test("herdsman cannot parse the 0x33 reply, so it arrives raw on the Salus cluster", () => {
    const buffer = echoFrame(tablePayload);
    const header = Zcl.Header.fromBuffer(buffer);
    assert.throws(() => Zcl.Frame.fromBuffer(0xfc00, header, buffer, device.customClusters));
    assert.equal(Zcl.Utils.getCluster(0xfc00, device.manufacturerID, device.customClusters).name, CLUSTER);
});

test("get on a zone sends the request", async () => {
    sent.length = 0;
    const tz = definition.toZigbee.find((c) => c.key.includes("zone_1") && c.convertGet);
    await tz.convertGet(device.getEndpoint(8), "zone_1", {});
    assert.equal(sent.length, 1);
    assert.equal(sent[0][2].payload.toString("hex"), "704237307eaaaaa88000000078");
});

test("zone table reply is published per zone", () => {
    const fz = definition.fromZigbee.find((c) => c.type === "raw" && c.cluster === CLUSTER);
    const result = fz.convert(definition, { data: echoFrame(tablePayload), device, endpoint: device.getEndpoint(8), type: "raw", cluster: CLUSTER }, () => {}, {}, {});
    assert.deepEqual(result, {
        zone_1: "0x001e5e090902bb5c",
        zone_2: null,
        zone_3: "0x2222",
        zone_4: "0x001e5e090902b6ba",
        zone_5: null,
        zone_6: null,
        zone_7: null,
        zone_8: null,
    });
});

test("other raw frames are ignored", () => {
    const fz = definition.fromZigbee.find((c) => c.type === "raw" && c.cluster === CLUSTER);
    const msg = (data) => ({ data, device, endpoint: device.getEndpoint(8), type: "raw", cluster: CLUSTER });
    assert.equal(fz.convert(definition, msg(echoFrame(Buffer.from([0x01, 0x02]), 0x37)), () => {}, {}, {}), undefined);
    assert.equal(fz.convert(definition, msg(echoFrame(Buffer.from([0x70, ...Buffer.from("B47"), 0, 0]))), () => {}, {}, {}), undefined);
    assert.equal(fz.convert(definition, msg(echoFrame(tablePayload.subarray(0, 20))), () => {}, {}, {}), undefined);
    assert.equal(fz.convert(definition, msg(Buffer.from([0x10, 0x01, 0x00])), () => {}, {}, {}), undefined);
});

test("the zone table is also taken when herdsman parses the reply as a command", () => {
    const parsed = definition.fromZigbee.find((c) => c.type === "commandEcho" && c.cluster === CLUSTER);
    assert.ok(parsed);
    const result = parsed.convert(definition, { data: { payload: tablePayload }, device, endpoint: device.getEndpoint(8), type: "commandEcho", cluster: CLUSTER }, () => {}, {}, {});
    assert.equal(result.zone_1, "0x001e5e090902bb5c");
    assert.equal(result.zone_2, null);
    assert.equal(parsed.convert(definition, { data: { payload: Buffer.from([0x05, ...Buffer.from("B20"), 0x02]) }, device, type: "commandEcho", cluster: CLUSTER }, () => {}, {}, {}), undefined);
});

test("each zone is exposed once", () => {
    const names = definition.exposes.map((e) => e.name).filter(Boolean);
    assert.equal(new Set(names).size, names.length);
});
