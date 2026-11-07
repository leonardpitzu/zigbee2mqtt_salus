// Mock test of salus_it600_thermostats.mjs against zigbee-herdsman-converters 26.125.0 / zigbee-herdsman 11.2.0.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import * as zhc from "zigbee-herdsman-converters";
import { Zcl } from "zigbee-herdsman";
import overlays from "../converters/salus_it600_thermostats.mjs";

const CLUSTER = "manuSpecificSalusIt600";

class MockDevice {
    constructor(modelID, ieeeAddr) {
        this.type = "EndDevice";
        this.manufacturerName = "SALUS";
        this.manufacturerID = 0x1078;
        this.modelID = modelID;
        this.ieeeAddr = ieeeAddr;
        this.customClusters = {};
        this.sent = [];
        this.echo = true;
        const device = this;
        // zhc's assertEndpoint checks the class name.
        class Endpoint {}
        this.endpoint = Object.assign(new Endpoint(), {
            ID: 9,
            deviceIeeeAddress: ieeeAddr,
            commandResponse: async (cluster, command, { payload }, options) => {
                assert.equal(cluster, CLUSTER);
                assert.equal(command, "write");
                assert.deepEqual(options, { disableDefaultResponse: true, sendPolicy: "immediate" });
                device.lastHandle = payload[0];
                device.sent.push(payload.toString("latin1", 1, 4) + " " + payload.subarray(4).toString("hex"));
                if (device.echo) {
                    // The thermostat's echo: fc 0x1d (specific, manufacturer specific, server to client, no default response).
                    setImmediate(() => device.deliverRaw(Buffer.from([0x1d, 0x78, 0x10, 0x01, 0x33, ...payload])));
                }
            },
        });
        this.endpoints = [this.endpoint];
    }
    getEndpoint(id) {
        return id === 9 ? this.endpoint : undefined;
    }
    addCustomCluster(name, definition) {
        this.customClusters[name] = definition;
    }
    deliverRaw(frame) {
        for (const c of this.definition.fromZigbee.filter((c) => c.cluster === CLUSTER && c.type === "raw")) {
            c.convert(this.definition, { data: frame, device: this, endpoint: this.endpoint, type: "raw", cluster: CLUSTER }, () => {}, {}, {});
        }
    }
}

const rfnh = new MockDevice("SQ610RFNH", "0x001e5e09028e5a71");
const rf = new MockDevice("SQ610RF", "0x001e5e090902bb5c");

// A 0x71 status record with the given hold type, as the thermostat sends it (fields from PROTOCOL.md 5.2).
function statusRecord(holdType) {
    const r = Buffer.alloc(50);
    r[0] = 0x71;
    r[3] = holdType;
    r.writeUInt16BE(0x2250, 4); // 22.50 °C
    r.writeUInt16BE(0x2050, 9); // setpoint 20.50
    r.writeUInt16BE(0x2100, 11); // schedule setpoint 21.00
    r[15] = 4; // heat
    r[24] = 0x48; // humidity 48
    r[49] = 4; // battery 75
    return r;
}

function fromRecord(device, holdType) {
    const result = {};
    for (const c of device.definition.fromZigbee.filter((c) => c.cluster === CLUSTER && c.type === "commandRecord")) {
        Object.assign(result, c.convert(device.definition, { data: { payload: statusRecord(holdType) }, device, endpoint: device.endpoint }, () => {}, {}, {}) ?? {});
    }
    return result;
}

const tz = (device, key) => device.definition.toZigbee.find((c) => c.key.includes(key));
const set = (device, key, value, state) => {
    device.sent.length = 0;
    return tz(device, key).convertSet(device.endpoint, key, value, { state, message: { [key]: value }, device });
};

