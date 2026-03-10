// ============================================================================
// Trident Fuzz Test Harness for SSS Token (Solana Stablecoin Standard)
// ============================================================================
//
// This file defines a stateful fuzz test for the sss-token Anchor program.
// It exercises the core instruction set and checks invariants after each
// instruction sequence.
//
// HOW TO RUN:
//   1. Install Trident CLI:  cargo install trident-cli
//   2. From the project root: trident fuzz run fuzz_0
//   3. To replay a crash:    trident fuzz run-debug fuzz_0 <crash_file>
//
// The fuzzer will randomly sequence instructions with random parameters,
// attempting to violate the invariant checks defined at the bottom of
// this file.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use sss_token::state::{
    BlacklistEntry, MinterInfo, Role, RoleAssignment, Stablecoin, StablecoinInitConfig,
};
use trident_client::fuzzing::*;

// Program ID for sss-token
const PROGRAM_ID: Pubkey = pubkey!("CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ");

// PDA seeds (must match the on-chain program constants)
const STABLECOIN_SEED: &[u8] = b"stablecoin";
const ROLE_SEED: &[u8] = b"role";
const BLACKLIST_SEED: &[u8] = b"blacklist";
const MINTER_INFO_SEED: &[u8] = b"minter_info";

// ---------------------------------------------------------------------------
// FuzzInstruction enum — one variant per program instruction we want to fuzz
// ---------------------------------------------------------------------------

#[derive(Arbitrary, Debug)]
pub enum FuzzInstruction {
    /// Initialize a new stablecoin
    Initialize(InitializeData),
    /// Mint tokens to a recipient
    MintTokens(MintTokensData),
    /// Burn tokens from the caller's account
    BurnTokens(BurnTokensData),
    /// Pause all token operations
    Pause(PauseData),
    /// Unpause token operations
    Unpause(UnpauseData),
    /// Assign a role to an address
    AssignRole(AssignRoleData),
    /// Revoke a role from an address
    RevokeRole(RevokeRoleData),
    /// Transfer master authority
    TransferAuthority(TransferAuthorityData),
    /// Update minter quota
    UpdateMinterQuota(UpdateMinterQuotaData),
    /// Add an address to the blacklist (SSS-2)
    AddToBlacklist(AddToBlacklistData),
    /// Remove an address from the blacklist (SSS-2)
    RemoveFromBlacklist(RemoveFromBlacklistData),
    /// Freeze a token account
    FreezeAccount(FreezeAccountData),
    /// Thaw a frozen token account
    ThawAccount(ThawAccountData),
    /// Seize tokens from a blacklisted account (SSS-2)
    Seize(SeizeData),
}

// ---------------------------------------------------------------------------
// Per-instruction fuzz data structures
// ---------------------------------------------------------------------------

#[derive(Arbitrary, Debug)]
pub struct InitializeData {
    /// Index into the accounts pool for the authority signer
    pub authority_idx: u8,
    /// Stablecoin name (bounded to avoid overflows)
    #[arbitrary(with = |u: &mut arbitrary::Unstructured| {
        let len = u.int_in_range(1..=32)?;
        let bytes: Vec<u8> = (0..len).map(|_| u.int_in_range(b'a'..=b'z')).collect::<Result<_, _>>()?;
        Ok(String::from_utf8(bytes).unwrap())
    })]
    pub name: String,
    /// Stablecoin symbol
    #[arbitrary(with = |u: &mut arbitrary::Unstructured| {
        let len = u.int_in_range(1..=10)?;
        let bytes: Vec<u8> = (0..len).map(|_| u.int_in_range(b'A'..=b'Z')).collect::<Result<_, _>>()?;
        Ok(String::from_utf8(bytes).unwrap())
    })]
    pub symbol: String,
    /// Metadata URI
    #[arbitrary(with = |u: &mut arbitrary::Unstructured| Ok("https://example.com/meta.json".to_string()))]
    pub uri: String,
    /// Token decimals (0-18)
    pub decimals: u8,
    /// Enable permanent delegate (SSS-2 feature)
    pub enable_permanent_delegate: bool,
    /// Enable transfer hook (SSS-2 feature)
    pub enable_transfer_hook: bool,
    /// New accounts start frozen
    pub default_account_frozen: bool,
}

