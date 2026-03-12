#!/usr/bin/env node
process.removeAllListeners("warning");

import { Command } from "commander";
import {
  registerInitCommands,
  registerMintCommands,
  registerBurnCommands,
  registerFreezeCommands,
  registerStatusCommands,
  registerSupplyCommands,
  registerBlacklistCommands,
  registerSeizeCommands,
  registerMintersCommands,
  registerRolesCommands,
  registerAllowlistCommands,
  registerAuthorityCommands,
  registerMetadataCommands,
  registerOracleCommands,
  registerTransferCommands,
  registerHoldersCommands,
  registerAskCommands,
} from "./commands";

const cli = new Command();

cli
  .name("sss-token")
  .description("CLI for the Solana Stablecoin Standard (SSS)")
  .version("0.1.0");

// Register all command groups
registerInitCommands(cli);
registerMintCommands(cli);
registerBurnCommands(cli);
registerFreezeCommands(cli);
registerStatusCommands(cli);
registerSupplyCommands(cli);
registerBlacklistCommands(cli);
registerSeizeCommands(cli);
registerMintersCommands(cli);
registerRolesCommands(cli);
registerAllowlistCommands(cli);
registerAuthorityCommands(cli);
registerMetadataCommands(cli);
registerOracleCommands(cli);
registerTransferCommands(cli);
registerHoldersCommands(cli);
registerAskCommands(cli);

cli.parse();
