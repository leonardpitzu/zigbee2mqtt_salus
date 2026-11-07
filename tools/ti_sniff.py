#!/usr/bin/env python3
"""Capture 2.4 GHz IEEE 802.15.4 with TI's SmartRF Packet Sniffer 2 firmware (sniffer_fw) on a Sonoff ZBDongle-P
and write a pcap Wireshark opens as is: link type 195 (IEEE 802.15.4 with FCS), the FCS being the frame's own CRC.

usage: ti_sniff.py -c CHANNEL [-w FILE] [--fifo PATH] [-d DEVICE] [--seconds N] [--drop-bad-fcs]
Ctrl-C or SIGTERM stops the capture (STOP is sent to the sniffer) and prints a summary.

Serial protocol of sniffer_fw (3000000 baud 8N1, all multi-byte fields little-endian):
  packet   : 40 53 | type | len (2) | payload | [FCS] | 40 45     FCS = sum(type, len, payload) & 0xFF, command packets only
  host -> sniffer: 40 ping, 41 start, 42 stop, 45 set frequency (MHz u16, fraction u16 in 1/65536 MHz), 47 set PHY (0x12 = 2.4 GHz O-QPSK)
  sniffer -> host: 80 command response (status byte, 0 = ok; ping adds chip id, chip rev, fw id, fw rev),
                   C0 frame: timestamp (6 bytes, us) | PHR | MPDU incl. FCS | RSSI | status (bit 7 = CRC ok), C1 error (buffer overflow)
The dongle's DTR/RTS reset it (RTS low with DTR released = reset into the application, boot pin DIO15 high).
"""
import argparse
import collections
import errno
import glob
import os
import signal
import stat
import struct
import sys
import time

import serial

SOF, EOF = b"\x40\x53", b"\x40\x45"
T_PING, T_START, T_STOP, T_FREQ, T_PHY = 0x40, 0x41, 0x42, 0x45, 0x47
T_RESP, T_DATA, T_ERROR = 0x80, 0xC0, 0xC1
PHY_IEEE_2G4_OQPSK = 0x12            # index in sniffer_fw's PHY table for the CC1352P images
KINDS = ("beacon", "data", "ack", "mac-cmd")
DLT_IEEE802_15_4_WITHFCS = 195
PCAP_HEADER = struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, DLT_IEEE802_15_4_WITHFCS)


def fcs16(data):
    """ITU-T CRC-16 of IEEE 802.15.4 (reflected 0x1021, init 0)."""
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0x8408 if crc & 1 else crc >> 1
    return crc


def command(t, payload=b""):
    body = bytes([t]) + struct.pack("<H", len(payload)) + payload
    return SOF + body + bytes([sum(body) & 0xFF]) + EOF


class Link:
    def __init__(self, dev, baud):
        self.ser = serial.Serial(dev, baud, timeout=0.05)
        self.buf = bytearray()
        self.resyncs = 0

    def reset_into_app(self):
        # Dongle wiring: DTR/RTS drive RESET and the boot pin DIO15. DTR released + RTS pulsed resets with DIO15 high.
        self.ser.dtr = False
        self.ser.rts = True
        time.sleep(0.1)
        self.ser.rts = False
        time.sleep(0.5)
        self.ser.reset_input_buffer()
        self.buf.clear()

    def packets(self):
        """Yield (type, payload) for every complete, well-formed packet; resync on anything else."""
        self.buf += self.ser.read(self.ser.in_waiting or 1)
        while True:
            i = self.buf.find(SOF)
            if i < 0:
                del self.buf[:-1]
                return
            del self.buf[:i]
            if len(self.buf) < 5:
                return
            t, n = self.buf[2], self.buf[3] | self.buf[4] << 8
            total = 5 + n + (3 if t == T_RESP else 2)      # command responses carry an FCS byte before EOF
            if n > 2100:
                del self.buf[:2]
                self.resyncs += 1
                continue
            if len(self.buf) < total:
                return
            if bytes(self.buf[total - 2:total]) != EOF or (t == T_RESP and sum(self.buf[2:5 + n]) & 0xFF != self.buf[5 + n]):
                del self.buf[:2]
                self.resyncs += 1
                continue
            payload = bytes(self.buf[5:5 + n])
            del self.buf[:total]
            yield t, payload

    def ask(self, t, payload=b"", timeout=1.0):
        self.ser.write(command(t, payload))
        self.ser.flush()
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            for pt, pl in self.packets():
                if pt == T_RESP:
                    return pl
        raise TimeoutError("no response to command 0x%02x" % t)


