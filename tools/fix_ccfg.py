#!/usr/bin/env python3
"""Make a third-party CC13x2/CC26x2 hex safe to flash on the ZBDongle-P: copy the two CCFG words that decide
whether the dongle can still be re-flashed over serial and whether the chip runs on it (BL_CONFIG: ROM bootloader on
DIO15 low; MODE_CONF: DC/DC off, LF/HF clock, crystal trim) from a reference image, then run the same check.

usage: fix_ccfg.py IN.hex OUT.hex REF     (REF: the dongle's own flash backup, .bin, or the Z-Stack .hex it ran)
"""
import sys

import check_ccfg as c

def main(src, dst, ref):
    img, ref_img = c.load(src), c.load(ref)
    for name in ("MODE_CONF", "BL_CONFIG"):
        off = c.CCFG_BASE + 4 * c.WORDS.index(name)
        old = bytes(img[off + i] for i in range(4))
        new = bytes(ref_img[off + i] for i in range(4))
        print(f"{name}: 0x{int.from_bytes(old, 'little'):08X} -> 0x{int.from_bytes(new, 'little'):08X}")
        img.puts(off, new)
    img.write_hex_file(dst)
    return c.main(dst)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