test("both models get the overlay, the RFNH over the built-in definition", async () => {
    zhc.addExternalDefinition(overlays[0]);
    zhc.addExternalDefinition(overlays[1]);
    rfnh.definition = await zhc.findByDevice(rfnh);
    rf.definition = await zhc.findByDevice(rf);
    assert.equal(rfnh.definition.model, "SQ610RFNH");
    assert.equal(rfnh.definition.description, "Quantum wireless thermostat");
    assert.equal(rf.definition.model, "SQ610RF");
    assert.equal(rf.definition.description, "Quantum wireless thermostat (SQ610RF)");
    assert.deepEqual(overlays[1].zigbeeModel, ["SQ610RF", "SQ610RF(WB)"]);
    for (const d of [rfnh, rf]) {
        assert.ok(tz(d, "preset"), "preset converter");
        const climate = d.definition.exposes.find((x) => x.type === "climate");
        const preset = climate.features.find((f) => f.name === "preset");
        assert.deepEqual(preset.values, ["schedule", "manual", "away"]);
        assert.deepEqual(
            climate.features.map((f) => f.name).sort(),
            ["current_heating_setpoint", "local_temperature", "preset", "running_state", "system_mode"],
        );
        const names = d.definition.exposes.map((x) => x.name ?? x.type);
        for (const n of ["humidity", "battery", "child_lock", "wiring_centre_zones", "hold_type"]) assert.ok(names.includes(n), n);
        assert.equal(names.filter((n) => n === "climate").length, 1);
    }
});

test("our system_mode converter is the one zigbee2mqtt picks; setpoint and lock stay built-in", () => {
    const builtIn = zhc.definitions?.find?.((x) => x.model === "SQ610RFNH");
    for (const d of [rfnh, rf]) {
        assert.equal(tz(d, "system_mode"), overlays[0].toZigbee[0]);
        assert.equal(tz(d, "preset"), overlays[0].toZigbee[1]);
        assert.ok(tz(d, "current_heating_setpoint") && tz(d, "current_heating_setpoint") !== overlays[0].toZigbee[0]);
        assert.ok(tz(d, "child_lock"));
        assert.ok(tz(d, "wiring_centre_zones"));
    }
    void builtIn;
});

test("status records: hold type and preset; off keeps no preset; built-in fields still parsed", () => {
    for (const d of [rfnh, rf]) {
        assert.deepEqual(
            { ...fromRecord(d, 0), local_temperature: undefined },
            {
                current_heating_setpoint: 20.5, system_mode: "heat", running_state: "idle", child_lock: "UNLOCK", humidity: 48,
                battery: 75, local_temperature: undefined, hold_type: "schedule", preset: "schedule", schedule_setpoint: 21,
            },
        );
        assert.equal(fromRecord(d, 0).local_temperature, 22.5);
        assert.deepEqual([fromRecord(d, 1).hold_type, fromRecord(d, 1).preset], ["temporary_hold", "schedule"]);
        assert.deepEqual([fromRecord(d, 2).hold_type, fromRecord(d, 2).preset], ["manual", "manual"]);
        assert.deepEqual([fromRecord(d, 6).hold_type, fromRecord(d, 6).preset], ["away", "away"]);
        const off = fromRecord(d, 7);
        assert.equal(off.system_mode, "off");
        assert.equal(off.hold_type, "standby");
        assert.ok(!("preset" in off), "no preset while off");
    }
});

test("herdsman cannot parse the thermostat's 0x33 echo, so it arrives raw on the Salus cluster", async () => {
    await rfnh.definition.onEvent({ type: "start", data: { device: rfnh, deviceExposesChanged() {}, state: {}, options: {} } });
    assert.ok(rfnh.customClusters[CLUSTER], "built-in extend added the cluster");
    const frame = Buffer.from([0x1d, 0x78, 0x10, 0x01, 0x33, 0x05, ...Buffer.from("B20"), 0x02]);
    assert.throws(() => Zcl.Frame.fromBuffer(0xfc00, Zcl.Header.fromBuffer(frame), frame, rfnh.customClusters));
    assert.equal(Zcl.Utils.getCluster(0xfc00, 0x1078, rfnh.customClusters).name, CLUSTER);
    // The write command the converter sends exists in the built-in cluster and serialises as expected.
    const w = Zcl.Frame.create(Zcl.FrameType.SPECIFIC, Zcl.Direction.SERVER_TO_CLIENT, true, 0x1078, 7, "write", CLUSTER,
        { payload: Buffer.from([0x05, ...Buffer.from("B20"), 0x00]) }, rfnh.customClusters);
    assert.equal(w.toBuffer().toString("hex"), "1d78100732054232300" + "0");
});

