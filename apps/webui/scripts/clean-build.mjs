import { rm } from "node:fs/promises";

// TypeScript leaves outputs of removed modules behind. Pack only this build's sources and fixed frontend.
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
