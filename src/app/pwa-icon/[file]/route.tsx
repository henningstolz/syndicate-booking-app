import { ImageResponse } from "next/og";
import { AppIcon } from "@/lib/app-icon";

// The home-screen icons named in the web app manifest: /pwa-icon/192.png and
// /pwa-icon/512.png.
const SIZES: Record<string, number> = { "192.png": 192, "512.png": 512 };

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const size = SIZES[file];
  if (!size) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIcon size={size} />, { width: size, height: size });
}
