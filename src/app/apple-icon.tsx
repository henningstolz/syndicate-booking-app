import { ImageResponse } from "next/og";
import { AppIcon } from "@/lib/app-icon";

// The iPhone home-screen icon ("Add to Home Screen"). iOS rounds the corners itself.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={180} />, size);
}
