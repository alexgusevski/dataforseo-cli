import { Command } from "commander";
import { registerAccount } from "./account";
import { registerAi } from "./ai";
import { registerApi } from "./api";
import { registerBacklinks } from "./backlinks";
import { registerContent, registerDomain } from "./content";
import { registerGeo } from "./geo";
import { registerKeywords } from "./keywords";
import { registerLabs } from "./labs";
import { registerAppData, registerBusiness, registerMerchant } from "./merchant";
import { registerOnPage } from "./onpage";
import { registerSerp } from "./serp";
import { registerTrends } from "./trends";

export function registerAll(program: Command): void {
  registerSerp(program);
  registerTrends(program);
  registerKeywords(program);
  registerLabs(program);
  registerBacklinks(program);
  registerOnPage(program);
  registerContent(program);
  registerDomain(program);
  registerMerchant(program);
  registerAppData(program);
  registerBusiness(program);
  registerAi(program);
  registerAccount(program);
  registerGeo(program);
  registerApi(program);
}
