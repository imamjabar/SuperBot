import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { CUA_DRIVER_VERSION, IMAGE_LAYER_VERSION, managedImageDockerfile } from "../server/container-computer.ts";

const context = resolve(process.argv[2] ?? "desktop-image");
await mkdir(context, { recursive: true });
await writeFile(join(context, "Dockerfile"), managedImageDockerfile());

const outputs = `context=${context}\ntag=driver-${CUA_DRIVER_VERSION}-v${IMAGE_LAYER_VERSION}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
process.stdout.write(outputs);
