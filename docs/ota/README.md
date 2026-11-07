# SQ610RFNH firmware in the zigbee-OTA index

zigbee2mqtt checks the shared index of [Koenkk/zigbee-OTA](https://github.com/Koenkk/zigbee-OTA) for updates. Once the SQ610RFNH 0x54 image is in it, every zigbee2mqtt installation can update these thermostats without a local index.

## Where it stands

1. The index has one SQ610RFNH image: `SAR70ZA_20231008_V70.ota`, file version 0x46. A thermostat on 0x50 is ahead of it, so zigbee2mqtt offers it nothing.
2. zigbee-OTA fetches Salus images automatically from `https://eu.salusconnect.io/demo/default/status/firmware`. In October 2026 that address returns 404, and newer Salus images are on a different host. A new image only gets in by pull request.
3. zigbee-OTA hosts the image files itself, under `images/<manufacturer>/`, and the index points at the raw GitHub URL. The Salus download URL goes in `originalUrl` for the record.

## The image

| What | Value |
|---|---|
| File | `SAR70ZA_00000054_20260702.ota`, 455 110 bytes |
| Manufacturer code | 0x1078 (4216) |
| Image type | 0x7A (122) |
| File version | 0x54 (84) |
| Header string | `SQ610` |
| Total image size in the header | 455 106 bytes; the file has 4 more bytes after the image. zigbee-OTA's `fileSize` is the header value. zigbee2mqtt installed this file from a local index without problems, and the it600WC image already in zigbee-OTA has the same 4 extra bytes. |
| SHA-512 of the file | in [zigbee-ota-index-entry.json](zigbee-ota-index-entry.json) |
| Salus download | `https://dayt0dkrrkga9.cloudfront.net/public/firmware/UG-SYS/SQ610/NH/2026-0706/SQ610RFNH_00000054.tar.gz` |

The download is named `.tar.gz` but is a plain tar archive. It holds the `.ota` file and `networkinfo.json`, which has the MD5 of the `.ota`. Firmware is not included in this repo.

[zigbee-ota-index-entry.json](zigbee-ota-index-entry.json) is the entry the index should end up with. The zigbee-OTA workflow writes it from the image and the PR body; nobody edits `index.json` by hand.

## Pull request to zigbee-OTA

1. Download and unpack the image, and check it against `networkinfo.json`:

   ```bash
   curl -O https://dayt0dkrrkga9.cloudfront.net/public/firmware/UG-SYS/SQ610/NH/2026-0706/SQ610RFNH_00000054.tar.gz
   tar xf SQ610RFNH_00000054.tar.gz
   md5sum SAR70ZA_00000054_20260702.ota && cat networkinfo.json
   sha512sum SAR70ZA_00000054_20260702.ota
   ```

2. Fork Koenkk/zigbee-OTA and add the file as `images/SalusControls/SAR70ZA_00000054_20260702.ota`. Do not touch `index.json`, `images1/` or the old V70 file.
3. Open the PR with this block in the first post. The workflow reads extra fields from the first ```` ```json ```` block, so the post must have no other code block:

   ```json
   {
       "manufacturerName": ["SalusControls", "SALUS"],
       "originalUrl": "https://dayt0dkrrkga9.cloudfront.net/public/firmware/UG-SYS/SQ610/NH/2026-0706/SQ610RFNH_00000054.tar.gz"
   }
   ```

4. The workflow validates the image and comments with the change it will make. After the merge, the V70 entry moves to `index1.json` (the downgrade index).

Why these fields:

1. **manufacturerName.** zigbee2mqtt uses an index entry only if its `manufacturerName` list contains the device's own manufacturer name or the `ota.manufacturerName` of the definition ([zigbee-herdsman `findMatchingOtaImage`](https://github.com/Koenkk/zigbee-herdsman/blob/master/src/controller/model/device.ts)). The thermostat reports `SALUS`. The built-in Salus definitions set `SalusControls`, and every Salus entry in the index is tagged with it. Both names cover the external converter (`ota: true`) and a future built-in definition.
2. **No modelId.** zigbee-OTA replaces an older entry only when the new one has the same `modelId` (here none) and shares a manufacturer name with it. With `SalusControls` and no `modelId` the 0x54 image takes the place of V70; with a `modelId` both would stay in `index.json` and zigbee2mqtt could pick V70 first.
3. **releaseNotes.** Optional. Salus has published no notes for 0x54 that we know of, so leave it out.

## Until it is merged

Use a local index, as in the main [README](../../README.md#firmware-updates). Put the `.ota` in the `ota/` folder of the zigbee2mqtt data folder and set `ota.zigbee_ota_override_index_location: ota/local_index.json` with:

```json
[{ "url": "ota/SAR70ZA_00000054_20260702.ota", "sha512": "<sha512 of the file>" }]
```

zigbee2mqtt reads the rest of the metadata from the file.
