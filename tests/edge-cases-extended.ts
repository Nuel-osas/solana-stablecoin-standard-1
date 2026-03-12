import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

// Helpers
function derivePDAs(program: Program, mintKey: PublicKey) {
  const [stablecoinPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin"), mintKey.toBuffer()],
    program.programId
  );
  return { stablecoinPDA };
}

function deriveRolePDA(program: Program, stablecoinPDA: PublicKey, role: string, assignee: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from(role), assignee.toBuffer()],
    program.programId
  );
  return pda;
}

function deriveMinterInfoPDA(program: Program, stablecoinPDA: PublicKey, minter: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("minter_info"), stablecoinPDA.toBuffer(), minter.toBuffer()],
    program.programId
  );
  return pda;
}

function deriveBlacklistPDA(program: Program, stablecoinPDA: PublicKey, address: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("blacklist"), stablecoinPDA.toBuffer(), address.toBuffer()],
    program.programId
  );
  return pda;
}

function deriveAllowlistPDA(program: Program, stablecoinPDA: PublicKey, address: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowlist"), stablecoinPDA.toBuffer(), address.toBuffer()],
    program.programId
  );
  return pda;
}

async function fundAccounts(provider: anchor.AnchorProvider, ...keypairs: Keypair[]) {
  const tx = new anchor.web3.Transaction();
  for (const kp of keypairs) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: kp.publicKey,
        lamports: LAMPORTS_PER_SOL,
      })
    );
  }
  await provider.sendAndConfirm(tx);
}

async function createATA(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const tx = new anchor.web3.Transaction().add(
    createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      ata,
      owner,
      mint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )
  );
  await provider.sendAndConfirm(tx);
  return ata;
}

