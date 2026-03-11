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

describe("Supply Cap & Minter Quotas", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;
  const mintKeypair = Keypair.generate();
  const minterKeypair = Keypair.generate();
  const recipient = Keypair.generate();
  const randomUser = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let minterRolePDA: PublicKey;
  let minterInfoPDA: PublicKey;
  let recipientATA: PublicKey;

  before(async () => {
    [stablecoinPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin"), mintKeypair.publicKey.toBuffer()],
      program.programId
    );

    [minterRolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("minter"), minterKeypair.publicKey.toBuffer()],
      program.programId
    );

    [minterInfoPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter_info"), stablecoinPDA.toBuffer(), minterKeypair.publicKey.toBuffer()],
      program.programId
    );

    recipientATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Fund accounts
    const fundTx = new anchor.web3.Transaction();
    for (const kp of [minterKeypair, recipient, randomUser]) {
      fundTx.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: kp.publicKey,
          lamports: LAMPORTS_PER_SOL,
        })
      );
    }
    await provider.sendAndConfirm(fundTx);

    // Initialize stablecoin with supply cap
    await program.methods
      .initialize({
        name: "Capped USD",
        symbol: "CUSD",
        uri: "",
        decimals: 6,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        defaultAccountFrozen: false,
        enableAllowlist: false,
        supplyCap: new BN(10_000_000), // 10 tokens max
      })
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

    // Assign minter
    await program.methods
      .assignRole({ minter: {} }, minterKeypair.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Create recipient ATA
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        recipientATA,
        recipient.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    );
    await provider.sendAndConfirm(createAtaTx);
  });

  it("initializes with supply cap", async () => {
    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.supplyCap.toNumber()).to.equal(10_000_000);
  });

  it("allows minting within supply cap", async () => {
    await program.methods
      .mintTokens(new BN(5_000_000))
      .accounts({
        minter: minterKeypair.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minterKeypair])
      .rpc();

    const balance = await provider.connection.getTokenAccountBalance(recipientATA);
    expect(Number(balance.value.amount)).to.equal(5_000_000);
  });

  it("rejects minting that would exceed supply cap", async () => {
    try {
      await program.methods
        .mintTokens(new BN(6_000_000)) // 5M + 6M > 10M cap
        .accounts({
          minter: minterKeypair.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: minterRolePDA,
          minterInfo: minterInfoPDA,
          recipientTokenAccount: recipientATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("Should have thrown SupplyCapExceeded");
    } catch (err: any) {
      expect(err.toString()).to.contain("SupplyCapExceeded");
    }
  });

  it("allows minting up to exact cap", async () => {
    await program.methods
      .mintTokens(new BN(5_000_000)) // 5M + 5M = 10M exactly
      .accounts({
        minter: minterKeypair.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minterKeypair])
      .rpc();

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.totalMinted.toNumber()).to.equal(10_000_000);
  });

  it("sets supply cap", async () => {
    const tx = await program.methods
      .setSupplyCap(new BN(20_000_000))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
      })
      .rpc();

    console.log("  Set supply cap tx:", tx);

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.supplyCap.toNumber()).to.equal(20_000_000);
  });

  it("rejects set_supply_cap from non-authority", async () => {
    try {
      await program.methods
        .setSupplyCap(new BN(999))
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

  it("removes supply cap by setting to 0", async () => {
    await program.methods
      .setSupplyCap(new BN(0))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
      })
      .rpc();

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.supplyCap.toNumber()).to.equal(0);
  });

  it("minting works after cap removed", async () => {
    // Should succeed since cap is 0 (unlimited)
    await program.methods
      .mintTokens(new BN(1_000_000))
      .accounts({
        minter: minterKeypair.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minterKeypair])
      .rpc();

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.totalMinted.toNumber()).to.equal(11_000_000);
  });

  it("updates minter quota", async () => {
    const tx = await program.methods
      .updateMinterQuota(new BN(15_000_000))
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        minterInfo: minterInfoPDA,
      })
      .rpc();

    console.log("  Update minter quota tx:", tx);

    const minterInfo = await program.account.minterInfo.fetch(minterInfoPDA);
    expect(minterInfo.quota.toNumber()).to.equal(15_000_000);
  });

  it("rejects minting that exceeds minter quota", async () => {
    // Minter has already minted 11M, quota is 15M, so 5M more would exceed
    try {
      await program.methods
        .mintTokens(new BN(5_000_000)) // 11M + 5M > 15M quota
        .accounts({
          minter: minterKeypair.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: minterRolePDA,
          minterInfo: minterInfoPDA,
          recipientTokenAccount: recipientATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("Should have thrown MinterQuotaExceeded");
    } catch (err: any) {
      expect(err.toString()).to.contain("MinterQuotaExceeded");
    }
  });
});