test("on after off goes back to schedule: B20 02, B48 04, then B20 00", async () => {
    for (const d of [rfnh, rf]) {
        const r = await set(d, "system_mode", "heat", { system_mode: "off", preset: "schedule", hold_type: "standby" });
        assert.deepEqual(d.sent, ["B20 02", "B48 04", "B20 00"]);
        assert.deepEqual(r, { state: { system_mode: "heat", preset: "schedule", hold_type: "schedule" } });
    }
});

test("on after off goes back to manual or away", async () => {
    await set(rf, "system_mode", "heat", { system_mode: "off", preset: "manual" });
    assert.deepEqual(rf.sent, ["B20 02", "B48 04"]);
    await set(rf, "system_mode", "heat", { system_mode: "off", preset: "away" });
    assert.deepEqual(rf.sent, ["B20 02", "B48 04", "B20 06"]);
});

test("on with no preset known yet is manual, as the built-in", async () => {
    const r = await set(rfnh, "system_mode", "heat", {});
    assert.deepEqual(rfnh.sent, ["B20 02", "B48 04"]);
    assert.equal(r.state.preset, "manual");
});

test("on while already on writes nothing, so a running schedule stays", async () => {
    for (const d of [rfnh, rf]) {
        const r = await set(d, "system_mode", "heat", { system_mode: "heat", preset: "schedule", hold_type: "temporary_hold" });
        assert.deepEqual(d.sent, []);
        assert.deepEqual(r, { state: { system_mode: "heat" } });
    }
});

test("off is standby only", async () => {
    const r = await set(rf, "system_mode", "off", { system_mode: "heat", preset: "schedule" });
    assert.deepEqual(rf.sent, ["B20 07"]);
    assert.deepEqual(r, { state: { system_mode: "off", hold_type: "standby" } });
});

test("preset while on writes only the hold type", async () => {
    await set(rfnh, "preset", "away", { system_mode: "heat", preset: "schedule" });
    assert.deepEqual(rfnh.sent, ["B20 06"]);
    await set(rfnh, "preset", "schedule", { system_mode: "heat", preset: "manual" });
    assert.deepEqual(rfnh.sent, ["B20 00"]);
    await set(rfnh, "preset", "manual", { system_mode: "heat", preset: "schedule" });
    assert.deepEqual(rfnh.sent, ["B20 02"]);
});

test("preset while off turns on in heat with that preset", async () => {
    let r = await set(rf, "preset", "schedule", { system_mode: "off", preset: "manual" });
    assert.deepEqual(rf.sent, ["B20 02", "B48 04", "B20 00"]);
    assert.deepEqual(r, { state: { system_mode: "heat", preset: "schedule", hold_type: "schedule" } });
    r = await set(rf, "preset", "manual", { system_mode: "off" });
    assert.deepEqual(rf.sent, ["B20 02", "B48 04"]);
});

test("bad values are refused before anything is sent", async () => {
    await assert.rejects(set(rfnh, "preset", "follow_schedule", { system_mode: "heat" }), /preset must be one of/);
    await assert.rejects(set(rfnh, "system_mode", "auto", { system_mode: "heat" }), /system_mode must be/);
    assert.deepEqual(rfnh.sent, []);
});

