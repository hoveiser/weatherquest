import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import type { WeatherKind } from "../types";

const ICONS: Record<WeatherKind, LucideIcon> = {
  clear: Sun,
  cloud: CloudSun,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

interface Props {
  kind: WeatherKind;
  isDay?: boolean;
  className?: string;
  size?: number;
  color?: string;
}

/** Weather condition glyph. Clear skies show sun by day, moon by night. */
export default function WeatherIcon({ kind, isDay = true, className, size = 24, color }: Props) {
  const Icon = kind === "clear" && !isDay ? Moon : ICONS[kind] ?? Cloud;
  return <Icon size={size} className={className} color={color} aria-hidden />;
}
