#!/usr/bin/env python3
"""Print a decoded timeline of Salus/Computime iT600 (cluster 0xFC00) frames.

Usage:
    SALUS_NWK_KEY=<32 hex chars> tools/decode_capture.py capture.pcap [--utc] [--raw]

Needs tshark. The capture must be 802.15.4 with FCS (link type 195). The
TC link key is the public ZigBeeAlliance09 key; the network key comes from
SALUS_NWK_KEY. Field names and confidence follow PROTOCOL.md.
"""

import argparse
import datetime as dt
import os
import subprocess
import sys

TC_LINK_KEY = "5A6967426565416C6C69616E63653039"
ZIGBEE_EPOCH = dt.datetime(2000, 1, 1)
REPEAT_WINDOW_S = 2.0

FIELDS = [
    "frame.time_epoch",
    "zbee_nwk.src",
    "zbee_nwk.dst",
    "zbee_nwk.seqno",
    "zbee_aps.src",
    "zbee_aps.dst",
    "zbee_aps.cluster",
    "zbee_zcl.cs.cmd.id",
    "data.data",
    "zbee_aps.zdp_cluster",
    "zbee_zcl.attr.str",
]

HOLD_TYPE = {0: "schedule", 1: "temporary-hold", 2: "permanent-hold", 6: "away", 7: "standby(off)", 10: "eco"}
SYSTEM_MODE = {1: "auto", 3: "cool", 4: "heat", 5: "emergency-heat"}
TZ_INDEX = [
    -46800, -43200, -39600, -36000, -32400, -28800, -25200, -21600, -18000, -14400,
    -10800, -7200, -3600, 0, 3600, 7200, 10800, 14400, 18000, 21600, 25200, 28800,
    32400, 36000, 39600, 43200, 46800, 50400, -34200, -16200, -12600, -11220, 12600,
    16200, 19800, 20700, 23400, 31500, 34200, 37800, 41400, 45900,
]


def bcd_x100(hi, lo):
    """Two BCD bytes -> value x100. Values >= 11000 encode negatives as 11000 - v."""
    v = (hi >> 4) * 1000 + (hi & 0xF) * 100 + (lo >> 4) * 10 + (lo & 0xF)
    return 11000 - v if v >= 11000 else v


def c(v):
    return f"{v / 100:.2f}"


def s8(b):
    return b - 256 if b > 127 else b


def setpoint_byte(b):
    return f"{(b - 0x20) * 0.5:.1f}C"


def short_be(b, i):
    return f"0x{b[i]:02x}{b[i + 1]:02x}"


def short_le(b, i):
    return f"0x{b[i + 1]:02x}{b[i]:02x}"


def dec_sync_request(p):
    if len(p) < 7:
        return p.hex()
    fw = int.from_bytes(p[3:7], "little")
    return f"sync-request device_type=0x{p[1]:02x} fw=0x{fw:08x} (b0=0x{p[0]:02x} b2=0x{p[2]:02x})"


def dec_sync_response(p):
    if len(p) < 15:
        return p.hex()
    secs = int.from_bytes(p[2:6], "little")
    local = ZIGBEE_EPOCH + dt.timedelta(seconds=secs)
    tz = TZ_INDEX[p[7]] if p[7] < len(TZ_INDEX) else None
    return (
        f"sync-response index=0x{p[0]:02x} status={p[1]} local_time={local:%Y-%m-%d %H:%M:%S} "
        f"dst_active={p[6] & 1} fmt24h={(p[6] >> 1) & 1} tz_index={p[7]} (utc{'' if tz is None else f'{tz / 3600:+g}'}) "
        f"dst_hours={p[8]} rx1={short_be(p, 9)} rx2={short_be(p, 11)} cloud={chr(p[13]) if 32 <= p[13] < 127 else p[13]}"
    )


