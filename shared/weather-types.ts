import { z } from "zod";

export const WEATHER_TEMP_UNITS = ["F", "C"] as const;
export const WEATHER_WIND_UNITS = ["mph", "kph"] as const;

export type WeatherTempUnit = (typeof WEATHER_TEMP_UNITS)[number];
export type WeatherWindUnit = (typeof WEATHER_WIND_UNITS)[number];

export const weatherTempUnitSchema = z.enum(WEATHER_TEMP_UNITS);
export const weatherWindUnitSchema = z.enum(WEATHER_WIND_UNITS);

export const weatherLocationSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().min(1).max(120),
    latitude: z.number().finite().gte(-90).lte(90),
    longitude: z.number().finite().gte(-180).lte(180),
    timezone: z.string().max(64).optional(),
    countryCode: z.string().min(2).max(3).optional(),
  })
  .strict();

export const weatherUnitsSchema = z
  .object({
    temp: weatherTempUnitSchema,
    wind: weatherWindUnitSchema,
  })
  .strict();

export const weatherPrefsSchema = z
  .object({
    locations: z.array(weatherLocationSchema).max(10),
    units: weatherUnitsSchema,
    defaultCityFallback: weatherLocationSchema.optional(),
  })
  .strict();

export type WeatherSavedLocation = z.infer<typeof weatherLocationSchema>;
export type WeatherUnits = z.infer<typeof weatherUnitsSchema>;
export type WeatherPrefs = z.infer<typeof weatherPrefsSchema>;

export const WEATHER_PREFS_MAX_BYTES = 8 * 1024;

export const WEATHER_DEFAULT_PREFS: WeatherPrefs = {
  locations: [],
  units: { temp: "F", wind: "mph" },
};
