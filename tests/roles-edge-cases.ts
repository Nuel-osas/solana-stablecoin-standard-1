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

describe("Roles & Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;
  const mintKeypair = Keypair.generate();
  const minterKeypair = Keypair.generate();
  const pauserKeypair = Keypair.generate();
  const burnerKeypair = Keypair.generate();
  const randomUser = Keypair.generate();
  const recipient = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let minterRolePDA: PublicKey;
  let minterInfoPDA: PublicKey;
  let pauserRolePDA: PublicKey;
  let burnerRolePDA: PublicKey;
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

    [pauserRolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("pauser"), pauserKeypair.publicKey.toBuffer()],
      program.programId
    );

    [burnerRolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("burner"), burnerKeypair.publicKey.toBuffer()],
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
    for (const kp of [minterKeypair, pauserKeypair, burnerKeypair, randomUser, recipient]) {
      fundTx.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: kp.publicKey,
          lamports: LAMPORTS_PER_SOL,
        })
      );
    }
    await provider.sendAndConfirm(fundTx);

    // Initialize stablecoin
    await program.methods
      .initialize({
        name: "Edge Test USD",
        symbol: "EUSD",
        uri: "",
        decimals: 6,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        defaultAccountFrozen: false,
        enableAllowlist: false,
        supplyCap: null,
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

  // ============ Role Assignment & Revocation ============

  it("assigns and verifies minter role", async () => {
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

    const role = await program.account.roleAssignment.fetch(minterRolePDA);
    expect(role.active).to.be.true;
    expect(role.assignee.toBase58()).to.equal(minterKeypair.publicKey.toBase58());
  });

  it("revokes minter role", async () => {
    await program.methods
      .revokeRole({ minter: {} }, minterKeypair.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
      })
      .rpc();

    const role = await program.account.roleAssignment.fetch(minterRolePDA);
    expect(role.active).to.be.false;
  });

  it("revoked minter cannot mint", async () => {
    try {
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
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("re-assigns minter role after revocation", async () => {
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

    const role = await program.account.roleAssignment.fetch(minterRolePDA);
    expect(role.active).to.be.true;

    // Can mint again
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

    const balance = await provider.connection.getTokenAccountBalance(recipientATA);
    expect(Number(balance.value.amount)).to.equal(1_000_000);
  });

  it("rejects revoke_role from non-authority", async () => {
    try {
      await program.methods
        .revokeRole({ minter: {} }, minterKeypair.publicKey)
        .accounts({
          authority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: minterRolePDA,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  // ============ Pauser Role ============

  it("assigns pauser role", async () => {
    await program.methods
      .assignRole({ pauser: {} }, pauserKeypair.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const role = await program.account.roleAssignment.fetch(pauserRolePDA);
    expect(role.active).to.be.true;
  });

  it("pauser can pause", async () => {
    await program.methods
      .pause()
      .accounts({
        authority: pauserKeypair.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
      })
      .signers([pauserKeypair])
      .rpc();

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.paused).to.be.true;
  });

  it("rejects burn while paused", async () => {
    // Setup burner
    await program.methods
      .assignRole({ burner: {} }, burnerKeypair.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: burnerRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Create burner ATA and mint tokens to it first - need to unpause temporarily
    await program.methods
      .unpause()
      .accounts({
        authority: pauserKeypair.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
      })
      .signers([pauserKeypair])
      .rpc();

    const burnerATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      burnerKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        burnerATA,
        burnerKeypair.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    );
    await provider.sendAndConfirm(createAtaTx);

    await program.methods
      .mintTokens(new BN(500_000))
      .accounts({
        minter: minterKeypair.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: burnerATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minterKeypair])
      .rpc();

    // Pause again
    await program.methods
      .pause()
      .accounts({
        authority: pauserKeypair.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
      })
      .signers([pauserKeypair])
      .rpc();

    // Try burn while paused
    try {
      await program.methods
        .burnTokens(new BN(100_000))
        .accounts({
          burner: burnerKeypair.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: burnerRolePDA,
          burnFrom: burnerATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          oracleConfig: null,
          priceFeed: null,
        })
        .signers([burnerKeypair])
        .rpc();
      expect.fail("Should have thrown Paused");
    } catch (err: any) {
      expect(err.toString()).to.contain("Paused");
    }
  });

  it("rejects mint while paused", async () => {
    try {
      await program.methods
        .mintTokens(new BN(100))
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
      expect.fail("Should have thrown Paused");
    } catch (err: any) {
      expect(err.toString()).to.contain("Paused");
    }
  });

  it("pauser can unpause", async () => {
    await program.methods
      .unpause()
      .accounts({
        authority: pauserKeypair.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: pauserRolePDA,
      })
      .signers([pauserKeypair])
      .rpc();

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.paused).to.be.false;
  });

  it("rejects unauthorized pause", async () => {
    try {
      await program.methods
        .pause()
        .accounts({
          authority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: null,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  // ============ Freeze Edge Cases ============

  it("pauser can freeze accounts", async () => {
    await program.methods
      .freezeAccount()
      .accounts({
        authority: pauserKeypair.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: pauserRolePDA,
        targetAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([pauserKeypair])
      .rpc();

    const info = await provider.connection.getParsedAccountInfo(recipientATA);
    const data = (info.value?.data as any)?.parsed?.info;
    expect(data.state).to.equal("frozen");
  });

  it("pauser can thaw accounts", async () => {
    await program.methods
      .thawAccount()
      .accounts({
        authority: pauserKeypair.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: pauserRolePDA,
        targetAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([pauserKeypair])
      .rpc();

    const info = await provider.connection.getParsedAccountInfo(recipientATA);
    const data = (info.value?.data as any)?.parsed?.info;
    expect(data.state).to.equal("initialized");
  });

  it("rejects unauthorized freeze", async () => {
    try {
      await program.methods
        .freezeAccount()
        .accounts({
          authority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          mint: mintKeypair.publicKey,
          roleAssignment: null,
          targetAccount: recipientATA,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  // ============ Seizer Role on SSS-1 ============

  it("rejects seizer role on SSS-1 (no compliance)", async () => {
    const seizerKp = Keypair.generate();
    const [seizerRole] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("seizer"), seizerKp.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .assignRole({ seizer: {} }, seizerKp.publicKey)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: seizerRole,
          minterInfo: null,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown ComplianceNotEnabled");
    } catch (err: any) {
      expect(err.toString()).to.contain("ComplianceNotEnabled");
    }
  });

  // ============ Supply Tracking ============

  it("tracks total minted and burned accurately", async () => {
    const burnerATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      burnerKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Burn some tokens
    await program.methods
      .burnTokens(new BN(100_000))
      .accounts({
        burner: burnerKeypair.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: burnerRolePDA,
        burnFrom: burnerATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([burnerKeypair])
      .rpc();

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    // total_minted = 1M (from re-assign test) + 500K (from burner setup) = 1.5M
    expect(stablecoin.totalMinted.toNumber()).to.equal(1_500_000);
    expect(stablecoin.totalBurned.toNumber()).to.equal(100_000);
  });
});
