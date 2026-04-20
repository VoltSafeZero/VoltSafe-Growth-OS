import {
  Sun, Moon, Cloud, CloudSun, CloudMoon, CloudFog, CloudDrizzle,
  CloudRain, CloudSnow, CloudLightning, Snowflake,
} from "lucide-react";
import type { WeatherCondition } from "./weather-types";

// WMO weather code → lucide icon. https://open-meteo.com/en/docs (Weather variable)
export function weatherIconFor(code: number, isDay: boolean): React.ElementType {
  if (code === 0) return isDay ? Sun : Moon;
  if (code === 1 || code === 2) return isDay ? CloudSun : CloudMoon;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if (code >= 61 && code <= 67) return CloudRain;
  if (code >= 80 && code <= 82) return CloudRain;
  if (code === 71 || code === 73 || code === 75 || code === 77) return CloudSnow;
  if (code === 85 || code === 86) return Snowflake;
  if (code >= 95) return CloudLightning;
  return Cloud;
}

export function weatherLabelFor(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 71 || code === 73 || code === 75 || code === 77) return "Snow";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm w/ hail";
  return "—";
}

export function conditionFor(code: number): WeatherCondition {
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}