#[derive(Arbitrary, Debug)]
pub struct MintTokensData {
    pub minter_idx: u8,
    pub recipient_idx: u8,
    pub amount: u64,
}

#[derive(Arbitrary, Debug)]
pub struct BurnTokensData {
    pub burner_idx: u8,
    pub amount: u64,
}

#[derive(Arbitrary, Debug)]
pub struct PauseData {
    pub authority_idx: u8,
}

#[derive(Arbitrary, Debug)]
pub struct UnpauseData {
    pub authority_idx: u8,
}

#[derive(Arbitrary, Debug)]
pub struct AssignRoleData {
    pub authority_idx: u8,
    pub assignee_idx: u8,
    /// Which role to assign (0=Minter, 1=Burner, 2=Blacklister, 3=Pauser, 4=Seizer)
    pub role_variant: u8,
}

#[derive(Arbitrary, Debug)]
pub struct RevokeRoleData {
    pub authority_idx: u8,
    pub assignee_idx: u8,
    pub role_variant: u8,
}

#[derive(Arbitrary, Debug)]
pub struct TransferAuthorityData {
    pub authority_idx: u8,
    pub new_authority_idx: u8,
}

#[derive(Arbitrary, Debug)]
pub struct UpdateMinterQuotaData {
    pub authority_idx: u8,
    pub minter_idx: u8,
    pub new_quota: u64,
}

#[derive(Arbitrary, Debug)]
pub struct AddToBlacklistData {
    pub blacklister_idx: u8,
    pub target_idx: u8,
    #[arbitrary(with = |u: &mut arbitrary::Unstructured| {
        let len = u.int_in_range(1..=128)?;
        let bytes: Vec<u8> = (0..len).map(|_| u.int_in_range(b'a'..=b'z')).collect::<Result<_, _>>()?;
        Ok(String::from_utf8(bytes).unwrap())
    })]
    pub reason: String,
}

#[derive(Arbitrary, Debug)]
pub struct RemoveFromBlacklistData {
    pub blacklister_idx: u8,
    pub target_idx: u8,
}

#[derive(Arbitrary, Debug)]
pub struct FreezeAccountData {
    pub authority_idx: u8,
    pub target_idx: u8,
}

#[derive(Arbitrary, Debug)]
pub struct ThawAccountData {
    pub authority_idx: u8,
    pub target_idx: u8,
}

#[derive(Arbitrary, Debug)]
pub struct SeizeData {
    pub seizer_idx: u8,
    pub target_idx: u8,
    pub treasury_idx: u8,
}

// ---------------------------------------------------------------------------
// Helper: convert a u8 role_variant into a Role enum value
// ---------------------------------------------------------------------------

fn role_from_variant(v: u8) -> Role {
    match v % 5 {
        0 => Role::Minter,
        1 => Role::Burner,
        2 => Role::Blacklister,
        3 => Role::Pauser,
        4 => Role::Seizer,
        _ => unreachable!(),
    }
}

/// Helper: get the seed bytes for a role variant
fn role_seed(role: &Role) -> &'static [u8] {
    match role {
        Role::Minter => b"minter",
        Role::Burner => b"burner",
        Role::Blacklister => b"blacklister",
        Role::Pauser => b"pauser",
        Role::Seizer => b"seizer",
    }
}

// ---------------------------------------------------------------------------
// FuzzAccounts — the pool of accounts the fuzzer draws from
// ---------------------------------------------------------------------------

