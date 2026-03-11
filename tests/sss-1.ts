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

describe("SSS-1: Minimal Stablecoin", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program;
  const authority = provider.wallet as anchor.Wallet;
  const mintKeypair = Keypair.generate();
  const minterKeypair = Keypair.generate();
  const burnerKeypair = Keypair.generate();
  const recipient = Keypair.generate();

  let stablecoinPDA: PublicKey;
  let stablecoinBump: number;
  let minterRolePDA: PublicKey;
  let minterInfoPDA: PublicKey;
  let burnerRolePDA: PublicKey;
  let recipientATA: PublicKey;

  before(async () => {
    [stablecoinPDA, stablecoinBump] = PublicKey.findProgramAddressSync(
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

    [burnerRolePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("role"), stablecoinPDA.toBuffer(), Buffer.from("burner"), burnerKeypair.publicKey.toBuffer()],
      program.programId
    );

    // Fund the minter and burner so they can sign transactions
    const fundTx = new anchor.web3.Transaction();
    fundTx.add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: minterKeypair.publicKey,
        lamports: LAMPORTS_PER_SOL,
      }),
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: burnerKeypair.publicKey,
        lamports: LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(fundTx);

    // Pre-compute recipient ATA for Token-2022
    recipientATA = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
  });

  it("initializes an SSS-1 stablecoin", async () => {
    const config = {
      name: "Test USD",
      symbol: "TUSD",
      uri: "https://example.com/metadata.json",
      decimals: 6,
      enablePermanentDelegate: false,
      enableTransferHook: false,
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

    console.log("  Initialize tx:", tx);

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.name).to.equal("Test USD");
    expect(stablecoin.symbol).to.equal("TUSD");
    expect(stablecoin.decimals).to.equal(6);
    expect(stablecoin.paused).to.be.false;
    expect(stablecoin.enablePermanentDelegate).to.be.false;
    expect(stablecoin.enableTransferHook).to.be.false;
    expect(stablecoin.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(stablecoin.mint.toBase58()).to.equal(mintKeypair.publicKey.toBase58());
    expect(stablecoin.totalMinted.toNumber()).to.equal(0);
    expect(stablecoin.totalBurned.toNumber()).to.equal(0);
  });

  it("assigns minter role", async () => {
    const tx = await program.methods
      .assignRole({ minter: {} }, minterKeypair.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: minterRolePDA,
        minterInfo: minterInfoPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  Assign minter tx:", tx);

    const role = await program.account.roleAssignment.fetch(minterRolePDA);
    expect(role.active).to.be.true;
    expect(role.assignee.toBase58()).to.equal(minterKeypair.publicKey.toBase58());
  });

  it("mints tokens to recipient", async () => {
    // Create the recipient's associated token account
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

    const mintAmount = 1_000_000; // 1 token (6 decimals)
    const tx = await program.methods
      .mintTokens(new BN(mintAmount))
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

    console.log("  Mint tokens tx:", tx);

    // Verify supply updated
    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.totalMinted.toNumber()).to.equal(mintAmount);

    // Verify token balance
    const balance = await provider.connection.getTokenAccountBalance(recipientATA);
    expect(Number(balance.value.amount)).to.equal(mintAmount);
  });

  it("assigns burner role and burns tokens", async () => {
    // Assign burner role
    const assignTx = await program.methods
      .assignRole({ burner: {} }, burnerKeypair.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: burnerRolePDA,
        minterInfo: null,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  Assign burner tx:", assignTx);

    // Create burner's token account
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

    // Mint tokens to burner
    const mintAmount = 500_000;
    await program.methods
      .mintTokens(new BN(mintAmount))
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

    // Now burn
    const burnAmount = 200_000;
    const burnTx = await program.methods
      .burnTokens(new BN(burnAmount))
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

    console.log("  Burn tokens tx:", burnTx);

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.totalBurned.toNumber()).to.equal(burnAmount);

    const balance = await provider.connection.getTokenAccountBalance(burnerATA);
    expect(Number(balance.value.amount)).to.equal(mintAmount - burnAmount);
  });

  it("freezes and thaws token accounts", async () => {
    // Freeze the recipient's token account
    const freezeTx = await program.methods
      .freezeAccount()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: null,
        targetAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    console.log("  Freeze tx:", freezeTx);

    // Verify account is frozen
    const frozenInfo = await provider.connection.getParsedAccountInfo(recipientATA);
    const frozenData = (frozenInfo.value?.data as any)?.parsed?.info;
    expect(frozenData.state).to.equal("frozen");

    // Thaw the account
    const thawTx = await program.methods
      .thawAccount()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        mint: mintKeypair.publicKey,
        roleAssignment: null,
        targetAccount: recipientATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    console.log("  Thaw tx:", thawTx);

    const thawedInfo = await provider.connection.getParsedAccountInfo(recipientATA);
    const thawedData = (thawedInfo.value?.data as any)?.parsed?.info;
    expect(thawedData.state).to.equal("initialized");
  });

  it("pauses and unpauses", async () => {
    // Pause
    const pauseTx = await program.methods
      .pause()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: null,
      })
      .rpc();
    console.log("  Pause tx:", pauseTx);

    let stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.paused).to.be.true;

    // Verify minting fails while paused
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
      expect.fail("Should have thrown - stablecoin is paused");
    } catch (err: any) {
      expect(err.toString()).to.contain("Paused");
    }

    // Unpause
    const unpauseTx = await program.methods
      .unpause()
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
        roleAssignment: null,
      })
      .rpc();
    console.log("  Unpause tx:", unpauseTx);

    stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.paused).to.be.false;
  });

  it("transfers authority", async () => {
    const newAuthority = Keypair.generate();

    const tx = await program.methods
      .transferAuthority(newAuthority.publicKey)
      .accounts({
        authority: authority.publicKey,
        stablecoin: stablecoinPDA,
      })
      .rpc();

    console.log("  Transfer authority tx:", tx);

    const stablecoin = await program.account.stablecoin.fetch(stablecoinPDA);
    expect(stablecoin.authority.toBase58()).to.equal(newAuthority.publicKey.toBase58());
  });
});