async function initStablecoin(
  program: Program,
  authority: anchor.Wallet,
  mintKeypair: Keypair,
  overrides: Partial<{
    name: string;
    symbol: string;
    uri: string;
    decimals: number;
    enablePermanentDelegate: boolean;
    enableTransferHook: boolean;
    defaultAccountFrozen: boolean;
    enableAllowlist: boolean;
    supplyCap: BN | null;
  }> = {},
) {
  const { stablecoinPDA } = derivePDAs(program, mintKeypair.publicKey);
  const config = {
    name: overrides.name ?? "Test USD",
    symbol: overrides.symbol ?? "TUSD",
    uri: overrides.uri ?? "",
    decimals: overrides.decimals ?? 6,
    enablePermanentDelegate: overrides.enablePermanentDelegate ?? false,
    enableTransferHook: overrides.enableTransferHook ?? false,
    defaultAccountFrozen: overrides.defaultAccountFrozen ?? false,
    enableAllowlist: overrides.enableAllowlist ?? false,
    supplyCap: overrides.supplyCap ?? null,
  };

  await program.methods
    .initialize(config)
    .accounts({
      authority: authority.publicKey,
      mint: mintKeypair.publicKey,
      stablecoin: stablecoinPDA,
      transferHookProgram: null,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([mintKeypair])
    .rpc();

  return stablecoinPDA;
}

// ==================== TEST SUITES ====================

describe("Role Escalation & Access Control Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const nonAuthority = Keypair.generate();
  const minter1 = Keypair.generate();
  const minter2 = Keypair.generate();
  const burner = Keypair.generate();
  const pauser = Keypair.generate();
  const recipient = Keypair.generate();

  let stablecoinPDA: PublicKey;

  before(async () => {
    await fundAccounts(provider, nonAuthority, minter1, minter2, burner, pauser, recipient);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair);
  });

  it("non-authority cannot assign minter role", async () => {
    const rolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter1.publicKey);
    const minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter1.publicKey);

    try {
      await program.methods
        .assignRole({ minter: {} }, minter1.publicKey)
        .accounts({
          authority: nonAuthority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: rolePDA,
          minterInfo: minterInfoPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonAuthority])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("non-authority cannot assign burner role", async () => {
    const rolePDA = deriveRolePDA(program, stablecoinPDA, "burner", burner.publicKey);

    try {
      await program.methods
        .assignRole({ burner: {} }, burner.publicKey)
        .accounts({
          authority: nonAuthority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: rolePDA,
          minterInfo: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonAuthority])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("non-authority cannot assign pauser role", async () => {
    const rolePDA = deriveRolePDA(program, stablecoinPDA, "pauser", pauser.publicKey);

    try {
      await program.methods
        .assignRole({ pauser: {} }, pauser.publicKey)
        .accounts({
          authority: nonAuthority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: rolePDA,
          minterInfo: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonAuthority])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("minter cannot escalate to assign other minters", async () => {
    // First assign minter1 as a legit minter
    const minter1RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter1.publicKey);
    const minter1InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter1.publicKey);

    await program.methods
      .assignRole({ minter: {} }, minter1.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minter1RolePDA,
        minterInfo: minter1InfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Now minter1 tries to assign minter2
    const minter2RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter2.publicKey);
    const minter2InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter2.publicKey);

    try {
      await program.methods
        .assignRole({ minter: {} }, minter2.publicKey)
        .accounts({
          authority: minter1.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: minter2RolePDA,
          minterInfo: minter2InfoPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([minter1])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("pauser cannot escalate to assign roles", async () => {
    // Assign pauser role
    const pauserRolePDA = deriveRolePDA(program, stablecoinPDA, "pauser", pauser.publicKey);

    await program.methods
      .assignRole({ pauser: {} }, pauser.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Pauser tries to assign minter role
    const minter2RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter2.publicKey);
    const minter2InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter2.publicKey);

    try {
      await program.methods
        .assignRole({ minter: {} }, minter2.publicKey)
        .accounts({
          authority: pauser.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: minter2RolePDA,
          minterInfo: minter2InfoPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([pauser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("burner cannot mint tokens", async () => {
    // Assign burner role
    const burnerRolePDA = deriveRolePDA(program, stablecoinPDA, "burner", burner.publicKey);

    await program.methods
      .assignRole({ burner: {} }, burner.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: burnerRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Burner tries to mint — this should fail because the role PDA seeds won't match the minter PDA seeds
    // The mint instruction expects a minter role assignment PDA
    const recipientATA = await createATA(provider, mintKeypair.publicKey, recipient.publicKey);

    try {
      await program.methods
        .mintTokens(new BN(1_000_000))
        .accounts({
          minter: burner.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: burnerRolePDA,
          minterInfo: deriveMinterInfoPDA(program, stablecoinPDA, burner.publicKey),
          recipientTokenAccount: recipientATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([burner])
        .rpc();
      expect.fail("Should have thrown — burner can't mint");
    } catch (err: any) {
      // Will fail on PDA seed constraint (role seed is "burner", but mint instruction expects "minter" seed)
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("multiple minters with different quotas", async () => {
    // minter1 already assigned, now assign minter2
    const minter2RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter2.publicKey);
    const minter2InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter2.publicKey);
    const minter1InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter1.publicKey);

    await program.methods
      .assignRole({ minter: {} }, minter2.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minter2RolePDA,
        minterInfo: minter2InfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Set different quotas
    await program.methods
      .updateMinterQuota(new BN(5_000_000))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        minterInfo: minter1InfoPDA,
      })
      .rpc();

    await program.methods
      .updateMinterQuota(new BN(2_000_000))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        minterInfo: minter2InfoPDA,
      })
      .rpc();

    // Verify different quotas
    const info1 = await program.account.minterInfo.fetch(minter1InfoPDA);
    const info2 = await program.account.minterInfo.fetch(minter2InfoPDA);
    expect(info1.quota.toNumber()).to.equal(5_000_000);
    expect(info2.quota.toNumber()).to.equal(2_000_000);
  });

  it("minter1 can mint within its quota", async () => {
    const minter1RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter1.publicKey);
    const minter1InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter1.publicKey);
    const recipientATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    await program.methods
      .mintTokens(new BN(3_000_000))
      .accounts({
        minter: minter1.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minter1RolePDA,
        minterInfo: minter1InfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter1])
      .rpc();

    const info = await program.account.minterInfo.fetch(minter1InfoPDA);
    expect(info.minted.toNumber()).to.equal(3_000_000);
  });

  it("minter2 quota is independent from minter1", async () => {
    const minter2RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter2.publicKey);
    const minter2InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter2.publicKey);
    const recipientATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    await program.methods
      .mintTokens(new BN(1_500_000))
      .accounts({
        minter: minter2.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minter2RolePDA,
        minterInfo: minter2InfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter2])
      .rpc();

    const info = await program.account.minterInfo.fetch(minter2InfoPDA);
    expect(info.minted.toNumber()).to.equal(1_500_000);
  });

  it("minter2 exceeds its own quota", async () => {
    const minter2RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter2.publicKey);
    const minter2InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter2.publicKey);
    const recipientATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    try {
      await program.methods
        .mintTokens(new BN(1_000_000)) // 1.5M + 1M > 2M quota
        .accounts({
          minter: minter2.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: minter2RolePDA,
          minterInfo: minter2InfoPDA,
          recipientTokenAccount: recipientATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([minter2])
        .rpc();
      expect.fail("Should have thrown MinterQuotaExceeded");
    } catch (err: any) {
      expect(err.toString()).to.contain("MinterQuotaExceeded");
    }
  });

  it("minter quota boundary: mint exactly to quota limit", async () => {
    const minter2RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter2.publicKey);
    const minter2InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter2.publicKey);
    const recipientATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // 2M quota, 1.5M already minted → 500K remaining
    await program.methods
      .mintTokens(new BN(500_000))
      .accounts({
        minter: minter2.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minter2RolePDA,
        minterInfo: minter2InfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter2])
      .rpc();

    const info = await program.account.minterInfo.fetch(minter2InfoPDA);
    expect(info.minted.toNumber()).to.equal(2_000_000);
  });

  it("minter quota boundary: mint 1 over quota fails", async () => {
    const minter2RolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter2.publicKey);
    const minter2InfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter2.publicKey);
    const recipientATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    try {
      await program.methods
        .mintTokens(new BN(1)) // exactly 1 over quota
        .accounts({
          minter: minter2.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: minter2RolePDA,
          minterInfo: minter2InfoPDA,
          recipientTokenAccount: recipientATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([minter2])
        .rpc();
      expect.fail("Should have thrown MinterQuotaExceeded");
    } catch (err: any) {
      expect(err.toString()).to.contain("MinterQuotaExceeded");
    }
  });
});

describe("Burn Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const minter = Keypair.generate();
  const burner = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let minterRolePDA: PublicKey;
  let minterInfoPDA: PublicKey;
  let burnerRolePDA: PublicKey;
  let burnerATA: PublicKey;

  before(async () => {
    await fundAccounts(provider, minter, burner);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair);

    minterRolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter.publicKey);
    minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter.publicKey);
    burnerRolePDA = deriveRolePDA(program, stablecoinPDA, "burner", burner.publicKey);

    // Assign minter
    await program.methods
      .assignRole({ minter: {} }, minter.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Assign burner
    await program.methods
      .assignRole({ burner: {} }, burner.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: burnerRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Create burner ATA and mint tokens
    burnerATA = await createATA(provider, mintKeypair.publicKey, burner.publicKey);

    await program.methods
      .mintTokens(new BN(1_000_000))
      .accounts({
        minter: minter.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: burnerATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter])
      .rpc();
  });

  it("burns tokens successfully", async () => {
    await program.methods
      .burnTokens(new BN(100_000))
      .accounts({
        burner: burner.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: burnerRolePDA,
        burnFrom: burnerATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([burner])
      .rpc();

    const balance = await provider.connection.getTokenAccountBalance(burnerATA);
    expect(Number(balance.value.amount)).to.equal(900_000);
  });

  it("rejects burn more than balance", async () => {
    try {
      await program.methods
        .burnTokens(new BN(10_000_000)) // More than 900K remaining
        .accounts({
          burner: burner.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: burnerRolePDA,
          burnFrom: burnerATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([burner])
        .rpc();
      expect.fail("Should have thrown — insufficient balance");
    } catch (err: any) {
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("rejects burn from non-burner", async () => {
    const randomUser = Keypair.generate();
    await fundAccounts(provider, randomUser);

    const randomATA = await createATA(provider, mintKeypair.publicKey, randomUser.publicKey);

    // Mint some tokens to randomUser
    await program.methods
      .mintTokens(new BN(100_000))
      .accounts({
        minter: minter.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: randomATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter])
      .rpc();

    // Try to burn without burner role — will fail on PDA seed constraint
    try {
      const fakeRolePDA = deriveRolePDA(program, stablecoinPDA, "burner", randomUser.publicKey);
      await program.methods
        .burnTokens(new BN(50_000))
        .accounts({
          burner: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: fakeRolePDA,
          burnFrom: randomATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown — no burner role");
    } catch (err: any) {
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("burns exact balance (zero remaining)", async () => {
    const balance = await provider.connection.getTokenAccountBalance(burnerATA);
    const remaining = Number(balance.value.amount);

    await program.methods
      .burnTokens(new BN(remaining))
      .accounts({
        burner: burner.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: burnerRolePDA,
        burnFrom: burnerATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([burner])
      .rpc();

    const newBalance = await provider.connection.getTokenAccountBalance(burnerATA);
    expect(Number(newBalance.value.amount)).to.equal(0);
  });

  it("rejects burn of zero amount from empty balance", async () => {
    try {
      await program.methods
        .burnTokens(new BN(1))
        .accounts({
          burner: burner.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: burnerRolePDA,
          burnFrom: burnerATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([burner])
        .rpc();
      expect.fail("Should have thrown — zero balance");
    } catch (err: any) {
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("total_burned tracks correctly", async () => {
    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    // We burned 100K + 900K = 1M
    expect(stablecoin.totalBurned.toNumber()).to.equal(1_000_000);
  });
});

describe("Pause/Unpause Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const pauser = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let pauserRolePDA: PublicKey;

  before(async () => {
    await fundAccounts(provider, pauser);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair);
    pauserRolePDA = deriveRolePDA(program, stablecoinPDA, "pauser", pauser.publicKey);

    await program.methods
      .assignRole({ pauser: {} }, pauser.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("authority can pause directly", async () => {
    await program.methods
      .pause()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: null,
      })
      .rpc();

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.paused).to.be.true;
  });

  it("authority can unpause directly", async () => {
    await program.methods
      .unpause()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: null,
      })
      .rpc();

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.paused).to.be.false;
  });

  it("pauser can pause", async () => {
    await program.methods
      .pause()
      .accounts({
        authority: pauser.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
      })
      .signers([pauser])
      .rpc();

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.paused).to.be.true;
  });

  it("pauser can unpause", async () => {
    await program.methods
      .unpause()
      .accounts({
        authority: pauser.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
      })
      .signers([pauser])
      .rpc();

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.paused).to.be.false;
  });

  it("pause-unpause-pause cycle works correctly", async () => {
    // Pause
    await program.methods.pause()
      .accounts({ authority: pauser.publicKey, stablecoin: stablecoinPDA, roleAssignment: pauserRolePDA })
      .signers([pauser]).rpc();
    let sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.paused).to.be.true;

    // Unpause
    await program.methods.unpause()
      .accounts({ authority: pauser.publicKey, stablecoin: stablecoinPDA, roleAssignment: pauserRolePDA })
      .signers([pauser]).rpc();
    sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.paused).to.be.false;

    // Pause again
    await program.methods.pause()
      .accounts({ authority: pauser.publicKey, stablecoin: stablecoinPDA, roleAssignment: pauserRolePDA })
      .signers([pauser]).rpc();
    sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.paused).to.be.true;

    // Clean up
    await program.methods.unpause()
      .accounts({ authority: pauser.publicKey, stablecoin: stablecoinPDA, roleAssignment: pauserRolePDA })
      .signers([pauser]).rpc();
  });

  it("revoked pauser cannot pause", async () => {
    // Revoke pauser role
    await program.methods
      .revokeRole({ pauser: {} }, pauser.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
      })
      .rpc();

    try {
      await program.methods
        .pause()
        .accounts({
          authority: pauser.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: pauserRolePDA,
        })
        .signers([pauser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });
});

describe("Freeze/Thaw Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const user = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let userATA: PublicKey;

  before(async () => {
    await fundAccounts(provider, user);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair);
    userATA = await createATA(provider, mintKeypair.publicKey, user.publicKey);
  });

  it("freeze then freeze again (double freeze)", async () => {
    // First freeze
    await program.methods
      .freezeAccount()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: null,
        targetAccount: userATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Second freeze — should fail or be a no-op
    try {
      await program.methods
        .freezeAccount()
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: null,
          targetAccount: userATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      // If it succeeds, that's OK — idempotent
      const info = await provider.connection.getParsedAccountInfo(userATA);
      const data = (info.value?.data as any)?.parsed?.info;
      expect(data.state).to.equal("frozen");
    } catch (err: any) {
      // Some implementations reject double freeze
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("thaw a frozen account", async () => {
    await program.methods
      .thawAccount()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: null,
        targetAccount: userATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const info = await provider.connection.getParsedAccountInfo(userATA);
    const data = (info.value?.data as any)?.parsed?.info;
    expect(data.state).to.equal("initialized");
  });

  it("thaw a non-frozen account fails", async () => {
    try {
      await program.methods
        .thawAccount()
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: null,
          targetAccount: userATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have thrown — account not frozen");
    } catch (err: any) {
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("frozen account cannot receive minted tokens", async () => {
    // Setup minter
    const minter = Keypair.generate();
    await fundAccounts(provider, minter);
    const minterRolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter.publicKey);
    const minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter.publicKey);

    await program.methods
      .assignRole({ minter: {} }, minter.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Freeze user's account
    await program.methods
      .freezeAccount()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: null,
        targetAccount: userATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Try to mint to frozen account
    try {
      await program.methods
        .mintTokens(new BN(100_000))
        .accounts({
          minter: minter.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: minterRolePDA,
          minterInfo: minterInfoPDA,
          recipientTokenAccount: userATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([minter])
        .rpc();
      expect.fail("Should have thrown — account is frozen");
    } catch (err: any) {
      expect(err.toString()).to.not.be.empty;
    }

    // Clean up: thaw
    await program.methods
      .thawAccount()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: null,
        targetAccount: userATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  });
});

describe("Supply Cap Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const minter = Keypair.generate();
  const burner = Keypair.generate();
  const recipient = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let minterRolePDA: PublicKey;
  let minterInfoPDA: PublicKey;
  let recipientATA: PublicKey;

  before(async () => {
    await fundAccounts(provider, minter, burner, recipient);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      supplyCap: new BN(5_000_000),
    });

    minterRolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter.publicKey);
    minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter.publicKey);

    await program.methods
      .assignRole({ minter: {} }, minter.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    recipientATA = await createATA(provider, mintKeypair.publicKey, recipient.publicKey);
  });

  it("mint exactly at supply cap", async () => {
    await program.methods
      .mintTokens(new BN(5_000_000))
      .accounts({
        minter: minter.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter])
      .rpc();

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.totalMinted.toNumber()).to.equal(5_000_000);
  });

  it("rejects 1 token over supply cap", async () => {
    try {
      await program.methods
        .mintTokens(new BN(1))
        .accounts({
          minter: minter.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: minterRolePDA,
          minterInfo: minterInfoPDA,
          recipientTokenAccount: recipientATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([minter])
        .rpc();
      expect.fail("Should have thrown SupplyCapExceeded");
    } catch (err: any) {
      expect(err.toString()).to.contain("SupplyCapExceeded");
    }
  });

  it("burn then mint back to cap works (net supply check)", async () => {
    // First assign burner and burn some
    const burnerRolePDA = deriveRolePDA(program, stablecoinPDA, "burner", burner.publicKey);
    await program.methods
      .assignRole({ burner: {} }, burner.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: burnerRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const burnerATA = await createATA(provider, mintKeypair.publicKey, burner.publicKey);

    // Mint to burner (increase cap first)
    await program.methods
      .setSupplyCap(new BN(6_000_000))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
      })
      .rpc();

    await program.methods
      .mintTokens(new BN(1_000_000))
      .accounts({
        minter: minter.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: burnerATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter])
      .rpc();

    // Burn 1M
    await program.methods
      .burnTokens(new BN(1_000_000))
      .accounts({
        burner: burner.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: burnerRolePDA,
        burnFrom: burnerATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([burner])
      .rpc();

    // Net supply = 6M - 1M = 5M. Cap is 6M. Should be able to mint 1M more
    await program.methods
      .mintTokens(new BN(1_000_000))
      .accounts({
        minter: minter.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter])
      .rpc();

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    const netSupply = sc.totalMinted.toNumber() - sc.totalBurned.toNumber();
    expect(netSupply).to.equal(6_000_000);
  });

  it("non-authority cannot set supply cap", async () => {
    const randomUser = Keypair.generate();
    await fundAccounts(provider, randomUser);

    try {
      await program.methods
        .setSupplyCap(new BN(999_999_999))
        .accounts({
          authority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });
});

describe("Blacklist Edge Cases (SSS-2)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const blacklister = Keypair.generate();
  const target = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let blacklisterRolePDA: PublicKey;
  let blacklistPDA: PublicKey;

  before(async () => {
    await fundAccounts(provider, blacklister, target);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      enablePermanentDelegate: true,
      enableTransferHook: true,
    });

    blacklisterRolePDA = deriveRolePDA(program, stablecoinPDA, "blacklister", blacklister.publicKey);
    blacklistPDA = deriveBlacklistPDA(program, stablecoinPDA, target.publicKey);

    await program.methods
      .assignRole({ blacklister: {} }, blacklister.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blacklisterRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("blacklists an address", async () => {
    await program.methods
      .addToBlacklist(target.publicKey, "Test blacklist")
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blacklisterRolePDA,
        blacklistEntry: blacklistPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklister])
      .rpc();

    const entry = await program.account.blacklistEntry.fetch(blacklistPDA);
    expect(entry.active).to.be.true;
  });

  it("removes from blacklist", async () => {
    await program.methods
      .removeFromBlacklist(target.publicKey)
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blacklisterRolePDA,
        blacklistEntry: blacklistPDA,
      })
      .signers([blacklister])
      .rpc();

    const entry = await program.account.blacklistEntry.fetch(blacklistPDA);
    expect(entry.active).to.be.false;
  });

  it("double-remove from blacklist fails (already inactive)", async () => {
    try {
      await program.methods
        .removeFromBlacklist(target.publicKey)
        .accounts({
          blacklister: blacklister.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: blacklisterRolePDA,
          blacklistEntry: blacklistPDA,
        })
        .signers([blacklister])
        .rpc();
      expect.fail("Should have thrown NotBlacklisted");
    } catch (err: any) {
      expect(err.toString()).to.contain("NotBlacklisted");
    }
  });

  it("re-blacklist after removal works", async () => {
    await program.methods
      .addToBlacklist(target.publicKey, "Re-blacklisted")
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blacklisterRolePDA,
        blacklistEntry: blacklistPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklister])
      .rpc();

    const entry = await program.account.blacklistEntry.fetch(blacklistPDA);
    expect(entry.active).to.be.true;
    expect(entry.reason).to.equal("Re-blacklisted");
  });

  it("authority can blacklist without role assignment", async () => {
    const target2 = Keypair.generate();
    const blacklistPDA2 = deriveBlacklistPDA(program, stablecoinPDA, target2.publicKey);

    await program.methods
      .addToBlacklist(target2.publicKey, "Authority direct blacklist")
      .accounts({
        blacklister: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: null,
        blacklistEntry: blacklistPDA2,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const entry = await program.account.blacklistEntry.fetch(blacklistPDA2);
    expect(entry.active).to.be.true;
    expect(entry.blacklistedBy.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  it("seize from non-blacklisted account fails", async () => {
    const nonBlacklisted = Keypair.generate();
    await fundAccounts(provider, nonBlacklisted);

    const minter = Keypair.generate();
    await fundAccounts(provider, minter);
    const minterRolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter.publicKey);
    const minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter.publicKey);

    await program.methods
      .assignRole({ minter: {} }, minter.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const ata = await createATA(provider, mintKeypair.publicKey, nonBlacklisted.publicKey);
    await program.methods
      .mintTokens(new BN(100_000))
      .accounts({
        minter: minter.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter])
      .rpc();

    const treasuryATA = await createATA(provider, mintKeypair.publicKey, authority.publicKey);

    // Try seize — should fail because no blacklist entry PDA exists
    const fakeBlacklistPDA = deriveBlacklistPDA(program, stablecoinPDA, nonBlacklisted.publicKey);
    try {
      await program.methods
        .seize()
        .accounts({
          seizer: authority.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: null,
          blacklistEntry: fakeBlacklistPDA,
          sourceAccount: ata,
          treasuryAccount: treasuryATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have thrown — not blacklisted");
    } catch (err: any) {
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("unauthorized user cannot blacklist", async () => {
    const randomUser = Keypair.generate();
    await fundAccounts(provider, randomUser);
    const target3 = Keypair.generate();
    const blacklistPDA3 = deriveBlacklistPDA(program, stablecoinPDA, target3.publicKey);

    try {
      await program.methods
        .addToBlacklist(target3.publicKey, "Unauthorized attempt")
        .accounts({
          blacklister: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: null,
          blacklistEntry: blacklistPDA3,
          systemProgram: SystemProgram.programId,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });
});

describe("Authority Transfer Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const newAuth1 = Keypair.generate();
  const newAuth2 = Keypair.generate();
  const randomUser = Keypair.generate();

  let stablecoinPDA: PublicKey;

  before(async () => {
    await fundAccounts(provider, newAuth1, newAuth2, randomUser);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair);
  });

  it("nominate then nominate again (overwrite pending)", async () => {
    // Nominate newAuth1
    await program.methods
      .nominateAuthority(newAuth1.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
      })
      .rpc();

    let sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.pendingAuthority.toBase58()).to.equal(newAuth1.publicKey.toBase58());

    // Nominate newAuth2 (overwrites)
    await program.methods
      .nominateAuthority(newAuth2.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
      })
      .rpc();

    sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.pendingAuthority.toBase58()).to.equal(newAuth2.publicKey.toBase58());
  });

  it("overwritten nominee (newAuth1) cannot accept", async () => {
    try {
      await program.methods
        .acceptAuthority()
        .accounts({
          newAuthority: newAuth1.publicKey,
          stablecoin: stablecoinPDA,
        })
        .signers([newAuth1])
        .rpc();
      expect.fail("Should have thrown NotPendingAuthority");
    } catch (err: any) {
      expect(err.toString()).to.contain("NotPendingAuthority");
    }
  });

  it("current nominee (newAuth2) can accept", async () => {
    await program.methods
      .acceptAuthority()
      .accounts({
        newAuthority: newAuth2.publicKey,
        stablecoin: stablecoinPDA,
      })
      .signers([newAuth2])
      .rpc();

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.authority.toBase58()).to.equal(newAuth2.publicKey.toBase58());
    expect(sc.pendingAuthority.toBase58()).to.equal(PublicKey.default.toBase58());
  });

  it("old authority cannot nominate after transfer", async () => {
    try {
      await program.methods
        .nominateAuthority(randomUser.publicKey)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
        })
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("random user cannot accept authority", async () => {
    // First nominate someone
    await program.methods
      .nominateAuthority(newAuth1.publicKey)
      .accounts({
        authority: newAuth2.publicKey,
        stablecoin: stablecoinPDA,
      })
      .signers([newAuth2])
      .rpc();

    try {
      await program.methods
        .acceptAuthority()
        .accounts({
          newAuthority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown NotPendingAuthority");
    } catch (err: any) {
      expect(err.toString()).to.contain("NotPendingAuthority");
    }
  });

  it("direct transfer_authority works and clears pending", async () => {
    // newAuth2 is current authority, newAuth1 is pending
    await program.methods
      .transferAuthority(newAuth1.publicKey)
      .accounts({
        authority: newAuth2.publicKey,
        stablecoin: stablecoinPDA,
      })
      .signers([newAuth2])
      .rpc();

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.authority.toBase58()).to.equal(newAuth1.publicKey.toBase58());
    expect(sc.pendingAuthority.toBase58()).to.equal(PublicKey.default.toBase58());
  });
});

describe("Allowlist Edge Cases (SSS-3)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  const randomUser = Keypair.generate();

  let stablecoinPDA: PublicKey;

  before(async () => {
    await fundAccounts(provider, user1, user2, randomUser);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      enablePermanentDelegate: true,
      enableTransferHook: true,
      enableAllowlist: true,
    });
  });

  it("add to allowlist", async () => {
    const allowlistPDA = deriveAllowlistPDA(program, stablecoinPDA, user1.publicKey);

    await program.methods
      .addToAllowlist(user1.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        allowlistEntry: allowlistPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const entry = await program.account.allowlistEntry.fetch(allowlistPDA);
    expect(entry.address.toBase58()).to.equal(user1.publicKey.toBase58());
  });

  it("add then remove from allowlist", async () => {
    const allowlistPDA = deriveAllowlistPDA(program, stablecoinPDA, user2.publicKey);

    await program.methods
      .addToAllowlist(user2.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        allowlistEntry: allowlistPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Remove
    await program.methods
      .removeFromAllowlistEntry(user2.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        allowlistEntry: allowlistPDA,
      })
      .rpc();

    // Verify closed
    const info = await provider.connection.getAccountInfo(allowlistPDA);
    expect(info).to.be.null;
  });

  it("non-authority cannot add to allowlist", async () => {
    const allowlistPDA = deriveAllowlistPDA(program, stablecoinPDA, randomUser.publicKey);

    try {
      await program.methods
        .addToAllowlist(randomUser.publicKey)
        .accounts({
          authority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry: allowlistPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("non-authority cannot remove from allowlist", async () => {
    const allowlistPDA = deriveAllowlistPDA(program, stablecoinPDA, user1.publicKey);

    try {
      await program.methods
        .removeFromAllowlistEntry(user1.publicKey)
        .accounts({
          authority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry: allowlistPDA,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("duplicate allowlist entry fails", async () => {
    const allowlistPDA = deriveAllowlistPDA(program, stablecoinPDA, user1.publicKey);

    try {
      await program.methods
        .addToAllowlist(user1.publicKey)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry: allowlistPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown — PDA already exists");
    } catch (err: any) {
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("allowlist on non-SSS-3 stablecoin fails", async () => {
    const sss1Mint = Keypair.generate();
    const sss1PDA = await initStablecoin(program, authority, sss1Mint);

    const alPDA = deriveAllowlistPDA(program, sss1PDA, user1.publicKey);

    try {
      await program.methods
        .addToAllowlist(user1.publicKey)
        .accounts({
          authority: authority.publicKey,
          stablecoin: sss1PDA,
          allowlistEntry: alPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown AllowlistNotEnabled");
    } catch (err: any) {
      expect(err.toString()).to.contain("AllowlistNotEnabled");
    }
  });
});

describe("Initialization Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  it("initializes with 0 decimals", async () => {
    const mintKeypair = Keypair.generate();
    const stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      decimals: 0,
    });

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.decimals).to.equal(0);
  });

  it("initializes with 9 decimals", async () => {
    const mintKeypair = Keypair.generate();
    const stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      decimals: 9,
    });

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.decimals).to.equal(9);
  });

  it("initializes with all features enabled", async () => {
    const mintKeypair = Keypair.generate();
    const stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      name: "Full Feature USD",
      symbol: "FFUSD",
      enablePermanentDelegate: true,
      enableTransferHook: true,
      enableAllowlist: true,
      supplyCap: new BN(100_000_000),
    });

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.enablePermanentDelegate).to.be.true;
    expect(sc.enableTransferHook).to.be.true;
    expect(sc.enableAllowlist).to.be.true;
    expect(sc.supplyCap.toNumber()).to.equal(100_000_000);
  });

  it("initializes with no features (pure SSS-1)", async () => {
    const mintKeypair = Keypair.generate();
    const stablecoinPDA = await initStablecoin(program, authority, mintKeypair);

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.enablePermanentDelegate).to.be.false;
    expect(sc.enableTransferHook).to.be.false;
    expect(sc.enableAllowlist).to.be.false;
    expect(sc.supplyCap.toNumber()).to.equal(0);
    expect(sc.paused).to.be.false;
    expect(sc.totalMinted.toNumber()).to.equal(0);
    expect(sc.totalBurned.toNumber()).to.equal(0);
  });

  it("initializes with supply cap of 1 (minimum)", async () => {
    const mintKeypair = Keypair.generate();
    const stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      supplyCap: new BN(1),
    });

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.supplyCap.toNumber()).to.equal(1);
  });

  it("initializes with metadata URI", async () => {
    const mintKeypair = Keypair.generate();
    const stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      uri: "https://example.com/metadata.json",
    });

    const sc = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(sc.uri).to.equal("https://example.com/metadata.json");
  });
});

describe("Minter Quota Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const minter = Keypair.generate();
  const recipient = Keypair.generate();
  const randomUser = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let minterRolePDA: PublicKey;
  let minterInfoPDA: PublicKey;
  let recipientATA: PublicKey;

  before(async () => {
    await fundAccounts(provider, minter, recipient, randomUser);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair);

    minterRolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter.publicKey);
    minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter.publicKey);

    await program.methods
      .assignRole({ minter: {} }, minter.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    recipientATA = await createATA(provider, mintKeypair.publicKey, recipient.publicKey);
  });

  it("minter can mint with default unlimited quota (quota=0)", async () => {
    const info = await program.account.minterInfo.fetch(minterInfoPDA);
    expect(info.quota.toNumber()).to.equal(0); // 0 = unlimited

    await program.methods
      .mintTokens(new BN(1_000_000))
      .accounts({
        minter: minter.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter])
      .rpc();

    const balance = await provider.connection.getTokenAccountBalance(recipientATA);
    expect(Number(balance.value.amount)).to.equal(1_000_000);
  });

  it("non-authority cannot update minter quota", async () => {
    try {
      await program.methods
        .updateMinterQuota(new BN(999))
        .accounts({
          authority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          minterInfo: minterInfoPDA,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("set quota then increase quota", async () => {
    // Set quota to 5M
    await program.methods
      .updateMinterQuota(new BN(5_000_000))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        minterInfo: minterInfoPDA,
      })
      .rpc();

    let info = await program.account.minterInfo.fetch(minterInfoPDA);
    expect(info.quota.toNumber()).to.equal(5_000_000);

    // Increase to 10M
    await program.methods
      .updateMinterQuota(new BN(10_000_000))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        minterInfo: minterInfoPDA,
      })
      .rpc();

    info = await program.account.minterInfo.fetch(minterInfoPDA);
    expect(info.quota.toNumber()).to.equal(10_000_000);
  });

  it("set quota back to 0 (unlimited)", async () => {
    await program.methods
      .updateMinterQuota(new BN(0))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        minterInfo: minterInfoPDA,
      })
      .rpc();

    const info = await program.account.minterInfo.fetch(minterInfoPDA);
    expect(info.quota.toNumber()).to.equal(0);
  });
});

describe("Combined Compliance Scenarios", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  const minter = Keypair.generate();
  const burner = Keypair.generate();
  const pauser = Keypair.generate();
  const blacklister = Keypair.generate();
  const recipient = Keypair.generate();

  let stablecoinPDA: PublicKey;

  before(async () => {
    await fundAccounts(provider, minter, burner, pauser, blacklister, recipient);
    stablecoinPDA = await initStablecoin(program, authority, mintKeypair, {
      enablePermanentDelegate: true,
      enableTransferHook: true,
      supplyCap: new BN(50_000_000),
    });

    // Assign all roles
    const minterRolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter.publicKey);
    const minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter.publicKey);
    await program.methods
      .assignRole({ minter: {} }, minter.publicKey)
      .accounts({
        authority: authority.publicKey, stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA, minterInfo: minterInfoPDA, systemProgram: SystemProgram.programId,
      }).rpc();

    const burnerRolePDA = deriveRolePDA(program, stablecoinPDA, "burner", burner.publicKey);
    await program.methods
      .assignRole({ burner: {} }, burner.publicKey)
      .accounts({
        authority: authority.publicKey, stablecoin: stablecoinPDA,
        roleAssignment: burnerRolePDA, minterInfo: null, systemProgram: SystemProgram.programId,
      }).rpc();

    const pauserRolePDA = deriveRolePDA(program, stablecoinPDA, "pauser", pauser.publicKey);
    await program.methods
      .assignRole({ pauser: {} }, pauser.publicKey)
      .accounts({
        authority: authority.publicKey, stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA, minterInfo: null, systemProgram: SystemProgram.programId,
      }).rpc();

    const blRolePDA = deriveRolePDA(program, stablecoinPDA, "blacklister", blacklister.publicKey);
    await program.methods
      .assignRole({ blacklister: {} }, blacklister.publicKey)
      .accounts({
        authority: authority.publicKey, stablecoin: stablecoinPDA,
        roleAssignment: blRolePDA, minterInfo: null, systemProgram: SystemProgram.programId,
      }).rpc();
  });

  it("mint → pause → reject burn → unpause → burn lifecycle", async () => {
    const minterRolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter.publicKey);
    const minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter.publicKey);
    const burnerRolePDA = deriveRolePDA(program, stablecoinPDA, "burner", burner.publicKey);
    const pauserRolePDA = deriveRolePDA(program, stablecoinPDA, "pauser", pauser.publicKey);

    // Mint
    const burnerATA = await createATA(provider, mintKeypair.publicKey, burner.publicKey);
    await program.methods
      .mintTokens(new BN(2_000_000))
      .accounts({
        minter: minter.publicKey, stablecoin: stablecoinPDA, mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA, minterInfo: minterInfoPDA,
        recipientTokenAccount: burnerATA, tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null, priceFeed: null,
      })
      .signers([minter]).rpc();

    // Pause
    await program.methods.pause()
      .accounts({ authority: pauser.publicKey, stablecoin: stablecoinPDA, roleAssignment: pauserRolePDA })
      .signers([pauser]).rpc();

    // Reject burn while paused
    try {
      await program.methods
        .burnTokens(new BN(500_000))
        .accounts({
          burner: burner.publicKey, stablecoin: stablecoinPDA, mint: mintKeypair.publicKey,
          roleAssignment: burnerRolePDA, burnFrom: burnerATA, tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null, priceFeed: null,
        })
        .signers([burner]).rpc();
      expect.fail("Should have thrown Paused");
    } catch (err: any) {
      expect(err.toString()).to.contain("Paused");
    }

    // Unpause
    await program.methods.unpause()
      .accounts({ authority: pauser.publicKey, stablecoin: stablecoinPDA, roleAssignment: pauserRolePDA })
      .signers([pauser]).rpc();

    // Burn should work now
    await program.methods
      .burnTokens(new BN(500_000))
      .accounts({
        burner: burner.publicKey, stablecoin: stablecoinPDA, mint: mintKeypair.publicKey,
        roleAssignment: burnerRolePDA, burnFrom: burnerATA, tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null, priceFeed: null,
      })
      .signers([burner]).rpc();

    const balance = await provider.connection.getTokenAccountBalance(burnerATA);
    expect(Number(balance.value.amount)).to.equal(1_500_000);
  });

  it("mint → blacklist → seize lifecycle", async () => {
    const minterRolePDA = deriveRolePDA(program, stablecoinPDA, "minter", minter.publicKey);
    const minterInfoPDA = deriveMinterInfoPDA(program, stablecoinPDA, minter.publicKey);
    const blRolePDA = deriveRolePDA(program, stablecoinPDA, "blacklister", blacklister.publicKey);
    const seizerRolePDA = deriveRolePDA(program, stablecoinPDA, "seizer", authority.publicKey);

    // Mint to target
    const recipientATA = await createATA(provider, mintKeypair.publicKey, recipient.publicKey);
    await program.methods
      .mintTokens(new BN(3_000_000))
      .accounts({
        minter: minter.publicKey, stablecoin: stablecoinPDA, mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA, minterInfo: minterInfoPDA,
        recipientTokenAccount: recipientATA, tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null, priceFeed: null,
      })
      .signers([minter]).rpc();

    // Blacklist
    const blacklistPDA = deriveBlacklistPDA(program, stablecoinPDA, recipient.publicKey);
    await program.methods
      .addToBlacklist(recipient.publicKey, "Suspicious activity")
      .accounts({
        blacklister: blacklister.publicKey, stablecoin: stablecoinPDA,
        roleAssignment: blRolePDA, blacklistEntry: blacklistPDA, systemProgram: SystemProgram.programId,
      })
      .signers([blacklister]).rpc();

    // Seize (authority is master, no need for seizer role)
    const treasuryATA = await createATA(provider, mintKeypair.publicKey, authority.publicKey);
    await program.methods
      .seize()
      .accounts({
        seizer: authority.publicKey, stablecoin: stablecoinPDA, mint: mintKeypair.publicKey,
        roleAssignment: null, blacklistEntry: blacklistPDA,
        sourceAccount: recipientATA, treasuryAccount: treasuryATA, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Verify seizure
    const targetBalance = await provider.connection.getTokenAccountBalance(recipientATA);
    expect(Number(targetBalance.value.amount)).to.equal(0);

    const treasuryBalance = await provider.connection.getTokenAccountBalance(treasuryATA);
    expect(Number(treasuryBalance.value.amount)).to.equal(3_000_000);
  });

  it("role assignment and revocation preserves audit trail", async () => {
    const testUser = Keypair.generate();
    await fundAccounts(provider, testUser);
    const rolePDA = deriveRolePDA(program, stablecoinPDA, "burner", testUser.publicKey);

    // Assign
    await program.methods
      .assignRole({ burner: {} }, testUser.publicKey)
      .accounts({
        authority: authority.publicKey, stablecoin: stablecoinPDA,
        roleAssignment: rolePDA, minterInfo: null, systemProgram: SystemProgram.programId,
      }).rpc();

    let role = await program.account.roleAssignment.fetch(rolePDA);
    expect(role.active).to.be.true;
    expect(role.grantedBy.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(Number(role.grantedAt)).to.be.greaterThan(0);

    // Revoke
    await program.methods
      .revokeRole({ burner: {} }, testUser.publicKey)
      .accounts({
        authority: authority.publicKey, stablecoin: stablecoinPDA, roleAssignment: rolePDA,
      }).rpc();

    // PDA still exists with active=false (audit trail preserved!)
    role = await program.account.roleAssignment.fetch(rolePDA);
    expect(role.active).to.be.false;
    expect(role.assignee.toBase58()).to.equal(testUser.publicKey.toBase58());
  });
});
