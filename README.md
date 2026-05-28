# Immich Photo Mosaic

Generate still-image photo mosaics from an Immich library. Select one or more Immich people as the tile source, choose a target image from Immich or upload one locally, tune the mosaic settings, preview the result, and write the final image under `/app/output`.

Inspired by [immich-automated-selfie-timelapse](https://github.com/ArnaudCrl/immich-automated-selfie-timelapse), especially the idea of using Immich as a source for small, focused image-generation tools.

## Requirements

- Node.js 22 or newer for local development.
- Docker and Docker Compose for the recommended deployment.
- An Immich API key with these scopes: `album.read`, `asset.download`, `asset.read`, `asset.view`, `person.read`, `server.about`.

## Configuration

The app reads Immich connection details from environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `IMMICH_BASE_URL` | yes | Base URL of your Immich server, for example `https://immich.example.com`. |
| `IMMICH_API_KEY` | yes | Immich API key with the scopes listed above. |
| `CONFIG_DIR` | no | Directory for `config.toml` and temporary uploads. Defaults to `./config` locally and `/app/config` in Docker. |
| `OUTPUT_DIR` | no | Directory for generated mosaics. Defaults to `./output` locally and `/app/output` in Docker. |
| `PORT` | no | Production server port. Docker defaults to `5777`. |

`config.toml` stores non-secret settings such as filters and mosaic parameters. The API key is read only from `IMMICH_API_KEY` and is never written to disk.

## Run With Docker Compose

Create a `.env` file next to `docker-compose.yml`:

```bash
IMMICH_BASE_URL=https://immich.example.com
IMMICH_API_KEY=your-api-key
```

Create writable folders for app data and generated mosaics:

```bash
mkdir -p config output
chown -R 1000:1000 config output
```

Start the app:

```bash
docker compose pull
docker compose up -d
```

The checked-in Compose file pulls the Docker Hub image and publishes the app at `http://localhost:5465`:

```yaml
services:
  immich-photo-mosaic:
    image: turbopolar/immich-photo-mosaic:latest
    container_name: immich-photo-mosaic
    user: "1000:1000"
    ports:
      - "5465:5777"
    environment:
      IMMICH_API_KEY: ${IMMICH_API_KEY}
      IMMICH_BASE_URL: ${IMMICH_BASE_URL}
    volumes:
      - ./config:/app/config
      - ./output:/app/output
    restart: unless-stopped
```

Useful Docker commands:

```bash
docker compose logs -f
docker compose restart
docker compose down
```

## Run Locally For Development

Install dependencies:

```bash
npm install
```

Start the Vite development server:

```bash
IMMICH_BASE_URL=https://immich.example.com IMMICH_API_KEY=your-api-key npm run dev
```

Open `http://localhost:5000`.

Local development uses `./config` and `./output` unless `CONFIG_DIR` or `OUTPUT_DIR` are set.

## Build And Run Locally

Build the production server and type-check the project:

```bash
npm run build
```

Run the built server:

```bash
IMMICH_BASE_URL=https://immich.example.com IMMICH_API_KEY=your-api-key PORT=5000 npm run start
```

Open `http://localhost:5000`.

## Build The Docker Image

Build the container image directly:

```bash
docker build -t immich-photo-mosaic .
```

Publish a Docker Hub image for typical x86_64 servers, including most Unraid installs:

```bash
docker buildx build \
  --platform linux/amd64 \
  -t turbopolar/immich-photo-mosaic:latest \
  --push .
```

The included GitHub Actions workflow does the same on pushes to `main`, version tags, or manual runs. It expects `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets.

Run it without Compose:

```bash
docker run --rm \
  -p 5465:5777 \
  -e IMMICH_BASE_URL=https://immich.example.com \
  -e IMMICH_API_KEY=your-api-key \
  -v "$PWD/config:/app/config" \
  -v "$PWD/output:/app/output" \
  immich-photo-mosaic
```

Open `http://localhost:5465`.

## Use The App

1. Check the connection panel. It should show the Immich URL, API key status, Immich version, and writable config/output volumes.
2. Choose the main photo. Use an Immich asset or upload a local JPEG, PNG, or WebP image. This photo controls the final mosaic aspect ratio.
3. Choose source photos. Select people to use as tile sources, or leave everyone unselected to use any eligible photo. Optional album and date filters narrow the candidate set.
4. Adjust mosaic settings. Configure output size, format, tile size, fit mode, matching strength, repeat limits, source filters, random seed, and debug intermediates.
5. Select `Save Settings` if you want to persist filters and mosaic settings to `config.toml`.
6. Select `Generate Mosaic` and monitor progress. You can cancel a running job.
7. Use the preview viewer to zoom, pan, fullscreen, and download the final mosaic.
8. Use output history to download selected outputs as a tar archive or delete generated outputs.

## Volumes And Secrets

In Docker, `/app/config/config.toml` stores non-secret settings such as filters and mosaic parameters. Uploaded main images are stored under `/app/config/uploads`.

`/app/output` stores deterministic output folders named from the selected people, filters, main image, and settings. Each folder contains `final.<format>`, `preview.jpg`, `metadata.json`, and optional tile intermediates when enabled.

## Settings

The UI persists mosaic settings to TOML. Important controls include output size or megapixel target, automatic or manual grid density, tile aspect ratio, tile fit mode, contain padding mode, main-image opacity, color matching strength, repeat/diversity limits, candidate pool size, brightness and blur filters, archive/hidden/favorite filters, random seed, output format, quality, and debug intermediates.

The default tile fit is `cover`. Tile sources use Immich previews for fast, compatible processing, while the main photo is loaded from the original when possible. Defaults target a balanced still image: 3200px wide, 64px tiles, and an 800-photo candidate pool before filters.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run check
```

## Troubleshooting

- If the app says `IMMICH_API_KEY and IMMICH_BASE_URL must be set`, confirm both environment variables are set in your shell, `.env`, Compose service, or container runtime.
- If the connection panel reports unwritable volumes, make sure `config` and `output` exist and are writable by the container user.
- If generation is slow, reduce output size, increase tile size, or lower the candidate pool limit.
- If the result has too many repeated tiles, increase the candidate pool limit, select more source photos, lower output size, or raise tile size.

## License

This project is open source and available under the [MIT License](LICENSE).

## Disclaimer

This project was generated with assistance from AI. Review the code, configuration, and outputs before using it with important data or in production.
