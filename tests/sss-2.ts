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

describe("SSS-2: Compliant Stablecoin", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;
  const mintKeypair = Keypair.generate();

  // Role holders
  const blacklister = Keypair.generate();
  const seizer = Keypair.generate();
  const minter = Keypair.generate();

  // Target for blacklisting
  const targetUser = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let blacklisterRolePDA: PublicKey;
  let seizerRolePDA: PublicKey;
  let minterRolePDA: PublicKey;
  let minterInfoPDA: PublicKey;
  let blacklistPDA: PublicKey;
  let targetATA: PublicKey;
  let treasuryATA: PublicKey;

  before(async () => {
    [stablecoinPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin"), mintKeypair.publicKey.toBuffer()],
      program.programId
    );

    [blacklisterRolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("blacklister"), blacklister.publicKey.toBuffer()],
      program.programId
    );

    [seizerRolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("seizer"), seizer.publicKey.toBuffer()],
      program.programId
    );

    [minterRolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("minter"), minter.publicKey.toBuffer()],
      program.programId
    );

    [minterInfoPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter_info"), stablecoinPDA.toBuffer(), minter.publicKey.toBuffer()],
      program.programId
    );

    [blacklistPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("blacklist"), stablecoinPDA.toBuffer(), targetUser.publicKey.toBuffer()],
      program.programId
    );

    targetATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      targetUser.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    treasuryATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Fund role holders
    const fundTx = new anchor.web3.Transaction();
    for (const kp of [blacklister, seizer, minter, targetUser]) {
      fundTx.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: kp.publicKey,
          lamports: LAMPORTS_PER_SOL,
        })
      );
    }
    await provider.sendAndConfirm(fundTx);
  });

  it("initializes an SSS-2 compliant stablecoin", async () => {
    const config = {
      name: "Compliant USD",
      symbol: "CUSD",
      uri: "https://example.com/cusd-metadata.json",
      decimals: 6,
      enablePermanentDelegate: true,
      enableTransferHook: true,
      defaultAccountFrozen: false,
      enableAllowlist: false,
      supplyCap: null,
    };

    const tx = await program.methods
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

    console.log("  Initialize SSS-2 tx:", tx);

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.name).to.equal("Compliant USD");
    expect(stablecoin.symbol).to.equal("CUSD");
    expect(stablecoin.enablePermanentDelegate).to.be.true;
    expect(stablecoin.enableTransferHook).to.be.true;
    expect(stablecoin.paused).to.be.false;
  });

  it("assigns compliance roles (blacklister + seizer + minter)", async () => {
    // Assign blacklister
    const blTx = await program.methods
      .assignRole({ blacklister: {} }, blacklister.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blacklisterRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  Assign blacklister tx:", blTx);

    const blRole = await program.account.roleAssignment.fetch(blacklisterRolePDA);
    expect(blRole.active).to.be.true;

    // Assign seizer
    const szTx = await program.methods
      .assignRole({ seizer: {} }, seizer.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: seizerRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  Assign seizer tx:", szTx);

    const szRole = await program.account.roleAssignment.fetch(seizerRolePDA);
    expect(szRole.active).to.be.true;

    // Assign minter (needed for seize test setup)
    const mtTx = await program.methods
      .assignRole({ minter: {} }, minter.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  Assign minter tx:", mtTx);
  });

  it("adds address to blacklist", async () => {
    const tx = await program.methods
      .addToBlacklist(targetUser.publicKey, "OFAC sanctions match")
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blacklisterRolePDA,
        blacklistEntry: blacklistPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklister])
      .rpc();

    console.log("  Blacklist add tx:", tx);

    const entry = await program.account.blacklistEntry.fetch(blacklistPDA);
    expect(entry.address.toBase58()).to.equal(targetUser.publicKey.toBase58());
    expect(entry.reason).to.equal("OFAC sanctions match");
    expect(entry.blacklistedBy.toBase58()).to.equal(blacklister.publicKey.toBase58());
    expect(entry.blacklistedAt.toNumber()).to.be.greaterThan(0);
  });

  it("removes address from blacklist", async () => {
    const tx = await program.methods
      .removeFromBlacklist(targetUser.publicKey)
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blacklisterRolePDA,
        blacklistEntry: blacklistPDA,
      })
      .signers([blacklister])
      .rpc();

    console.log("  Blacklist remove tx:", tx);

    // Verify entry deactivated (audit trail preserved)
    const entry = await program.account.blacklistEntry.fetch(blacklistPDA);
    expect(entry.active).to.be.false;
  });

  it("seizes tokens from blacklisted account", async () => {
    // Setup: create ATAs, mint tokens to target, then blacklist them

    // Create target ATA
    const createTargetAta = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        targetATA,
        targetUser.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    );
    await provider.sendAndConfirm(createTargetAta);

    // Create treasury ATA
    const createTreasuryAta = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        treasuryATA,
        authority.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    );
    await provider.sendAndConfirm(createTreasuryAta);

    // Mint tokens to target
    const mintAmount = 5_000_000;
    await program.methods
      .mintTokens(new BN(mintAmount))
      .accounts({
        minter: minter.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: targetATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        oracleConfig: null,
        priceFeed: null,
      })
      .signers([minter])
      .rpc();

    // Verify target got tokens
    let balance = await provider.connection.getTokenAccountBalance(targetATA);
    expect(Number(balance.value.amount)).to.equal(mintAmount);

    // Blacklist the target
    await program.methods
      .addToBlacklist(targetUser.publicKey, "Suspicious activity")
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blacklisterRolePDA,
        blacklistEntry: blacklistPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklister])
      .rpc();

    // Seize tokens
    const seizeTx = await program.methods
      .seize()
      .accounts({
        seizer: seizer.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: seizerRolePDA,
        blacklistEntry: blacklistPDA,
        sourceAccount: targetATA,
        treasuryAccount: treasuryATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([seizer])
      .rpc();

    console.log("  Seize tx:", seizeTx);

    // Verify tokens moved to treasury
    const targetBalance = await provider.connection.getTokenAccountBalance(targetATA);
    expect(Number(targetBalance.value.amount)).to.equal(0);

    const treasuryBalance = await provider.connection.getTokenAccountBalance(treasuryATA);
    expect(Number(treasuryBalance.value.amount)).to.equal(mintAmount);
  });

  it("rejects blacklist on SSS-1 stablecoin", async () => {
    // Create a separate SSS-1 stablecoin
    const sss1Mint = Keypair.generate();
    const [sss1PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin"), sss1Mint.publicKey.toBuffer()],
      program.programId
    );

    // Initialize as SSS-1 (no compliance)
    await program.methods
      .initialize({
        name: "Simple USD",
        symbol: "SUSD",
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
        mint: sss1Mint.publicKey,
        stablecoin: sss1PDA,
        transferHookProgram: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([sss1Mint])
      .rpc();

    // Try to assign blacklister role on SSS-1 — should fail with ComplianceNotEnabled
    const bl = Keypair.generate();
    const [blRole] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), sss1PDA.toBuffer(), Buffer.from("blacklister"), bl.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .assignRole({ blacklister: {} }, bl.publicKey)
        .accounts({
          authority: authority.publicKey,
          stablecoin: sss1PDA,
          roleAssignment: blRole,
          minterInfo: null,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown ComplianceNotEnabled");
    } catch (err: any) {
      expect(err.toString()).to.contain("ComplianceNotEnabled");
    }
  });

  it("rejects unauthorized role assignment", async () => {
    // A non-authority user tries to assign a role
    const imposter = Keypair.generate();
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: imposter.publicKey,
        lamports: LAMPORTS_PER_SOL / 10,
      })
    );
    await provider.sendAndConfirm(fundTx);

    const someUser = Keypair.generate();
    const [rolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("minter"), someUser.publicKey.toBuffer()],
      program.programId
    );
    const [mInfoPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter_info"), stablecoinPDA.toBuffer(), someUser.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .assignRole({ minter: {} }, someUser.publicKey)
        .accounts({
          authority: imposter.publicKey,
          stablecoin: stablecoinPDA,
          roleAssignment: rolePDA,
          minterInfo: mInfoPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([imposter])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });
});
