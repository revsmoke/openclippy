# Example Plugin: Weather Service

A demonstration plugin for OpenClippy that provides mock weather data. This plugin shows how to implement the `ServiceModule` interface with working tools. No external API calls are made -- all data is generated locally.

## Tools

- **weather_current** -- Returns mock current weather for a city (temperature, condition, humidity, wind)
- **weather_forecast** -- Returns a mock 3-day forecast for a city

## Installation

Copy this plugin to your OpenClippy plugins directory:

```bash
cp -r examples/example-plugin ~/.openclippy/plugins/example-weather
```

Then add it to your `~/.openclippy/config.yaml`:

```yaml
plugins:
  weather:
    enabled: true
```

Restart OpenClippy and the weather tools will be available.

## Usage

```
openclippy ask "What is the weather in Tokyo?"
openclippy ask "Give me a 3-day forecast for London"
```

## Files

- `manifest.json` -- Plugin metadata (name, version, serviceId, entry point)
- `index.js` -- ESM module exporting a `ServiceModule` with two tools

## Learn More

See the [Plugin Authoring Guide](../../docs/plugin-authoring.md) for the full reference on building OpenClippy plugins.
