import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  deriveStablecoinPDA,
  SSS_TOKEN_PROGRAM_ID,
} from "../utils/pda";
import idl from "../idl/sss_token.json";

export interface StablecoinState {
  authority: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  paused: boolean;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  defaultAccountFrozen: boolean;
  enableAllowlist: boolean;
  totalMinted: BN;
  totalBurned: BN;
  supplyCap: BN;
  pendingAuthority: PublicKey;
  bump: number;
}

export function useStablecoin(mintAddress: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [state, setState] = useState<StablecoinState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stablecoinPDA, setStablecoinPDA] = useState<PublicKey | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [currentSupply, setCurrentSupply] = useState<string>("0");

  const getProvider = useCallback(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;
    return new AnchorProvider(
      connection,
      wallet as any,
      { commitment: "confirmed" }
    );
  }, [connection, wallet]);

  const getProgram = useCallback(() => {
    const provider = getProvider();
    if (!provider) return null;
    return new Program(idl as any, provider);
  }, [getProvider]);

  const fetchState = useCallback(async () => {
    if (!mintAddress) {
      setState(null);
      setStablecoinPDA(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const mint = new PublicKey(mintAddress);
      const [pda] = deriveStablecoinPDA(mint);
      setStablecoinPDA(pda);

      const prog = getProgram();
      if (prog) {
        setProgram(prog);
        const account = await (prog.account as any).stablecoin.fetch(pda);
        setState(account as StablecoinState);
      } else {
        // Read-only: fetch raw account data
        const accountInfo = await connection.getAccountInfo(pda);
        if (!accountInfo) {
          setError("Stablecoin account not found. Check the mint address.");
          return;
        }
        // Use a dummy provider for read-only
        const dummyProvider = {
          connection,
          publicKey: PublicKey.default,
        } as any;
        const prog2 = new Program(idl as any, dummyProvider);
        setProgram(prog2);
        const account = await (prog2.account as any).stablecoin.fetch(pda);
        setState(account as StablecoinState);
      }

      // Fetch current mint supply
      try {
        const mintInfo = await connection.getTokenSupply(mint);
        setCurrentSupply(mintInfo.value.amount);
      } catch {
        setCurrentSupply("0");
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch stablecoin state");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [mintAddress, connection, getProgram]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  return {
    state,
    loading,
    error,
    stablecoinPDA,
    program,
    currentSupply,
    refetch: fetchState,
  };
}
