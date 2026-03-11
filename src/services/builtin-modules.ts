import type { ServiceModule } from "./types.js";
import type { ServiceRegistry } from "./registry.js";
import { mailModule } from "./mail/module.js";
import { calendarModule } from "./calendar/module.js";
import { todoModule } from "./todo/module.js";
import { teamsChatModule } from "./teams-chat/module.js";
import { onedriveModule } from "./onedrive/module.js";
import { peopleModule } from "./people/module.js";
import { presenceModule } from "./presence/module.js";
import { plannerModule } from "./planner/module.js";
import { onenoteModule } from "./onenote/module.js";
import { sharepointModule } from "./sharepoint/module.js";

/** All built-in M365 service modules in a single canonical array. */
export const builtinModules: ServiceModule[] = [
  mailModule,
  calendarModule,
  todoModule,
  teamsChatModule,
  onedriveModule,
  peopleModule,
  presenceModule,
  plannerModule,
  onenoteModule,
  sharepointModule,
];

/** Register every built-in service module with the given registry. */
export function registerBuiltinModules(registry: ServiceRegistry): void {
  for (const mod of builtinModules) {
    registry.register(mod);
  }
}
