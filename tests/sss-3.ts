import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint,
  getExtensionTypes,
  ExtensionType,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

describe("SSS-3: Private Stablecoin (Allowlist)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;
  const mintKeypair = Keypair.generate();
  const minterKeypair = Keypair.generate();
  const allowedUser = Keypair.generate();
  const blockedUser = Keypair.generate();
  const randomUser = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let minterRolePDA: PublicKey;
  let minterInfoPDA: PublicKey;
  let allowlistPDA: PublicKey;
  let allowlistPDA2: PublicKey;
  let allowedUserATA: PublicKey;

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

    [allowlistPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("allowlist"), stablecoinPDA.toBuffer(), allowedUser.publicKey.toBuffer()],
      program.programId
    );

    [allowlistPDA2] = PublicKey.findProgramAddressSync(
      [Buffer.from("allowlist"), stablecoinPDA.toBuffer(), blockedUser.publicKey.toBuffer()],
      program.programId
    );

    allowedUserATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      allowedUser.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Fund accounts
    const fundTx = new anchor.web3.Transaction();
    for (const kp of [minterKeypair, allowedUser, blockedUser, randomUser]) {
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

  it("initializes an SSS-3 private stablecoin", async () => {
    const config = {
      name: "Private USD",
      symbol: "PUSD",
      uri: "https://example.com/pusd-metadata.json",
      decimals: 6,
      enablePermanentDelegate: true,
      enableTransferHook: true,
      defaultAccountFrozen: false,
      enableAllowlist: true,
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

    console.log("  Initialize SSS-3 tx:", tx);

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.name).to.equal("Private USD");
    expect(stablecoin.symbol).to.equal("PUSD");
    expect(stablecoin.enablePermanentDelegate).to.be.true;
    expect(stablecoin.enableTransferHook).to.be.true;
    expect(stablecoin.enableAllowlist).to.be.true;
    expect(stablecoin.paused).to.be.false;
  });

  it("SSS-3 mint has ConfidentialTransferMint extension", async () => {
    const mintInfo = await getMint(
      provider.connection,
      mintKeypair.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const extensions = getExtensionTypes(mintInfo.tlvData);
    expect(extensions).to.include(ExtensionType.ConfidentialTransferMint);
    console.log("  ConfidentialTransferMint extension verified on SSS-3 mint");
  });

  it("adds address to allowlist", async () => {
    const tx = await program.methods
      .addToAllowlist(allowedUser.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        allowlistEntry: allowlistPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  Allowlist add tx:", tx);

    const entry = await program.account.allowlistEntry.fetch(allowlistPDA);
    expect(entry.address.toBase58()).to.equal(allowedUser.publicKey.toBase58());
    expect(entry.addedBy.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(entry.addedAt.toNumber()).to.be.greaterThan(0);
  });

  it("removes address from allowlist", async () => {
    // First add blockedUser to allowlist so we can remove
    await program.methods
      .addToAllowlist(blockedUser.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        allowlistEntry: allowlistPDA2,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify it exists
    let entry = await program.account.allowlistEntry.fetch(allowlistPDA2);
    expect(entry.address.toBase58()).to.equal(blockedUser.publicKey.toBase58());

    // Remove
    const tx = await program.methods
      .removeFromAllowlistEntry(blockedUser.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        allowlistEntry: allowlistPDA2,
      })
      .rpc();

    console.log("  Allowlist remove tx:", tx);

    // Verify account closed
    const info = await provider.connection.getAccountInfo(allowlistPDA2);
    expect(info).to.be.null;
  });

  it("rejects allowlist add from non-authority", async () => {
    const someUser = Keypair.generate();
    const [somePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("allowlist"), stablecoinPDA.toBuffer(), someUser.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .addToAllowlist(someUser.publicKey)
        .accounts({
          authority: randomUser.publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry: somePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("rejects allowlist remove from non-authority", async () => {
    try {
      await program.methods
        .removeFromAllowlistEntry(allowedUser.publicKey)
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

  it("rejects allowlist on SSS-1 stablecoin", async () => {
    // Create a separate SSS-1
    const sss1Mint = Keypair.generate();
    const [sss1PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin"), sss1Mint.publicKey.toBuffer()],
      program.programId
    );

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

    const someUser = Keypair.generate();
    const [alPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("allowlist"), sss1PDA.toBuffer(), someUser.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .addToAllowlist(someUser.publicKey)
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

  it("rejects duplicate allowlist entry", async () => {
    // allowedUser is already on the allowlist
    try {
      await program.methods
        .addToAllowlist(allowedUser.publicKey)
        .accounts({
          authority: authority.publicKey,
          stablecoin: stablecoinPDA,
          allowlistEntry: allowlistPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown — account already exists");
    } catch (err: any) {
      // Anchor will throw because the PDA account already exists (init constraint)
      expect(err.toString()).to.not.be.empty;
    }
  });

  it("allowlist entry persists after adding and can be queried", async () => {
    const entry = await program.account.allowlistEntry.fetch(allowlistPDA);
    expect(entry.stablecoin.toBase58()).to.equal(stablecoinPDA.toBase58());
    expect(entry.address.toBase58()).to.equal(allowedUser.publicKey.toBase58());
  });

  it("SSS-3 still supports minting (SSS-2 features work)", async () => {
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

    // Create ATA
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        allowedUserATA,
        allowedUser.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    );
    await provider.sendAndConfirm(createAtaTx);

    // Mint tokens
    await program.methods
      .mintTokens(new BN(1_000_000))
      .accounts({
        minter: minterKeypair.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        recipientTokenAccount: allowedUserATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([minterKeypair])
      .rpc();

    const balance = await provider.connection.getTokenAccountBalance(allowedUserATA);
    expect(Number(balance.value.amount)).to.equal(1_000_000);
  });

  it("SSS-3 supports blacklist alongside allowlist", async () => {
    // Assign blacklister (SSS-3 has compliance enabled via permanent delegate)
    const blacklister = Keypair.generate();
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: blacklister.publicKey,
        lamports: LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);

    const [blRolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("blacklister"), blacklister.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .assignRole({ blacklister: {} }, blacklister.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Blacklist a user
    const target = Keypair.generate();
    const [blacklistPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("blacklist"), stablecoinPDA.toBuffer(), target.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .addToBlacklist(target.publicKey, "SSS-3 compliance test")
      .accounts({
        blacklister: blacklister.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: blRolePDA,
        blacklistEntry: blacklistPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([blacklister])
      .rpc();

    const entry = await program.account.blacklistEntry.fetch(blacklistPDA);
    expect(entry.address.toBase58()).to.equal(target.publicKey.toBase58());
    expect(entry.reason).to.equal("SSS-3 compliance test");
  });
});
