import { ImageResponse } from "next/og";
import { AppIcon } from "@/lib/app-icon";

// The browser tab icon.
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<AppIcon size={192} />, size);
}
