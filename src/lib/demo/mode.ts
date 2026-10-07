import { headers } from "next/headers";
// The proxy (src/proxy.ts) sets the header named in ./header.ts to "1" for requests whose address
// starts with /demo, and removes any copy sent by a visitor. It is the ONLY
// thing that switches the app to the demo, so the demo can never be reached
// from a real group's address, and a real group's address can never run on
// demo data.
import { DEMO_HEADER } from "./header.ts";

export async function isDemoRequest(): Promise<boolean> {
  return (await headers()).get(DEMO_HEADER) === "1";
}