test("writes to one thermostat wait for each other", async () => {
    rf.sent.length = 0;
    const a = tz(rf, "system_mode").convertSet(rf.endpoint, "system_mode", "heat", { state: { system_mode: "off", preset: "schedule" }, message: {} });
    const b = tz(rf, "preset").convertSet(rf.endpoint, "preset", "away", { state: { system_mode: "heat", preset: "schedule" }, message: {} });
    await Promise.all([a, b]);
    assert.deepEqual(rf.sent, ["B20 02", "B48 04", "B20 00", "B20 06"]);
});

test("no echo fails after 30 s and frees the queue", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        rfnh.echo = false;
        const p = set(rfnh, "system_mode", "off", { system_mode: "heat" });
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(rfnh.sent, ["B20 07"]);
        mock.timers.tick(30_000);
        await assert.rejects(p, /No B20 echo from 0x001e5e09028e5a71 within 30 s/);
    } finally {
        mock.timers.reset();
        rfnh.echo = true;
    }
    await set(rfnh, "system_mode", "off", { system_mode: "heat" });
    assert.deepEqual(rfnh.sent, ["B20 07"]);
});

test("an echo with another code or handle does not count", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        rf.echo = false;
        const p = set(rf, "system_mode", "off", { system_mode: "heat" });
        await new Promise((resolve) => setImmediate(resolve));
        rf.deliverRaw(Buffer.from([0x1d, 0x78, 0x10, 0x01, 0x33, (rf.lastHandle % 0x7f) + 1, ...Buffer.from("B20"), 0x07])); // wrong handle
        rf.deliverRaw(Buffer.from([0x1d, 0x78, 0x10, 0x01, 0x33, rf.lastHandle, ...Buffer.from("B34"), 0x40])); // wrong code
        mock.timers.tick(30_000);
        await assert.rejects(p, /No B20 echo/);
    } finally {
        mock.timers.reset();
        rf.echo = true;
    }
});

const call = (device, key, value, state) => tz(device, key).convertSet(device.endpoint, key, value, { state, message: { [key]: value }, device });

test("an on queued behind an off sees the off, not zigbee2mqtt's state from before it", async () => {
    await set(rfnh, "preset", "schedule", { system_mode: "heat", preset: "manual" });
    rfnh.sent.length = 0;
    // Both arrive before the off is done, so zigbee2mqtt still says heat for both.
    const before = { system_mode: "heat", preset: "schedule" };
    const [off, on] = await Promise.all([call(rfnh, "system_mode", "off", before), call(rfnh, "system_mode", "heat", before)]);
    assert.deepEqual(rfnh.sent, ["B20 07", "B20 02", "B48 04", "B20 00"]);
    assert.deepEqual(off, { state: { system_mode: "off", hold_type: "standby" } });
    assert.deepEqual(on, { state: { system_mode: "heat", preset: "schedule", hold_type: "schedule" } });
});

test("a second on queued behind off and on writes nothing", async () => {
    await set(rf, "preset", "schedule", { system_mode: "heat", preset: "away" });
    rf.sent.length = 0;
    const before = { system_mode: "heat", preset: "schedule" };
    const results = await Promise.all([
        call(rf, "system_mode", "off", before),
        call(rf, "system_mode", "heat", before),
        call(rf, "system_mode", "heat", before),
    ]);
    assert.deepEqual(rf.sent, ["B20 07", "B20 02", "B48 04", "B20 00"]);
    assert.deepEqual(results[2], { state: { system_mode: "heat" } });
});

