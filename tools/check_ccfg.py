#!/usr/bin/env python3
"""Check that a CC13x2/CC26x2 flash image keeps the ROM serial bootloader reachable
through the Sonoff ZBDongle-P wiring (DIO15, active low), so the dongle can be
re-flashed or restored afterwards. Exit status 0 = safe to flash, 1 = would lock you out.

usage: check_ccfg.py IMAGE.hex|IMAGE.bin
  .hex/.ihx/.ihex are read as Intel HEX; anything else as a raw image starting at 0x0.
"""
import sys

from intelhex import IntelHex

FLASH_SIZE = 0x58000                # CC2652P / CC1352P: 352 KB
CCFG_LEN = 0x58                     # 22 words at the very end of flash
CCFG_BASE = FLASH_SIZE - CCFG_LEN   # 0x57FA8
DONGLE_BSL_DIO = 15                 # ZBDongle-P: IO15 is pulled low by DTR/RTS (cc2538-bsl --bootloader-sonoff-usb)

WORDS = [
    "EXT_LF_CLK", "MODE_CONF_1", "SIZE_AND_DIS_FLAGS", "MODE_CONF", "VOLT_LOAD_0", "VOLT_LOAD_1",
    "RTC_OFFSET", "FREQ_OFFSET", "IEEE_MAC_0", "IEEE_MAC_1", "IEEE_BLE_0", "IEEE_BLE_1",
    "BL_CONFIG", "ERASE_CONF", "TI_OPTIONS", "TAP_DAP_0", "TAP_DAP_1", "IMAGE_VALID_CONF",
    "PROT_31_0", "PROT_63_32", "PROT_95_64", "PROT_127_96",
]


def load(path):
    ih = IntelHex()
    if path.lower().endswith((".hex", ".ihx", ".ihex")):
        ih.loadhex(path)
    else:
        ih.loadbin(path, offset=0)
    return ih


def main(path):
    ih = load(path)
    lo, hi = ih.minaddr(), ih.maxaddr()
    print(f"{path}: 0x{lo:05X}..0x{hi:05X} ({hi - lo + 1} bytes)")
    problems = []

    if hi >= FLASH_SIZE:
        problems.append(f"image extends past the 352 KB flash (0x{FLASH_SIZE:X})")
    if not all(a in ih.todict() for a in range(CCFG_BASE, CCFG_BASE + CCFG_LEN)):
        problems.append(f"image does not reach the CCFG at 0x{CCFG_BASE:X} (truncated backup, or a hex without CCFG)")
        print("\n".join("FAIL: " + p for p in problems))
        return 1

    raw = bytes(ih[a] for a in range(CCFG_BASE, CCFG_BASE + CCFG_LEN))
    ccfg = {n: int.from_bytes(raw[i * 4:i * 4 + 4], "little") for i, n in enumerate(WORDS)}

    sp = int.from_bytes(bytes(ih[a] for a in range(0, 4)), "little")
    rv = int.from_bytes(bytes(ih[a] for a in range(4, 8)), "little")
    print(f"vector table: SP=0x{sp:08X} reset=0x{rv:08X}")
    if not (0x20000000 <= sp <= 0x20014000) or not (rv & 1) or (rv & ~1) >= FLASH_SIZE:
        problems.append("vector table at 0x0 does not look like a CC26x2 image")

    bl = ccfg["BL_CONFIG"]
    bl_enable_rom = (bl >> 24) & 0xFF
    bl_level = (bl >> 16) & 1
    bl_pin = (bl >> 8) & 0xFF
    bl_backdoor = bl & 0xFF
    bank_erase_ok = ccfg["ERASE_CONF"] & 1
    print(f"CCFG @0x{CCFG_BASE:X}  BL_CONFIG=0x{bl:08X}  ERASE_CONF=0x{ccfg['ERASE_CONF']:08X}  "
          f"IMAGE_VALID_CONF=0x{ccfg['IMAGE_VALID_CONF']:08X}")
    print(f"  ROM bootloader (BOOTLOADER_ENABLE) : 0x{bl_enable_rom:02X}  ({'enabled' if bl_enable_rom == 0xC5 else 'DISABLED'})")
    print(f"  backdoor       (BL_ENABLE)         : 0x{bl_backdoor:02X}  ({'enabled' if bl_backdoor == 0xC5 else 'DISABLED'})")
    print(f"  backdoor pin   (BL_PIN_NUMBER)     : DIO{bl_pin}")
    print(f"  backdoor level (BL_LEVEL)          : {'active LOW' if bl_level == 0 else 'active HIGH'}")
    print(f"  bank erase     (BANK_ERASE_DIS_N)  : {'enabled' if bank_erase_ok else 'DISABLED'}")
    print(f"  sector write protect               : {'none' if all(ccfg[k] == 0xFFFFFFFF for k in WORDS[-4:]) else 'SOME SECTORS PROTECTED'}")

    if bl_enable_rom != 0xC5:
        problems.append("BOOTLOADER_ENABLE is not 0xC5: the ROM bootloader is off")
    if bl_backdoor != 0xC5:
        problems.append("BL_ENABLE is not 0xC5: the pin backdoor is off, so a valid image can never be replaced over serial")
    if bl_pin != DONGLE_BSL_DIO:
        problems.append(f"BL_PIN_NUMBER is DIO{bl_pin}, the dongle's DTR/RTS circuit drives DIO{DONGLE_BSL_DIO}")
    if bl_level != 0:
        problems.append("BL_LEVEL is active high, the dongle pulls DIO15 low")
    if not bank_erase_ok:
        problems.append("BANK_ERASE_DIS_N is 0: cc2538-bsl -e (mass erase) will be refused")
    if ccfg["IMAGE_VALID_CONF"] != 0:
        problems.append("IMAGE_VALID_CONF is not 0: the ROM will not start the image")

    for p in problems:
        print("FAIL: " + p)
    if problems:
        return 1
    print("OK: bootloader stays reachable via the dongle's DTR/RTS (DIO15, active low)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
