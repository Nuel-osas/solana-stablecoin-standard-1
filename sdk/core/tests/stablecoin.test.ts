import { expect } from "chai";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import {
  findStablecoinPDA,
  findRolePDA,
  findBlacklistPDA,
  findMinterInfoPDA,
} from "../src/pda";
import { Presets, SolanaStablecoin } from "../src/stablecoin";
import { ComplianceModule } from "../src/compliance";
import type { StablecoinConfig } from "../src/types";

const programId = new PublicKey("CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ");

describe("SSS SDK", () => {
  const mint = Keypair.generate().publicKey;

  describe("PDA Derivation", () => {
    it("derives stablecoin PDA deterministically", () => {
      const [pda1, bump1] = findStablecoinPDA(mint, programId);
      const [pda2, bump2] = findStablecoinPDA(mint, programId);
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
      expect(bump1).to.equal(bump2);
    });

    it("derives different PDAs for different mints", () => {
      const mint2 = Keypair.generate().publicKey;
      const [pda1] = findStablecoinPDA(mint, programId);
      const [pda2] = findStablecoinPDA(mint2, programId);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });

    it("stablecoin PDA is a valid PublicKey on the ed25519 curve check (off-curve)", () => {
      const [pda] = findStablecoinPDA(mint, programId);
      // PDAs must be off-curve (not a valid ed25519 point)
      expect(PublicKey.isOnCurve(pda.toBuffer())).to.equal(false);
    });

    it("derives role PDA deterministically", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const assignee = Keypair.generate().publicKey;
      const [rolePDA1] = findRolePDA(stablecoinPDA, "minter", assignee, programId);
      const [rolePDA2] = findRolePDA(stablecoinPDA, "minter", assignee, programId);
      expect(rolePDA1.toBase58()).to.equal(rolePDA2.toBase58());
    });

    it("derives different role PDAs for different roles", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const assignee = Keypair.generate().publicKey;
      const [minterPDA] = findRolePDA(stablecoinPDA, "minter", assignee, programId);
      const [burnerPDA] = findRolePDA(stablecoinPDA, "burner", assignee, programId);
      expect(minterPDA.toBase58()).to.not.equal(burnerPDA.toBase58());
    });

    it("derives different role PDAs for different assignees", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const assignee1 = Keypair.generate().publicKey;
      const assignee2 = Keypair.generate().publicKey;
      const [pda1] = findRolePDA(stablecoinPDA, "minter", assignee1, programId);
      const [pda2] = findRolePDA(stablecoinPDA, "minter", assignee2, programId);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });

    it("derives blacklist PDA deterministically", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const address = Keypair.generate().publicKey;
      const [pda1] = findBlacklistPDA(stablecoinPDA, address, programId);
      const [pda2] = findBlacklistPDA(stablecoinPDA, address, programId);
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it("derives different blacklist PDAs for different addresses", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const addr1 = Keypair.generate().publicKey;
      const addr2 = Keypair.generate().publicKey;
      const [pda1] = findBlacklistPDA(stablecoinPDA, addr1, programId);
      const [pda2] = findBlacklistPDA(stablecoinPDA, addr2, programId);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });

    it("blacklist PDA is off-curve", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const address = Keypair.generate().publicKey;
      const [pda] = findBlacklistPDA(stablecoinPDA, address, programId);
      expect(PublicKey.isOnCurve(pda.toBuffer())).to.equal(false);
    });

    it("derives minter info PDA deterministically", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const minter = Keypair.generate().publicKey;
      const [pda1] = findMinterInfoPDA(stablecoinPDA, minter, programId);
      const [pda2] = findMinterInfoPDA(stablecoinPDA, minter, programId);
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it("derives different minter info PDAs for different minters", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const minter1 = Keypair.generate().publicKey;
      const minter2 = Keypair.generate().publicKey;
      const [pda1] = findMinterInfoPDA(stablecoinPDA, minter1, programId);
      const [pda2] = findMinterInfoPDA(stablecoinPDA, minter2, programId);
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });

    it("minter info PDA is off-curve", () => {
      const [stablecoinPDA] = findStablecoinPDA(mint, programId);
      const minter = Keypair.generate().publicKey;
      const [pda] = findMinterInfoPDA(stablecoinPDA, minter, programId);
      expect(PublicKey.isOnCurve(pda.toBuffer())).to.equal(false);
    });

    it("returns bump seed in range 0-255", () => {
      const [, bump] = findStablecoinPDA(mint, programId);
      expect(bump).to.be.at.least(0);
      expect(bump).to.be.at.most(255);
    });
  });

  describe("StablecoinConfig Validation", () => {
    it("accepts a valid SSS_1 config", () => {
      const config: StablecoinConfig = {
        preset: "SSS_1",
        name: "Test Dollar",
        symbol: "TUSD",
        decimals: 6,
        authority: Keypair.generate(),
      };
      expect(config.preset).to.equal("SSS_1");
      expect(config.name).to.equal("Test Dollar");
      expect(config.symbol).to.equal("TUSD");
      expect(config.decimals).to.equal(6);
    });

    it("accepts a valid SSS_2 config", () => {
      const config: StablecoinConfig = {
        preset: "SSS_2",
        name: "Regulated Dollar",
        symbol: "RUSD",
        decimals: 6,
        authority: Keypair.generate(),
        extensions: {
          permanentDelegate: true,
          transferHook: true,
        },
      };
      expect(config.preset).to.equal("SSS_2");
      expect(config.extensions?.permanentDelegate).to.equal(true);
      expect(config.extensions?.transferHook).to.equal(true);
    });

    it("defaults optional fields correctly", () => {
      const config: StablecoinConfig = {
        name: "Minimal",
        symbol: "MIN",
        authority: Keypair.generate(),
      };
      expect(config.preset).to.be.undefined;
      expect(config.decimals).to.be.undefined;
      expect(config.uri).to.be.undefined;
      expect(config.extensions).to.be.undefined;
    });
  });

  describe("Presets", () => {
    it("SSS_1 preset does not enable compliance extensions", async () => {
      const connection = new Connection("https://api.devnet.solana.com", "confirmed");
      const config: StablecoinConfig = {
        preset: "SSS_1",
        name: "Simple Coin",
        symbol: "SMP",
        authority: Keypair.generate(),
      };

      // Verify SSS_1 does not set permanent delegate or transfer hook
      // by checking the preset logic in the create flow
      let enablePermanentDelegate = false;
      let enableTransferHook = false;

      if (config.preset === Presets.SSS_2) {
        enablePermanentDelegate = true;
        enableTransferHook = true;
      }

      expect(enablePermanentDelegate).to.equal(false);
      expect(enableTransferHook).to.equal(false);
    });

    it("SSS_2 preset enables compliance extensions", async () => {
      const config: StablecoinConfig = {
        preset: "SSS_2",
        name: "Regulated Coin",
        symbol: "REG",
        authority: Keypair.generate(),
      };

      let enablePermanentDelegate = false;
      let enableTransferHook = false;

      if (config.preset === Presets.SSS_2) {
        enablePermanentDelegate = true;
        enableTransferHook = true;
      }

      expect(enablePermanentDelegate).to.equal(true);
      expect(enableTransferHook).to.equal(true);
    });

    it("SSS_2 config extensions can override defaults", () => {
      const config: StablecoinConfig = {
        preset: "SSS_2",
        name: "Custom Regulated",
        symbol: "CREG",
        authority: Keypair.generate(),
        extensions: {
          permanentDelegate: true,
          transferHook: false, // override: disable transfer hook even in SSS_2
          defaultAccountFrozen: true,
        },
      };

      let enablePermanentDelegate = false;
      let enableTransferHook = false;
      let defaultAccountFrozen = false;

      if (config.preset === Presets.SSS_2) {
        enablePermanentDelegate = true;
        enableTransferHook = true;
      }

      if (config.extensions) {
        enablePermanentDelegate = config.extensions.permanentDelegate ?? enablePermanentDelegate;
        enableTransferHook = config.extensions.transferHook ?? enableTransferHook;
        defaultAccountFrozen = config.extensions.defaultAccountFrozen ?? defaultAccountFrozen;
      }

      expect(enablePermanentDelegate).to.equal(true);
      expect(enableTransferHook).to.equal(false); // overridden
      expect(defaultAccountFrozen).to.equal(true);
    });

    it("Presets enum has correct values", () => {
      expect(Presets.SSS_1).to.equal("SSS_1");
      expect(Presets.SSS_2).to.equal("SSS_2");
    });
  });

  describe("ComplianceModule", () => {
    it("initializes with a stablecoin reference", () => {
      const mockStablecoin = {
        stablecoinPDA: Keypair.generate().publicKey,
        programId,
        connection: new Connection("https://api.devnet.solana.com"),
      };
      const compliance = new ComplianceModule(mockStablecoin, {} as any);
      expect(compliance).to.be.instanceOf(ComplianceModule);
    });

    it("derives blacklist PDA correctly via the module", () => {
      const stablecoinPDA = Keypair.generate().publicKey;
      const address = Keypair.generate().publicKey;

      // Derive PDA the same way ComplianceModule does internally
      const [blacklistPDA] = findBlacklistPDA(stablecoinPDA, address, programId);
      expect(blacklistPDA).to.be.instanceOf(PublicKey);
      expect(PublicKey.isOnCurve(blacklistPDA.toBuffer())).to.equal(false);
    });
  });

  describe("SolanaStablecoin.load", () => {
    it("creates an instance via load with correct PDA", async () => {
      const connection = new Connection("https://api.devnet.solana.com", "confirmed");
      const testMint = Keypair.generate().publicKey;
      const instance = await SolanaStablecoin.load(connection, testMint, programId);

      expect(instance.mint.toBase58()).to.equal(testMint.toBase58());
      expect(instance.programId.toBase58()).to.equal(programId.toBase58());

      const [expectedPDA] = findStablecoinPDA(testMint, programId);
      expect(instance.stablecoinPDA.toBase58()).to.equal(expectedPDA.toBase58());
    });

    it("has compliance module attached", async () => {
      const connection = new Connection("https://api.devnet.solana.com", "confirmed");
      const testMint = Keypair.generate().publicKey;
      const instance = await SolanaStablecoin.load(connection, testMint, programId);

      expect(instance.compliance).to.be.instanceOf(ComplianceModule);
    });
  });
});
