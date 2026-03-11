// Example OpenClippy plugin: Weather Service
//
// This plugin demonstrates the ServiceModule interface with two tools
// that return mock weather data. No external API calls are made.

const MOCK_CONDITIONS = ["Sunny", "Partly Cloudy", "Cloudy", "Rainy", "Stormy", "Snowy", "Foggy"];

/**
 * Generate a deterministic-looking but varied temperature for a city name.
 * Uses string hashing so the same city always returns the same temperature.
 */
function mockTemperature(city, dayOffset = 0) {
  let hash = 0;
  for (const ch of city.toLowerCase()) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  // Base temp between 5 and 35 C
  const base = 5 + Math.abs(hash % 30);
  // Small day-to-day variation
  const variation = ((hash + dayOffset * 7) % 5) - 2;
  return base + variation;
}

/**
 * Pick a mock weather condition from the city name.
 */
function mockCondition(city, dayOffset = 0) {
  let hash = 0;
  for (const ch of city.toLowerCase()) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  const index = Math.abs((hash + dayOffset * 3) % MOCK_CONDITIONS.length);
  return MOCK_CONDITIONS[index];
}

const weatherService = {
  id: "weather",

  meta: {
    label: "Weather",
    description: "Mock weather data for demonstration purposes",
    requiredScopes: [],
  },

  capabilities: {
    read: true,
    write: false,
    delete: false,
    search: false,
    subscribe: false,
  },

  tools() {
    return [
      {
        name: "weather_current",
        description: "Get the current weather for a city. Returns mock data for demonstration.",
        inputSchema: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "City name (e.g., 'London', 'Tokyo', 'New York')",
            },
          },
          required: ["city"],
        },
        async execute(args) {
          const city = args.city;
          if (!city || typeof city !== "string") {
            return { content: "Error: city parameter is required", isError: true };
          }

          const temp = mockTemperature(city);
          const condition = mockCondition(city);
          const humidity = 40 + Math.abs((temp * 3 + 17) % 50);

          const result = {
            city,
            temperature: `${temp}C`,
            condition,
            humidity: `${humidity}%`,
            wind: `${5 + (temp % 10)} km/h`,
            note: "This is mock data for demonstration purposes.",
          };

          return { content: JSON.stringify(result, null, 2) };
        },
      },
      {
        name: "weather_forecast",
        description: "Get a 3-day weather forecast for a city. Returns mock data for demonstration.",
        inputSchema: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "City name (e.g., 'London', 'Tokyo', 'New York')",
            },
          },
          required: ["city"],
        },
        async execute(args) {
          const city = args.city;
          if (!city || typeof city !== "string") {
            return { content: "Error: city parameter is required", isError: true };
          }

          const today = new Date();
          const forecast = [];

          for (let i = 0; i < 3; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() + i);

            const high = mockTemperature(city, i);
            const low = high - 5 - (i % 3);

            forecast.push({
              date: date.toISOString().split("T")[0],
              high: `${high}C`,
              low: `${low}C`,
              condition: mockCondition(city, i),
            });
          }

          const result = {
            city,
            forecast,
            note: "This is mock data for demonstration purposes.",
          };

          return { content: JSON.stringify(result, null, 2) };
        },
      },
    ];
  },

  promptHints() {
    return [
      "The weather service returns mock data for demonstration. Temperatures are in Celsius.",
    ];
  },
};

export default weatherService;