def dec_status_71(p):
    out = [
        f"status#{p[1]}",
        f"b2=0x{p[2]:02x}",
        f"hold={HOLD_TYPE.get(p[3], p[3])}",
        f"temp={c(bcd_x100(p[4], p[5]))}",
        f"setpoint={c(bcd_x100(p[9], p[10]))}",
        f"sched_heat={c(bcd_x100(p[11], p[12]))}",
        f"sched_cool={c(bcd_x100(p[13], p[14]))}",
        f"mode={SYSTEM_MODE.get(p[15], p[15])}",
        f"running={p[17]}",
        f"humidity={(p[24] >> 4) * 10 + (p[24] & 0xF)}%",
        f"lock={p[23]}",
        f"b25=0x{p[25]:02x}",
        f"fmt24h={p[38]}",
        f"frost={c(bcd_x100(p[43], p[44]))}",
        f"battery={p[49]}/5",
        f"lqi={p[50]} rssi={s8(p[51])}",
    ]
    if p[6] or p[7]:
        out.append(f"ext_temp={c(bcd_x100(p[6], p[7]))}")
    errs = [i for i in range(18, 22) if p[i] & 0x0F]
    if errs:
        out.append("error_nibbles=" + "".join(f"{p[i]:02x}" for i in range(18, 22)))
    trv = [short_be(p, i) for i in range(26, 38, 2) if p[i:i + 2] != b"\xff\xff"]
    if trv:
        out.append("trv=" + ",".join(trv))
    return " ".join(out)


def dec_status_72(p):
    return (
        f"settings#{p[1]} display_humidity={p[5]} display_resolution={p[11]} ext_probe={p[15]} "
        f"max_heat={c(bcd_x100(p[22], p[23]))} min_heat={c(bcd_x100(p[24], p[25]))} "
        f"max_cool={c(bcd_x100(p[26], p[27]))} min_cool={c(bcd_x100(p[28], p[29]))} "
        f"pin_enabled={p[43]} b40-41={p[40]:02x}{p[41]:02x}"
    )


def dec_record(p):
    if not p:
        return ""
    t = p[0] & 0x7F
    if t == 0x71 and len(p) >= 52:
        return dec_status_71(p)
    if t == 0x72 and len(p) >= 44:
        return dec_status_72(p)
    body = p[2:].rstrip(b"\xff")
    return f"record 0x{t:02x}#{p[1]} {body.hex() or '(all ff)'}"


def dec_bcmd(p):
    if len(p) < 4:
        return p.hex()
    handle, code, a = p[0], p[1:4].decode("latin-1"), p[4:]
    head = f"handle=0x{handle:02x} {code}"
    if code == "B20" and a:
        return f"{head} set HoldType={HOLD_TYPE.get(a[0], a[0])}"
    if code == "B21" and a:
        return f"{head} set TimeFormat24Hour={a[0]}"
    if code == "B22" and a:
        return f"{head} set AllowUnlockFromDevice?={a[0]}"
    if code in ("B30", "B31", "B33", "B34") and a:
        name = {"B30": "AutoCoolingSetpoint", "B31": "AutoHeatingSetpoint",
                "B33": "CoolingSetpoint", "B34": "HeatingSetpoint"}[code]
        return f"{head} set {name}={setpoint_byte(a[0])}"
    if code == "B48" and a:
        return f"{head} set SystemMode={SYSTEM_MODE.get(a[0], a[0])}"
    if code == "B36":
        return f"{head} set PairedTRVShortID='{a.decode('latin-1').strip()}'"
    if code == "B47" and len(a) >= 16:
        zones = [str(i + 1) for i in range(8) if a[8 + i]]
        return (
            f"{head} wc-pair a0-1={a[0]:02x}{a[1]:02x} wc_no?={a[2] | a[3] << 8} "
            f"wc_short={short_le(a, 4)} state=0x{a[6]:02x} a7=0x{a[7]:02x} zones?={','.join(zones) or '-'}"
        )
    if code == "B70" and len(a) >= 54:
        slots = [short_be(a, 6 + 3 * i) for i in range(12)]
        used = [f"z{i + 1}={s}" for i, s in enumerate(slots) if s != "0xffff"]
        return f"{head} zone-table n={a[5]} {' '.join(used)} lqi={a[42]} rssi={s8(a[43])} tail={a[44:].hex()}"
    return f"{head} {a.hex()}"