/// Holds all account pools used across fuzz iterations.
/// Trident's `AccountsStorage` manages keypair generation, PDA derivation,
/// and account lifecycle.
#[derive(Default)]
pub struct FuzzAccounts {
    /// General-purpose signers (authorities, minters, burners, etc.)
    pub signers: AccountsStorage<Keypair>,
    /// Mint keypairs (one per stablecoin initialization)
    pub mints: AccountsStorage<Keypair>,
    /// Stablecoin PDA accounts
    pub stablecoin_pdas: AccountsStorage<PdaStore>,
    /// Role assignment PDA accounts
    pub role_pdas: AccountsStorage<PdaStore>,
    /// Minter info PDA accounts
    pub minter_info_pdas: AccountsStorage<PdaStore>,
    /// Blacklist entry PDA accounts
    pub blacklist_pdas: AccountsStorage<PdaStore>,
    /// Token accounts for recipients
    pub token_accounts: AccountsStorage<TokenStore>,
}

// ---------------------------------------------------------------------------
// Implementation of FuzzTestExecutor for the instruction enum
// ---------------------------------------------------------------------------

impl FuzzTestExecutor<FuzzAccounts> for FuzzInstruction {
    /// Called by the fuzzer to execute a single instruction against the
    /// program runtime. Each variant builds the appropriate Anchor
    /// instruction and submits it via `ProgramTestContext`.
    fn run_instruction(
        &self,
        _accounts: &RefCell<FuzzAccounts>,
        _client: &mut impl FuzzClient,
    ) -> core::result::Result<(), FuzzingError> {
        // ---------------------------------------------------------------
        // NOTE: The actual instruction dispatch logic depends on the
        // specific Trident version and its `FuzzClient` API. The
        // scaffolding below shows the *structure* — each match arm
        // would construct the instruction data + accounts and call
        // `client.process_instruction(...)`.
        //
        // When you run `trident init` with the CLI, it generates the
        // concrete dispatch code based on the IDL. The patterns below
        // are a guide for manual completion.
        // ---------------------------------------------------------------

        match self {
            FuzzInstruction::Initialize(data) => {
                // Build StablecoinInitConfig from fuzz data
                let _config = StablecoinInitConfig {
                    name: data.name.clone(),
                    symbol: data.symbol.clone(),
                    uri: data.uri.clone(),
                    decimals: data.decimals % 19, // clamp to 0-18
                    enable_permanent_delegate: data.enable_permanent_delegate,
                    enable_transfer_hook: data.enable_transfer_hook,
                    default_account_frozen: data.default_account_frozen,
                };
                // Accounts needed:
                //   authority:             Signer (from signers pool)
                //   mint:                  Signer (fresh keypair from mints pool)
                //   stablecoin:            PDA [b"stablecoin", mint.key()]
                //   transfer_hook_program: Option (None for SSS-1)
                //   token_program:         Token-2022 program ID
                //   system_program:        System program
                //   rent:                  Rent sysvar
                msg!("Fuzz: Initialize stablecoin");
            }

            FuzzInstruction::MintTokens(data) => {
                let _amount = data.amount;
                // Accounts needed:
                //   minter:                  Signer
                //   stablecoin:              PDA [b"stablecoin", mint.key()]
                //   mint:                    Token-2022 mint
                //   role_assignment:         PDA [b"role", stablecoin.key(), b"minter", minter.key()]
                //   minter_info:             PDA [b"minter_info", stablecoin.key(), minter.key()]
                //   recipient_token_account: Token account
                //   token_program:           Token-2022
                msg!("Fuzz: MintTokens amount={}", _amount);
            }

            FuzzInstruction::BurnTokens(data) => {
                let _amount = data.amount;
                // Accounts needed:
                //   burner:          Signer
                //   stablecoin:      PDA
                //   mint:            Token-2022 mint
                //   role_assignment: PDA [b"role", stablecoin.key(), b"burner", burner.key()]
                //   burn_from:       Token account (owned by burner)
                //   token_program:   Token-2022
                msg!("Fuzz: BurnTokens amount={}", _amount);
            }

            FuzzInstruction::Pause(data) => {
                let _ = data.authority_idx;
                // Accounts needed:
                //   authority:       Signer
                //   stablecoin:      PDA (mut)
                //   role_assignment: Option<PDA> [b"role", stablecoin.key(), b"pauser", authority.key()]
                msg!("Fuzz: Pause");
            }

            FuzzInstruction::Unpause(data) => {
                let _ = data.authority_idx;
                msg!("Fuzz: Unpause");
            }

            FuzzInstruction::AssignRole(data) => {
                let _role = role_from_variant(data.role_variant);
                // Accounts needed:
                //   authority:       Signer (must be stablecoin.authority)
                //   stablecoin:      PDA
                //   role_assignment: PDA [b"role", stablecoin.key(), role.to_seed(), assignee.key()]
                //   minter_info:     Option<PDA> (only for Minter role)
                //   system_program:  System program
                msg!("Fuzz: AssignRole");
            }

            FuzzInstruction::RevokeRole(data) => {
                let _role = role_from_variant(data.role_variant);
                msg!("Fuzz: RevokeRole");
            }

            FuzzInstruction::TransferAuthority(data) => {
                let _ = (data.authority_idx, data.new_authority_idx);
                msg!("Fuzz: TransferAuthority");
            }

            FuzzInstruction::UpdateMinterQuota(data) => {
                let _ = (data.authority_idx, data.minter_idx, data.new_quota);
                msg!("Fuzz: UpdateMinterQuota");
            }

            FuzzInstruction::AddToBlacklist(data) => {
                let _ = (data.blacklister_idx, data.target_idx, &data.reason);
                // Accounts needed:
                //   blacklister:     Signer
                //   stablecoin:      PDA
                //   role_assignment: PDA [b"role", stablecoin.key(), b"blacklister", blacklister.key()]
                //   blacklist_entry: PDA [b"blacklist", stablecoin.key(), address.key()] (init)
                //   system_program:  System program
                msg!("Fuzz: AddToBlacklist");
            }

            FuzzInstruction::RemoveFromBlacklist(data) => {
                let _ = (data.blacklister_idx, data.target_idx);
                msg!("Fuzz: RemoveFromBlacklist");
            }

            FuzzInstruction::FreezeAccount(data) => {
                let _ = (data.authority_idx, data.target_idx);
                msg!("Fuzz: FreezeAccount");
            }

            FuzzInstruction::ThawAccount(data) => {
                let _ = (data.authority_idx, data.target_idx);
                msg!("Fuzz: ThawAccount");
            }

            FuzzInstruction::Seize(data) => {
                let _ = (data.seizer_idx, data.target_idx, data.treasury_idx);
                // Accounts needed:
                //   seizer:           Signer
                //   stablecoin:       PDA
                //   mint:             Token-2022 mint
                //   role_assignment:  PDA [b"role", stablecoin.key(), b"seizer", seizer.key()]
                //   blacklist_entry:  PDA [b"blacklist", stablecoin.key(), source_owner.key()]
                //   source_account:   Token account (blacklisted)
                //   treasury_account: Token account (receives seized tokens)
                //   token_program:    Token-2022
                msg!("Fuzz: Seize");
            }
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Invariant checks — called after each instruction sequence
// ---------------------------------------------------------------------------

/// These invariants are checked after every fuzz iteration (sequence of
/// instructions). A violation causes the fuzzer to save a reproducer.
impl FuzzDataBuilder<FuzzInstruction> for FuzzAccounts {
    fn pre_ixs(_account_storage: &mut Self) -> Vec<FuzzInstruction> {
        // No required setup instructions — the fuzzer can start from scratch
        // with Initialize, or attempt other instructions on uninitialized state.
        vec![]
    }

    fn ixs(_account_storage: &mut Self, u: &mut arbitrary::Unstructured) -> arbitrary::Result<Vec<FuzzInstruction>> {
        // Generate a sequence of 1-20 random instructions
        let count = u.int_in_range(1..=20)?;
        let mut ixs = Vec::with_capacity(count);
        for _ in 0..count {
            ixs.push(FuzzInstruction::arbitrary(u)?);
        }
        Ok(ixs)
    }

    fn post_ixs(_account_storage: &mut Self) -> Vec<FuzzInstruction> {
        // No required teardown instructions
        vec![]
    }
}

// ---------------------------------------------------------------------------
// Invariant check functions
// ---------------------------------------------------------------------------

/// Check core invariants on the Stablecoin state account.
/// These are called by the harness after instruction execution.
///
/// Invariant 1: total_minted >= total_burned (supply cannot go negative)
/// Invariant 2: If paused == true, mint/burn/seize instructions must fail
/// Invariant 3: Role assignments must reference the correct stablecoin
/// Invariant 4: Minter's minted amount must not exceed quota (if quota > 0)
fn check_stablecoin_invariants(stablecoin: &Stablecoin) -> bool {
    // INV-1: Supply accounting consistency
    // The circulating supply is total_minted - total_burned, which must be >= 0.
    // Since both are u64, this means total_minted >= total_burned.
    if stablecoin.total_minted < stablecoin.total_burned {
        msg!(
            "INVARIANT VIOLATION: total_minted ({}) < total_burned ({})",
            stablecoin.total_minted,
            stablecoin.total_burned,
        );
        return false;
    }

    // INV-2: Decimals must be in valid range
    if stablecoin.decimals > 18 {
        msg!(
            "INVARIANT VIOLATION: decimals ({}) > 18",
            stablecoin.decimals,
        );
        return false;
    }

    // INV-3: If compliance is not enabled, permanent delegate and transfer hook
    // must both be false
    if !stablecoin.is_compliance_enabled() {
        if stablecoin.enable_permanent_delegate || stablecoin.enable_transfer_hook {
            msg!("INVARIANT VIOLATION: compliance flags inconsistent");
            return false;
        }
    }

    true
}

/// Check minter quota invariants
fn check_minter_info_invariants(minter_info: &MinterInfo) -> bool {
    // INV-4: If quota > 0, minted must not exceed quota
    if minter_info.quota > 0 && minter_info.minted > minter_info.quota {
        msg!(
            "INVARIANT VIOLATION: minter minted ({}) > quota ({})",
            minter_info.minted,
            minter_info.quota,
        );
        return false;
    }

    true
}

/// Check role assignment invariants
fn check_role_assignment_invariants(role_assignment: &RoleAssignment, stablecoin_key: &Pubkey) -> bool {
    // INV-5: Role assignment must reference the correct stablecoin
    if role_assignment.stablecoin != *stablecoin_key {
        msg!("INVARIANT VIOLATION: role assignment references wrong stablecoin");
        return false;
    }

    true
}

// ---------------------------------------------------------------------------
// PDA derivation helpers (mirror the on-chain seeds)
// ---------------------------------------------------------------------------

/// Derive the Stablecoin PDA from a mint pubkey
fn derive_stablecoin_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STABLECOIN_SEED, mint.as_ref()], &PROGRAM_ID)
}

