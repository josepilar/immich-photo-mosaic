# Immich Photo Mosaic

Generate still-image photo mosaics from an Immich library. Select one or more Immich people as the tile source, choose a target image from Immich or upload one locally, tune the mosaic settings, preview the result, and write the final image under `/app/output`.

## Docker Compose

Create an Immich API key with these scopes: `album.read`, `asset.download`, `asset.read`, `asset.view`, `person.read`, `server.about`.

```yaml
services:
  immich-photo-mosaic:
    build: .
    image: immich-photo-mosaic
    container_name: immich-photo-mosaic
    user: "1000:1000"
    ports:
      - "5000:5000"
    environment:
      IMMICH_API_KEY: ${IMMICH_API_KEY}
      IMMICH_BASE_URL: ${IMMICH_BASE_URL}
    volumes:
      - ./config:/app/config
      - ./output:/app/output
    restart: unless-stopped
```

Then open `http://your-server:5000`.

## Volumes And Secrets

`/app/config/config.toml` stores non-secret settings such as filters and mosaic parameters. The API key is read only from `IMMICH_API_KEY` and is never written to disk.

`/app/output` stores deterministic output folders named from the selected people, filters, main image, and settings. Each folder contains `final.<format>`, `preview.jpg`, `metadata.json`, and optional tile intermediates when enabled.

Make sure the container user can write both folders:

```bash
mkdir -p config output
chown -R 1000:1000 config output
```

## Settings

The UI persists mosaic settings to TOML. Important controls include output size or megapixel target, automatic or manual grid density, tile aspect ratio, tile fit mode, contain padding mode, main-image opacity, color matching strength, repeat/diversity limits, candidate pool size, Immich preview versus original downloads, brightness and blur filters, archive/hidden/favorite filters, random seed, output format, quality, and debug intermediates.

The default tile fit is `cover` and original Immich downloads are used for sharper tiles. Defaults target a balanced still image: 3200px wide, 64px tiles, and an 800-photo candidate pool before filters.

## Development

```bash
npm install
npm run dev
npm test
```

Local development uses `./config` and `./output` unless `CONFIG_DIR` or `OUTPUT_DIR` are set. Docker sets them to `/app/config` and `/app/output`.