def dec_fc00(cmd, p):
    if cmd == 0x10:
        return dec_sync_request(p)
    if cmd == 0x81:
        return dec_sync_response(p)
    if cmd == 0x30:
        return f"record-request {p.hex()}"
    if cmd == 0x31:
        return dec_record(p)
    if cmd == 0x32:
        return "write " + dec_bcmd(p)
    if cmd == 0x33:
        return "reply " + dec_bcmd(p)
    if cmd == 0x12 and len(p) >= 18:
        return (
            f"zone-report zone={p[3]} temp={c(int.from_bytes(p[12:14], 'little', signed=True))} "
            f"setpoint={c(int.from_bytes(p[14:16], 'little', signed=True))} "
            f"frost?={c(int.from_bytes(p[16:18], 'little', signed=True))} "
            f"rest={p[:3].hex()}.{p[4:12].hex()}"
        )
    if cmd == 0x18 and len(p) >= 2:
        return f"wc-pair-request zone={p[1]} {p.hex()}"
    if cmd == 0x88:
        return f"wc-pair-ack status=0x{p[0]:02x} {p.hex()}"
    if cmd == 0x14 and len(p) >= 2:
        return f"wc-pair-confirm zone={p[1]} {p.hex()}"
    if cmd == 0x84 and len(p) >= 3:
        return f"wc-pair-done zone={p[1]} status=0x{p[2]:02x}"
    return p.hex()


def is_repeat(first_heard, key, t, window=REPEAT_WINDOW_S):
    """True if the NWK frame `key` (source, sequence number) was first heard less than `window` seconds before `t`.

    A NWK frame that is relayed or retransmitted is heard again with the same source and sequence number, within
    milliseconds. The sequence number is 8 bits and wraps, so a key first heard longer ago than the window is a new frame.
    """
    heard = first_heard.get(key)
    if heard is not None and t - heard < window:
        return True
    first_heard[key] = t
    return False


def run_tshark(path, nwk_key):
    cmd = [
        "tshark", "-r", path,
        "-o", f'uat:zigbee_pc_keys:"{TC_LINK_KEY}","Normal","TC link"',
        "-o", f'uat:zigbee_pc_keys:"{nwk_key}","Normal","NWK"',
        "-Y", "wpan.fcs_ok==1 && zbee_aps && !(zbee_aps.type==0x02)",
        "-T", "fields", "-E", "separator=|", "-E", "occurrence=f",
    ]
    for f in FIELDS:
        cmd += ["-e", f]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(res.stderr.strip())
    return res.stdout.splitlines()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pcap")
    ap.add_argument("--utc", action="store_true", help="print UTC instead of local time")
    ap.add_argument("--raw", action="store_true", help="append the raw payload hex")
    args = ap.parse_args()
    key = os.environ.get("SALUS_NWK_KEY", "").strip()
    if len(key) != 32:
        sys.exit("set SALUS_NWK_KEY to the 16-byte network key as 32 hex characters")

    first_heard = {}
    for line in run_tshark(args.pcap, key):
        f = dict(zip(FIELDS, line.split("|")))
        t = float(f["frame.time_epoch"])
        if is_repeat(first_heard, (f["zbee_nwk.src"], f["zbee_nwk.seqno"]), t):
            continue
        ts = dt.datetime.fromtimestamp(t, dt.timezone.utc if args.utc else None)
        stamp = ts.strftime("%H:%M:%S.%f")[:-3]
        route = f"{f['zbee_nwk.src']}/{f['zbee_aps.src'] or '-'} > {f['zbee_nwk.dst']}/{f['zbee_aps.dst'] or '-'}"
        cluster = f["zbee_aps.cluster"]
        data = bytes.fromhex(f["data.data"]) if f["data.data"] else b""

        if cluster == "0xfc00" and f["zbee_zcl.cs.cmd.id"]:
            cmd = int(f["zbee_zcl.cs.cmd.id"], 16)
            text = f"FC00 0x{cmd:02x} {dec_fc00(cmd, data)}"
        elif f["zbee_aps.zdp_cluster"] in ("0x0013", "0x0002", "0x8002"):
            name = {"0x0013": "device-announce", "0x0002": "node-descriptor-req", "0x8002": "node-descriptor-rsp"}
            text = f"ZDO {name[f['zbee_aps.zdp_cluster']]}"
        elif cluster == "0x0000" and f["zbee_zcl.attr.str"]:
            text = f"Basic read-rsp '{f['zbee_zcl.attr.str']}'"
        else:
            continue
        if args.raw and data:
            text += f"  [{data.hex()}]"
        print(f"{stamp}  {route:<22} {text}")


if __name__ == "__main__":
    main()
