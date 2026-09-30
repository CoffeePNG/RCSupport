import { route, prefix } from "../../interactions/router";
import { staffModule } from "../../modules/catalog";
import { handleStaffConfirmation } from "./command";
export const staffRoutes=[
  route("button",prefix("staff:fire:confirm:"),handleStaffConfirmation,{module:staffModule}),
  route("button",prefix("staff:fire:cancel:"),handleStaffConfirmation,{module:staffModule}),
];
