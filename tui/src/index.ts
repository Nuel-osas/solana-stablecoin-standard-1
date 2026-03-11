#!/usr/bin/env node
process.removeAllListeners("warning");

import { Command } from "commander";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { createDashboard } from "./dashboard";

const idl = require("./idl/sss_token.json");

const PROGRAM_ID = new PublicKey(
  "BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq"
);

const cli = new Command();

cli
  .name("sss-dashboard")
  .description("Terminal UI dashboard for the Solana Stablecoin Standard")
  .version("0.1.0")
  .requiredOption("--mint <address>", "Mint address of the stablecoin")
  .option("--cluster <cluster>", "Solana cluster", "devnet")
  .option("--keypair <path>", "Path to keypair file")
  .action(async (opts) => {
    const mint = new PublicKey(opts.mint);

    const connection =
      opts.cluster === "localnet"
        ? new Connection("http://localhost:8899", "confirmed")
        : new Connection(clusterApiUrl(opts.cluster as any), "confirmed");

    // Build a read-only provider (no signing needed for dashboard)
    const dummyKeypair = Keypair.generate();
    const wallet = new anchor.Wallet(dummyKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const program = new anchor.Program(idl as any, provider);

    const [stablecoinPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin"), mint.toBuffer()],
      PROGRAM_ID
    );

    createDashboard(connection, program, mint, stablecoinPDA, PROGRAM_ID);
  });

cli.parse(process.argv);