def expect_ok(resp, what):
    if not resp or resp[0] != 0:
        sys.exit("sniffer refused %s (status %s; 4 = wrong state, 5 = bad parameter)" % (what, resp[0] if resp else "none"))


class Fifo:
    """Pcap stream for a reader that may come and go; the header is repeated for every new reader."""

    def __init__(self, path):
        if os.path.exists(path) and not stat.S_ISFIFO(os.stat(path).st_mode):
            sys.exit("%s exists and is not a FIFO" % path)
        if not os.path.exists(path):
            os.mkfifo(path)
        self.path, self.f = path, None

    def write(self, record):
        if self.f is None:
            try:
                self.f = os.fdopen(os.open(self.path, os.O_WRONLY | os.O_NONBLOCK), "wb")
                self.f.write(PCAP_HEADER)
            except OSError as e:
                if e.errno != errno.ENXIO:
                    raise
                self.f = None
                return
        try:
            self.f.write(record)
            self.f.flush()
        except BrokenPipeError:
            self.f = None


def u16(b, i):
    return b[i] | b[i + 1] << 8


def mac_header(m):
    """(frame type, seq, dest PAN, dest addr, source PAN, source addr) from an MPDU without FCS; None if too short."""
    if len(m) < 3:
        return None
    fcf = u16(m, 0)
    ftype, dam, ver, sam, compress = fcf & 7, fcf >> 10 & 3, fcf >> 12 & 3, fcf >> 14 & 3, fcf >> 6 & 1
    i, seq = 2, None
    if not (ver == 2 and fcf >> 8 & 1):
        seq, i = m[2], 3
    dpan = dst = span = src = None

    def addr(mode, i):
        n = {2: 2, 3: 8}.get(mode, 0)
        if i + n > len(m):
            return None, i
        return int.from_bytes(m[i:i + n], "little"), i + n

    if dam:
        dpan, i = (u16(m, i), i + 2) if i + 2 <= len(m) else (None, i)
        dst, i = addr(dam, i)
    if sam:
        if not compress and i + 2 <= len(m):
            span, i = u16(m, i), i + 2
        else:
            span = dpan
        src, i = addr(sam, i)
        if sam == 3 and src is not None:
            src = "ext:%016x" % src
    return ftype, seq, dpan, dst, span, src


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("-c", "--channel", type=int, required=True, help="IEEE 802.15.4 channel 11..26 (Zigbee channel numbers)")
    ap.add_argument("-w", "--write", metavar="FILE", help="write a pcap file")
    ap.add_argument("--fifo", metavar="PATH", help="also stream the pcap into this FIFO (Wireshark: -k -i PATH)")
    ap.add_argument("-d", "--device", help="serial port (default: first /dev/serial/by-id/*Sonoff*)")
    ap.add_argument("--seconds", type=float, help="stop after this many seconds")
    ap.add_argument("--baud", type=int, default=3000000)
    ap.add_argument("--drop-bad-fcs", action="store_true", help="leave frames whose FCS does not verify out of the pcap")
    ap.add_argument("-v", "--verbose", action="store_true", help="hex-dump the first 3 raw data packets")
    ap.add_argument("--phy", type=lambda s: int(s, 0), default=PHY_IEEE_2G4_OQPSK, help="sniffer PHY number (default 0x12)")
    args = ap.parse_args()
    if not 11 <= args.channel <= 26:
        sys.exit("channel must be 11..26")
    dev = args.device or next(iter(sorted(glob.glob("/dev/serial/by-id/*[Ss][Oo][Nn][Oo][Ff][Ff]*"))), None)
    if not dev:
        sys.exit("no Sonoff dongle under /dev/serial/by-id, use -d")

    link = Link(dev, args.baud)
    link.reset_into_app()
    for _ in range(8):
        try:
            resp = link.ask(T_PING, timeout=0.4)
            break
        except TimeoutError:
            continue
    else:
        sys.exit("no answer to PING at %d baud on %s (is the TI sniffer firmware flashed?)" % (args.baud, dev))
    status, chip, rev, fw_id, fw_rev = struct.unpack("<BHBBH", resp)
    print("sniffer: chip id 0x%04x rev 0x%02x, fw id %d version %d.%d" % (chip, rev, fw_id, fw_rev >> 8, fw_rev & 0xFF), file=sys.stderr)
    expect_ok(link.ask(T_PHY, bytes([args.phy])), "PHY 0x%02x" % args.phy)
    mhz = 2405 + 5 * (args.channel - 11)
    expect_ok(link.ask(T_FREQ, struct.pack("<HH", mhz, 0)), "frequency %d MHz" % mhz)
    expect_ok(link.ask(T_START), "start")
    print("capturing channel %d (%d MHz)%s" % (args.channel, mhz, "" if not args.seconds else " for %g s" % args.seconds), file=sys.stderr)

    out = open(args.write, "wb") if args.write else None
    if out:
        out.write(PCAP_HEADER)
        out.flush()
    fifo = Fifo(args.fifo) if args.fifo else None
    stop = []
    signal.signal(signal.SIGINT, lambda *_: stop.append(1))
    signal.signal(signal.SIGTERM, lambda *_: stop.append(1))

    frames = fcs_ok = ti_crc_ok = bad_shape = overflows = 0
    kinds, srcs, pans = collections.Counter(), collections.Counter(), collections.Counter()
    t_epoch = ts_first = None
    t_end = time.monotonic() + args.seconds if args.seconds else None
    while not stop and (t_end is None or time.monotonic() < t_end):
        for t, p in link.packets():
            if t == T_ERROR:
                overflows += 1
                continue
            if t != T_DATA or len(p) < 8:
                continue
            if args.verbose and frames + bad_shape < 3:
                print("raw data packet: %s" % p.hex(" "), file=sys.stderr)
            ts_us = int.from_bytes(p[:6], "little")
            body = p[6:]                                  # PHR | MPDU incl. FCS | RSSI | status
            phr = body[0] & 0x7F
            if len(body) != phr + 3 or phr < 5:
                bad_shape += 1
                continue
            mpdu, status_byte = body[1:1 + phr], body[2 + phr]
            valid = fcs16(mpdu[:-2]) == u16(mpdu, len(mpdu) - 2)
            frames += 1
            ti_crc_ok += status_byte >> 7
            fcs_ok += valid
            if args.drop_bad_fcs and not valid:
                continue
            now = time.time()
            if ts_first is None:
                ts_first, t_epoch = ts_us, now
            when = t_epoch + (ts_us - ts_first) / 1e6
            rec = struct.pack("<IIII", int(when), int(when % 1 * 1e6), len(mpdu), len(mpdu)) + mpdu
            if out:
                out.write(rec)
                out.flush()
            if fifo:
                fifo.write(rec)
            if valid:
                h = mac_header(mpdu[:-2])
                if h:
                    kinds[KINDS[h[0]] if h[0] < 4 else "other"] += 1
                    if h[5] is not None:
                        srcs[h[5] if isinstance(h[5], str) else "0x%04x" % h[5]] += 1
                    for pan in (h[2], h[4]):
                        if pan is not None:
                            pans["0x%04x" % pan] += 1

    try:
        link.ask(T_STOP, timeout=1.0)
    except TimeoutError:
        pass
    if out:
        out.close()
    print("frames %d, FCS valid %d, sniffer CRC-ok flag %d, malformed %d, resyncs %d, buffer overflows %d"
          % (frames, fcs_ok, ti_crc_ok, bad_shape, link.resyncs, overflows), file=sys.stderr)
    print("types: %s" % dict(kinds), file=sys.stderr)
    print("PAN ids: %s" % pans.most_common(5), file=sys.stderr)
    print("top short sources: %s" % [kv for kv in srcs.most_common() if not kv[0].startswith("ext:")][:5], file=sys.stderr)
    print("top extended sources: %s" % [kv for kv in srcs.most_common() if kv[0].startswith("ext:")][:3], file=sys.stderr)


if __name__ == "__main__":
    main()