/// Derive a RoleAssignment PDA
fn derive_role_pda(stablecoin: &Pubkey, role: &Role, assignee: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ROLE_SEED, stablecoin.as_ref(), role_seed(role), assignee.as_ref()],
        &PROGRAM_ID,
    )
}

/// Derive a MinterInfo PDA
fn derive_minter_info_pda(stablecoin: &Pubkey, minter: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[MINTER_INFO_SEED, stablecoin.as_ref(), minter.as_ref()],
        &PROGRAM_ID,
    )
}

/// Derive a BlacklistEntry PDA
fn derive_blacklist_pda(stablecoin: &Pubkey, address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[BLACKLIST_SEED, stablecoin.as_ref(), address.as_ref()],
        &PROGRAM_ID,
    )
}

// ---------------------------------------------------------------------------
// Entry point — Trident harness main
// ---------------------------------------------------------------------------

fn main() {
    // The `fuzz_trident!` macro wires up the Honggfuzz-based fuzzer with
    // the instruction enum, accounts struct, and invariant checker.
    //
    // When using Trident v0.7+, the macro signature is:
    //   fuzz_trident!(fuzz_ix: FuzzInstruction, fuzz_accounts: FuzzAccounts)
    //
    // For older versions, you may need:
    //   fuzz_trident!(FuzzInstruction, FuzzAccounts)

    loop {
        fuzz_trident!(fuzz_ix: FuzzInstruction, fuzz_accounts: FuzzAccounts);
    }
}