test("a status record that arrives while a command waits is taken into account", async () => {
    rf.sent.length = 0;
    rf.echo = false;
    const stale = { system_mode: "heat", preset: "manual" };
    const first = call(rf, "preset", "schedule", stale);
    const second = call(rf, "system_mode", "heat", stale);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rf.sent, ["B20 00"]);
    // Turned off at the thermostat while the first write waits for its echo.
    fromRecord(rf, 7);
    rf.echo = true;
    rf.deliverRaw(Buffer.from([0x1d, 0x78, 0x10, 0x01, 0x33, rf.lastHandle, ...Buffer.from("B20"), 0x00]));
    await first;
    const r = await second;
    assert.deepEqual(rf.sent, ["B20 00", "B20 02", "B48 04", "B20 00"]);
    assert.deepEqual(r, { state: { system_mode: "heat", preset: "schedule", hold_type: "schedule" } });
});

test("a command that did not wait uses zigbee2mqtt's state as is", async () => {
    // Whatever the converter learned earlier, a command that runs at once trusts the state zigbee2mqtt passes.
    const r = await set(rf, "system_mode", "heat", { system_mode: "off", preset: "away" });
    assert.deepEqual(rf.sent, ["B20 02", "B48 04", "B20 06"]);
    assert.equal(r.state.preset, "away");
});

test("a preset saved under the old name permanent_hold goes back to manual", async () => {
    const r = await set(rfnh, "system_mode", "heat", { system_mode: "off", preset: "permanent_hold" });
    assert.deepEqual(rfnh.sent, ["B20 02", "B48 04"]);
    assert.deepEqual(r, { state: { system_mode: "heat", preset: "manual", hold_type: "manual" } });
    await assert.rejects(set(rfnh, "preset", "permanent_hold", { system_mode: "heat" }), /preset must be one of schedule, manual, away/);
});

test("schedule_setpoint is in the exposes once, read only, and comes from status bytes 11-12", () => {
    for (const d of [rfnh, rf]) {
        const names = d.definition.exposes.map((x) => x.name ?? x.type);
        assert.equal(new Set(names).size, names.length, `no expose twice: ${names.join(", ")}`);
        const sp = d.definition.exposes.find((x) => x.name === "schedule_setpoint");
        assert.equal(sp.access, 1, "state only, so nothing ever asks the thermostat for it");
        assert.equal(sp.unit, "°C");
        assert.equal(fromRecord(d, 1).schedule_setpoint, 21);
    }
    assert.ok(!tz(rf, "schedule_setpoint"), "no converter that could read it from the thermostat");
});

test("an echo that herdsman parses as a command completes the write too", async () => {
    // A later zigbee2mqtt may declare 0x33; then the echo arrives as commandEcho, not raw.
    rfnh.sent.length = 0;
    rfnh.echo = false;
    const parsed = rfnh.definition.fromZigbee.filter((c) => c.cluster === CLUSTER && c.type === "commandEcho");
    assert.equal(parsed.length, 1);
    const p = call(rfnh, "system_mode", "off", { system_mode: "heat" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rfnh.sent, ["B20 07"]);
    parsed[0].convert(rfnh.definition, { data: { payload: Buffer.from([rfnh.lastHandle, ...Buffer.from("B20"), 0x07]) }, device: rfnh, endpoint: rfnh.endpoint, type: "commandEcho", cluster: CLUSTER }, () => {}, {}, {});
    assert.deepEqual(await p, { state: { system_mode: "off", hold_type: "standby" } });
    rfnh.echo = true;
});

test("nothing is sent to a thermostat unless zigbee2mqtt is asked to set something", async () => {
    // Battery: start, status records and echoes must not make the converter transmit.
    rf.sent.length = 0;
    await rf.definition.onEvent?.({ type: "start", data: { device: rf, deviceExposesChanged() {}, state: {}, options: {} } });
    fromRecord(rf, 0);
    fromRecord(rf, 7);
    rf.deliverRaw(Buffer.from([0x1d, 0x78, 0x10, 0x01, 0x33, 0x05, ...Buffer.from("B20"), 0x00]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(rf.sent, []);
    assert.ok(rf.definition.toZigbee.every((c) => !c.convertGet || !c.key.some((k) => ["system_mode", "preset", "hold_type", "schedule_setpoint"].includes(k))));
});
