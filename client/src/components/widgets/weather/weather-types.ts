export type {
  WeatherPrefs,
  WeatherSavedLocation,
  WeatherUnits,
  WeatherTempUnit,
  WeatherWindUnit,
} from "@shared/weather-types";
export {
  WEATHER_TEMP_UNITS,
  WEATHER_WIND_UNITS,
  WEATHER_DEFAULT_PREFS,
  WEATHER_PREFS_MAX_BYTES,
  weatherPrefsSchema,
  weatherLocationSchema,
  weatherUnitsSchema,
  weatherTempUnitSchema,
  weatherWindUnitSchema,
} from "@shared/weather-types";

export const HARDCODED_FALLBACK_CITY = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "Vancouver, BC",
  latitude: 49.2827,
  longitude: -123.1207,
  timezone: "America/Vancouver",
  countryCode: "CA",
} as const;

export type WeatherCurrent = {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  precipitation: number;
  weatherCode: number;
  windSpeed: number;
  windDirection: number;
  isDay: boolean;
  uvIndex: number;
  time: string;
};

export type WeatherHourly = {
  time: string;
  temperature: number;
  precipitationProbability: number;
  weatherCode: number;
  isDay: boolean;
};

export type WeatherDaily = {
  date: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  precipitationProbability: number;
  uvIndexMax: number;
};

export type WeatherForecast = {
  current: WeatherCurrent;
  hourly: WeatherHourly[];   // next 24
  daily: WeatherDaily[];     // 7 days
  timezone: string;
  fetchedAt: number;
};

export type WeatherGeocodeResult = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  countryCode?: string;
};

export type WeatherCondition =
  | "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
