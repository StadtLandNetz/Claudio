export * from "./driver.js";
export * from "./playwright-driver.js";
export * from "./chrome-driver.js";
export * from "./capture.js";
export * from "./run-store.js";
export * from "./login.js";
export * from "./tools/definitions.js";

import type { DriverName } from "@claudio/core";
import { ChromeExtensionDriver } from "./chrome-driver.js";
import type { BrowserDriver } from "./driver.js";
import { PlaywrightDriver } from "./playwright-driver.js";

export function createDriver(name: DriverName): BrowserDriver {
  return name === "chrome" ? new ChromeExtensionDriver() : new PlaywrightDriver();
}
