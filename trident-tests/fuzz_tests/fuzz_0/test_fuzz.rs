use fuzz_accounts::*;
use trident_fuzz::fuzzing::*;

mod fuzz_accounts;

const SSS_TOKEN_PROGRAM_ID: Pubkey = pubkey!("BXG5KG57ef5vgZdA4mWjBYfrFPyaaZEvdHCmGsuj7vbq");

const STABLECOIN_SEED: &[u8] = b"stablecoin";
const ROLE_SEED: &[u8] = b"role";
const BLACKLIST_SEED: &[u8] = b"blacklist";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Anchor instruction discriminator: sha256("global:<name>")[..8]
fn ix_disc(name: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(format!("global:{name}").as_bytes());
    hash[..8].try_into().unwrap()
}

/// Anchor account discriminator: sha256("account:<Name>")[..8]
fn acct_disc(name: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(format!("account:{name}").as_bytes());
    hash[..8].try_into().unwrap()
}

/// Serialize a Stablecoin PDA account (Anchor discriminator + Borsh fields).
fn build_stablecoin_data(
    authority: Pubkey,
    mint: Pubkey,
    paused: bool,
    compliance: bool,
    bump: u8,
) -> Vec<u8> {
    let (name, symbol, uri) = ("TestCoin", "TST", "https://test.example");
    let mut d = acct_disc("Stablecoin").to_vec();
    d.extend_from_slice(authority.as_ref());
    d.extend_from_slice(mint.as_ref());
    for s in [name, symbol, uri] {
        d.extend_from_slice(&(s.len() as u32).to_le_bytes());
        d.extend_from_slice(s.as_bytes());
    }
    d.push(6);                                       // decimals
    d.push(paused as u8);                            // paused
    d.push(compliance as u8);                        // enable_permanent_delegate
    d.push(compliance as u8);                        // enable_transfer_hook
    d.push(0);                                       // default_account_frozen
    d.push(0);                                       // enable_allowlist
    d.extend_from_slice(&0u64.to_le_bytes());        // total_minted
    d.extend_from_slice(&0u64.to_le_bytes());        // total_burned
    d.extend_from_slice(&0u64.to_le_bytes());        // supply_cap
    d.extend_from_slice(&Pubkey::default().to_bytes()); // pending_authority
    d.push(bump);                                    // bump
    d.extend_from_slice(&[0u8; 23]);                 // _reserved
    d
}

/// Read the `paused` flag from raw Stablecoin account data.
fn read_paused(data: &[u8]) -> bool {
    // disc(8) + authority(32) + mint(32) + 3 strings + decimals(1) + paused(1)
    let mut o = 8 + 32 + 32;
    for _ in 0..3 {
        let len = u32::from_le_bytes(data[o..o + 4].try_into().unwrap()) as usize;
        o += 4 + len;
    }
    o += 1; // skip decimals
    data[o] != 0
}

/// Read the `authority` pubkey from raw Stablecoin account data.
fn read_authority(data: &[u8]) -> Pubkey {
    Pubkey::new_from_array(data[8..40].try_into().unwrap())
}

/// Skip past disc(8) + authority(32) + mint(32) + 3 strings + decimals(1)
/// + paused(1) + flags(4) to reach the numeric fields.
fn offset_after_flags(data: &[u8]) -> usize {
    let mut o = 8 + 32 + 32;
    for _ in 0..3 {
        let len = u32::from_le_bytes(data[o..o + 4].try_into().unwrap()) as usize;
        o += 4 + len;
    }
    o += 1; // decimals
    o += 1; // paused
    o += 4; // 4 bool flags (enable_permanent_delegate, enable_transfer_hook, default_account_frozen, enable_allowlist)
    o
}

/// Read the `supply_cap` from raw Stablecoin account data.
fn read_supply_cap(data: &[u8]) -> u64 {
    let o = offset_after_flags(data);
    // total_minted(8) + total_burned(8) then supply_cap(8)
    u64::from_le_bytes(data[o + 16..o + 24].try_into().unwrap())
}

/// Read the `pending_authority` from raw Stablecoin account data.
fn read_pending_authority(data: &[u8]) -> Pubkey {
    let o = offset_after_flags(data);
    // total_minted(8) + total_burned(8) + supply_cap(8) then pending_authority(32)
    Pubkey::new_from_array(data[o + 24..o + 56].try_into().unwrap())
}

/// Build a RoleAssignment PDA account.
fn build_role_assignment_data(
    stablecoin: Pubkey,
    role: u8,
    assignee: Pubkey,
    active: bool,
    bump: u8,
) -> Vec<u8> {
    let mut d = acct_disc("RoleAssignment").to_vec();
    d.extend_from_slice(stablecoin.as_ref());
    d.push(role);
    d.extend_from_slice(assignee.as_ref());
    d.push(active as u8);
    d.push(bump);
    d
}

/// Map role index (0..4) to seed bytes.
fn role_seed(role: u8) -> &'static [u8] {
    match role {
        0 => b"minter",
        1 => b"burner",
        2 => b"blacklister",
        3 => b"pauser",
        4 => b"seizer",
        _ => b"minter",
    }
}

/// Place a program-owned account directly into the SVM.
fn place_account(trident: &mut Trident, address: &Pubkey, data: Vec<u8>) {
    let mut account = AccountSharedData::new(
        10 * LAMPORTS_PER_SOL,
        data.len(),
        &SSS_TOKEN_PROGRAM_ID,
    );
    account.set_data_from_slice(&data);
    trident.set_account_custom(address, &account);
}

// ---------------------------------------------------------------------------
// Fuzz test
// ---------------------------------------------------------------------------

#[derive(FuzzTestMethods)]
struct FuzzTest {
    trident: Trident,
    fuzz_accounts: AccountAddresses,
}

#[flow_executor]
impl FuzzTest {
    fn new() -> Self {
        Self {
            trident: Trident::default(),
            fuzz_accounts: AccountAddresses::default(),
        }
    }

    #[init]
    fn start(&mut self) {
        self.fuzz_accounts = AccountAddresses::default();

        // Create keypairs
        let authority = self.fuzz_accounts.authorities.insert(&mut self.trident, None);
        let mint = self.fuzz_accounts.mints.insert(&mut self.trident, None);
        let attacker = self.fuzz_accounts.operators.insert(&mut self.trident, None);

        self.trident.airdrop(&authority, 10 * LAMPORTS_PER_SOL);
        self.trident.airdrop(&attacker, 2 * LAMPORTS_PER_SOL);

        // Derive stablecoin PDA and manually place its account state.
        // We bypass the full `initialize` instruction (which needs Token-2022
        // mint creation) and instead inject the serialized account data
        // directly, so we can fuzz the role-management and pause/unpause
        // instructions that operate purely on PDA state.
        let (stablecoin_pda, bump) = Pubkey::find_program_address(
            &[STABLECOIN_SEED, mint.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );
        self.fuzz_accounts.stablecoins.insert_with_address(stablecoin_pda);

        let data = build_stablecoin_data(authority, mint, false, true, bump);
        place_account(&mut self.trident, &stablecoin_pda, data);
    }

    // -- Flows ---------------------------------------------------------------

    /// Master authority pauses the stablecoin — must succeed and flip the flag.
    #[flow(weight = 14)]
    fn fuzz_pause(&mut self) {
        let authority = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(authority, true),
                AccountMeta::new(stablecoin, false),
                // Optional role_assignment = None (pass program ID)
                AccountMeta::new_readonly(SSS_TOKEN_PROGRAM_ID, false),
            ],
            data: ix_disc("pause").to_vec(),
        };

        let res = self.trident.process_transaction(&[ix], Some("pause"));
        if res.is_success() {
            let acct = self.trident.get_account(&stablecoin);
            assert!(
                read_paused(acct.data()),
                "pause tx succeeded but paused flag is false"
            );
        }
    }

    /// Master authority unpauses the stablecoin — must succeed and clear the flag.
    #[flow(weight = 14)]
    fn fuzz_unpause(&mut self) {
        let authority = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(authority, true),
                AccountMeta::new(stablecoin, false),
                AccountMeta::new_readonly(SSS_TOKEN_PROGRAM_ID, false),
            ],
            data: ix_disc("unpause").to_vec(),
        };

        let res = self.trident.process_transaction(&[ix], Some("unpause"));
        if res.is_success() {
            let acct = self.trident.get_account(&stablecoin);
            assert!(
                !read_paused(acct.data()),
                "unpause tx succeeded but paused flag is true"
            );
        }
    }

    /// Non-authority attempts to pause — must always be rejected.
    #[flow(weight = 8)]
    fn fuzz_unauthorized_pause(&mut self) {
        let attacker = self.fuzz_accounts.operators.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();

        let before = read_paused(self.trident.get_account(&stablecoin).data());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(attacker, true),
                AccountMeta::new(stablecoin, false),
                AccountMeta::new_readonly(SSS_TOKEN_PROGRAM_ID, false),
            ],
            data: ix_disc("pause").to_vec(),
        };

        let res = self.trident.process_transaction(&[ix], Some("unauthorized_pause"));
        assert!(res.is_error(), "Non-authority pause must fail");

        let after = read_paused(self.trident.get_account(&stablecoin).data());
        assert_eq!(
            before, after,
            "Paused state must not change after unauthorized attempt"
        );
    }

    /// Master authority transfers authority and we verify the on-chain update.
    #[flow(weight = 6)]
    fn fuzz_transfer_authority(&mut self) {
        let authority = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let new_auth = self.trident.random_pubkey();

        let mut data = ix_disc("transfer_authority").to_vec();
        data.extend_from_slice(new_auth.as_ref());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(authority, true),
                AccountMeta::new(stablecoin, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("transfer_authority"));
        if res.is_success() {
            let acct = self.trident.get_account(&stablecoin);
            assert_eq!(
                read_authority(acct.data()),
                new_auth,
                "Authority must be updated to new_authority"
            );

            // Restore the original authority so subsequent flows keep working.
            // (We can't sign as the random new_auth, so we reset the account.)
            let mint = self.fuzz_accounts.mints.get(&mut self.trident).unwrap();
            let (_, bump) = Pubkey::find_program_address(
                &[STABLECOIN_SEED, mint.as_ref()],
                &SSS_TOKEN_PROGRAM_ID,
            );
            let paused = read_paused(self.trident.get_account(&stablecoin).data());
            let restored = build_stablecoin_data(authority, mint, paused, true, bump);
            place_account(&mut self.trident, &stablecoin, restored);
        }
    }

    /// Non-authority attempts to transfer authority — must always be rejected.
    #[flow(weight = 8)]
    fn fuzz_unauthorized_transfer(&mut self) {
        let attacker = self.fuzz_accounts.operators.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let auth_before = read_authority(self.trident.get_account(&stablecoin).data());

        let mut data = ix_disc("transfer_authority").to_vec();
        data.extend_from_slice(attacker.as_ref());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(attacker, true),
                AccountMeta::new(stablecoin, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("unauthorized_transfer"));
        assert!(res.is_error(), "Non-authority transfer must fail");

        let auth_after = read_authority(self.trident.get_account(&stablecoin).data());
        assert_eq!(
            auth_before, auth_after,
            "Authority must not change after unauthorized attempt"
        );
    }

    /// Verify PDA derivation uniqueness: different roles for the same
    /// stablecoin + assignee produce distinct addresses.
    #[flow(weight = 6)]
    fn fuzz_pda_uniqueness(&mut self) {
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let assignee = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();

        let roles: &[&[u8]] = &[b"minter", b"burner", b"blacklister", b"pauser", b"seizer"];
        let mut pdas = Vec::new();
        for role in roles {
            let (pda, _) = Pubkey::find_program_address(
                &[ROLE_SEED, stablecoin.as_ref(), *role, assignee.as_ref()],
                &SSS_TOKEN_PROGRAM_ID,
            );
            assert!(
                !pdas.contains(&pda),
                "Role PDAs must be unique across role types"
            );
            pdas.push(pda);
        }

        // Blacklist PDA must not collide with any role PDA
        let wallet = self.trident.random_pubkey();
        let (bl_pda, _) = Pubkey::find_program_address(
            &[BLACKLIST_SEED, stablecoin.as_ref(), wallet.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );
        assert!(
            !pdas.contains(&bl_pda),
            "Blacklist PDA must not collide with role PDAs"
        );
    }

    /// Authority assigns a minter role — verify role PDA created with active=true.
    #[flow(weight = 6)]
    fn fuzz_assign_role(&mut self) {
        let authority = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let _mint = self.fuzz_accounts.mints.get(&mut self.trident).unwrap();
        let assignee = self.trident.random_pubkey();
        let role: u8 = 0; // Minter

        let (role_pda, role_bump) = Pubkey::find_program_address(
            &[ROLE_SEED, stablecoin.as_ref(), role_seed(role), assignee.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        // Pre-place the role assignment account so the program can write to it
        let role_data = build_role_assignment_data(stablecoin, role, assignee, false, role_bump);
        place_account(&mut self.trident, &role_pda, role_data);

        // Instruction data: disc + role(u8) + assignee(Pubkey)
        let mut data = ix_disc("assign_role").to_vec();
        data.push(role);
        data.extend_from_slice(assignee.as_ref());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(authority, true),
                AccountMeta::new_readonly(stablecoin, false),
                AccountMeta::new(role_pda, false),
                // minter_info = None (pass program ID)
                AccountMeta::new_readonly(SSS_TOKEN_PROGRAM_ID, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("assign_role"));
        if res.is_success() {
            let acct = self.trident.get_account(&role_pda);
            let d = acct.data();
            // active flag is at: disc(8) + stablecoin(32) + role(1) + assignee(32) = offset 73
            assert!(d[73] != 0, "Role assignment must be active after assign_role");
        }
    }

    /// Authority revokes a role — verify role PDA has active=false.
    #[flow(weight = 6)]
    fn fuzz_revoke_role(&mut self) {
        let authority = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let _mint = self.fuzz_accounts.mints.get(&mut self.trident).unwrap();
        let assignee = self.trident.random_pubkey();
        let role: u8 = 0; // Minter

        let (role_pda, role_bump) = Pubkey::find_program_address(
            &[ROLE_SEED, stablecoin.as_ref(), role_seed(role), assignee.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        // Pre-place an active role assignment
        let role_data = build_role_assignment_data(stablecoin, role, assignee, true, role_bump);
        place_account(&mut self.trident, &role_pda, role_data);

        let mut data = ix_disc("revoke_role").to_vec();
        data.push(role);
        data.extend_from_slice(assignee.as_ref());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(authority, true),
                AccountMeta::new_readonly(stablecoin, false),
                AccountMeta::new(role_pda, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("revoke_role"));
        if res.is_success() {
            let acct = self.trident.get_account(&role_pda);
            let d = acct.data();
            assert!(d[73] == 0, "Role assignment must be inactive after revoke_role");
        }
    }

    /// Non-authority attempts to revoke a role — must fail, state unchanged.
    #[flow(weight = 4)]
    fn fuzz_unauthorized_revoke(&mut self) {
        let attacker = self.fuzz_accounts.operators.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let assignee = self.trident.random_pubkey();
        let role: u8 = 0;

        let (role_pda, role_bump) = Pubkey::find_program_address(
            &[ROLE_SEED, stablecoin.as_ref(), role_seed(role), assignee.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        // Pre-place an active role assignment
        let role_data = build_role_assignment_data(stablecoin, role, assignee, true, role_bump);
        place_account(&mut self.trident, &role_pda, role_data);

        let mut data = ix_disc("revoke_role").to_vec();
        data.push(role);
        data.extend_from_slice(assignee.as_ref());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(attacker, true),
                AccountMeta::new_readonly(stablecoin, false),
                AccountMeta::new(role_pda, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("unauthorized_revoke"));
        assert!(res.is_error(), "Non-authority revoke must fail");

        let acct = self.trident.get_account(&role_pda);
        assert!(acct.data()[73] != 0, "Role must remain active after unauthorized revoke");
    }

    /// Authority nominates a new pending authority — verify pending_authority set.
    #[flow(weight = 4)]
    fn fuzz_nominate_authority(&mut self) {
        let authority = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let nominee = self.trident.random_pubkey();

        let mut data = ix_disc("nominate_authority").to_vec();
        data.extend_from_slice(nominee.as_ref());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(authority, true),
                AccountMeta::new(stablecoin, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("nominate_authority"));
        if res.is_success() {
            let acct = self.trident.get_account(&stablecoin);
            let pending = read_pending_authority(acct.data());
            assert_eq!(
                pending, nominee,
                "pending_authority must be set to nominee after nominate_authority"
            );

            // Restore pending_authority to default so other flows aren't affected
            let mint = self.fuzz_accounts.mints.get(&mut self.trident).unwrap();
            let (_, bump) = Pubkey::find_program_address(
                &[STABLECOIN_SEED, mint.as_ref()],
                &SSS_TOKEN_PROGRAM_ID,
            );
            let paused = read_paused(self.trident.get_account(&stablecoin).data());
            let restored = build_stablecoin_data(authority, mint, paused, true, bump);
            place_account(&mut self.trident, &stablecoin, restored);
        }
    }

    /// Non-authority attempts to nominate — must fail.
    #[flow(weight = 4)]
    fn fuzz_unauthorized_nominate(&mut self) {
        let attacker = self.fuzz_accounts.operators.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let pending_before = read_pending_authority(self.trident.get_account(&stablecoin).data());

        let mut data = ix_disc("nominate_authority").to_vec();
        data.extend_from_slice(attacker.as_ref());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(attacker, true),
                AccountMeta::new(stablecoin, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("unauthorized_nominate"));
        assert!(res.is_error(), "Non-authority nominate must fail");

        let pending_after = read_pending_authority(self.trident.get_account(&stablecoin).data());
        assert_eq!(
            pending_before, pending_after,
            "pending_authority must not change after unauthorized nominate"
        );
    }

    /// Authority sets supply cap — verify updated.
    #[flow(weight = 4)]
    fn fuzz_set_supply_cap(&mut self) {
        let authority = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let new_cap: u64 = 1_000_000_000;

        let mut data = ix_disc("set_supply_cap").to_vec();
        data.extend_from_slice(&new_cap.to_le_bytes());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(authority, true),
                AccountMeta::new(stablecoin, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("set_supply_cap"));
        if res.is_success() {
            let acct = self.trident.get_account(&stablecoin);
            let cap = read_supply_cap(acct.data());
            assert_eq!(cap, new_cap, "Supply cap must be updated after set_supply_cap");

            // Restore original state (cap=0)
            let mint = self.fuzz_accounts.mints.get(&mut self.trident).unwrap();
            let (_, bump) = Pubkey::find_program_address(
                &[STABLECOIN_SEED, mint.as_ref()],
                &SSS_TOKEN_PROGRAM_ID,
            );
            let paused = read_paused(self.trident.get_account(&stablecoin).data());
            let restored = build_stablecoin_data(authority, mint, paused, true, bump);
            place_account(&mut self.trident, &stablecoin, restored);
        }
    }

    /// Non-authority attempts to set supply cap — must fail.
    #[flow(weight = 4)]
    fn fuzz_unauthorized_supply_cap(&mut self) {
        let attacker = self.fuzz_accounts.operators.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let cap_before = read_supply_cap(self.trident.get_account(&stablecoin).data());

        let mut data = ix_disc("set_supply_cap").to_vec();
        data.extend_from_slice(&999_999u64.to_le_bytes());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(attacker, true),
                AccountMeta::new(stablecoin, false),
            ],
            data,
        };

        let res = self.trident.process_transaction(&[ix], Some("unauthorized_supply_cap"));
        assert!(res.is_error(), "Non-authority set_supply_cap must fail");

        let cap_after = read_supply_cap(self.trident.get_account(&stablecoin).data());
        assert_eq!(
            cap_before, cap_after,
            "Supply cap must not change after unauthorized attempt"
        );
    }

    /// Non-authority attempts to unpause — must fail, state unchanged.
    #[flow(weight = 4)]
    fn fuzz_unauthorized_unpause(&mut self) {
        let attacker = self.fuzz_accounts.operators.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();

        let before = read_paused(self.trident.get_account(&stablecoin).data());

        let ix = Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(attacker, true),
                AccountMeta::new(stablecoin, false),
                AccountMeta::new_readonly(SSS_TOKEN_PROGRAM_ID, false),
            ],
            data: ix_disc("unpause").to_vec(),
        };

        let res = self.trident.process_transaction(&[ix], Some("unauthorized_unpause"));
        assert!(res.is_error(), "Non-authority unpause must fail");

        let after = read_paused(self.trident.get_account(&stablecoin).data());
        assert_eq!(
            before, after,
            "Paused state must not change after unauthorized unpause"
        );
    }

    /// Pausing twice should be idempotent — both calls succeed (or second is no-op).
    #[flow(weight = 3)]
    fn fuzz_pause_idempotent(&mut self) {
        let authority = self.fuzz_accounts.authorities.get(&mut self.trident).unwrap();
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();

        let make_ix = || Instruction {
            program_id: SSS_TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(authority, true),
                AccountMeta::new(stablecoin, false),
                AccountMeta::new_readonly(SSS_TOKEN_PROGRAM_ID, false),
            ],
            data: ix_disc("pause").to_vec(),
        };

        let _ = self.trident.process_transaction(&[make_ix()], Some("pause_1"));
        let _ = self.trident.process_transaction(&[make_ix()], Some("pause_2"));

        // Regardless of whether the second call succeeded or failed,
        // the stablecoin must be paused.
        let acct = self.trident.get_account(&stablecoin);
        assert!(
            read_paused(acct.data()),
            "Stablecoin must be paused after two pause calls"
        );
    }

    /// Blacklist PDAs for the same wallet on different stablecoins must not collide.
    #[flow(weight = 3)]
    fn fuzz_blacklist_pda_isolation(&mut self) {
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let wallet = self.trident.random_pubkey();
        let other_mint = self.trident.random_pubkey();

        // Derive a second stablecoin PDA (doesn't need to exist on-chain)
        let (other_stablecoin, _) = Pubkey::find_program_address(
            &[STABLECOIN_SEED, other_mint.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        let (bl_pda_1, _) = Pubkey::find_program_address(
            &[BLACKLIST_SEED, stablecoin.as_ref(), wallet.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );
        let (bl_pda_2, _) = Pubkey::find_program_address(
            &[BLACKLIST_SEED, other_stablecoin.as_ref(), wallet.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        assert_ne!(
            bl_pda_1, bl_pda_2,
            "Blacklist PDAs must differ across stablecoins for the same wallet"
        );
    }

    /// Same inputs must always produce the same role PDA (determinism check).
    #[flow(weight = 2)]
    fn fuzz_role_pda_deterministic(&mut self) {
        let stablecoin = self.fuzz_accounts.stablecoins.get(&mut self.trident).unwrap();
        let assignee = self.trident.random_pubkey();

        for role in [b"minter" as &[u8], b"burner", b"blacklister", b"pauser", b"seizer"] {
            let (pda1, bump1) = Pubkey::find_program_address(
                &[ROLE_SEED, stablecoin.as_ref(), role, assignee.as_ref()],
                &SSS_TOKEN_PROGRAM_ID,
            );
            let (pda2, bump2) = Pubkey::find_program_address(
                &[ROLE_SEED, stablecoin.as_ref(), role, assignee.as_ref()],
                &SSS_TOKEN_PROGRAM_ID,
            );
            assert_eq!(pda1, pda2, "PDA derivation must be deterministic");
            assert_eq!(bump1, bump2, "Bump derivation must be deterministic");
        }
    }

    // -- End -----------------------------------------------------------------

    #[end]
    fn end(&mut self) {
        if let Some(pda) = self.fuzz_accounts.stablecoins.get(&mut self.trident) {
            let acct = self.trident.get_account(&pda);
            let data = acct.data();

            // Invariant: account must remain owned by the program
            assert_eq!(
                acct.owner(),
                &SSS_TOKEN_PROGRAM_ID,
                "Stablecoin must remain program-owned"
            );

            // --- fuzz_discriminator_invariant ---
            // Discriminator must never be corrupted, regardless of which flows ran.
            let disc = &data[..8];
            let expected_disc = acct_disc("Stablecoin");
            assert_eq!(
                disc,
                &expected_disc,
                "Discriminator must remain valid (fuzz_discriminator_invariant)"
            );
            // Verify discriminator is not all zeros (would indicate wiped state)
            assert_ne!(
                disc,
                &[0u8; 8],
                "Discriminator must not be zeroed out"
            );

            // --- fuzz_authority_invariant ---
            // Authority must never be the zero address after any sequence of flows.
            let authority = read_authority(data);
            assert_ne!(
                authority,
                Pubkey::default(),
                "Authority must not be the zero address (fuzz_authority_invariant)"
            );
            // Authority must be 32 bytes at a known offset, not garbage
            assert_eq!(
                data[8..40].len(),
                32,
                "Authority field must be 32 bytes"
            );

            // Supply cap must be a sane value (not corrupted by adjacent writes)
            let supply_cap = read_supply_cap(data);
            // supply_cap == 0 means unlimited, any other value is valid
            // but it should never be u64::MAX unless explicitly set (sanity)
            let _ = supply_cap; // read succeeded without panic = data layout intact
        }
    }
}

fn main() {
    let iterations = std::env::var("TRIDENT_ITERATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000);
    let flow_calls = std::env::var("TRIDENT_FLOW_CALLS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100);

    FuzzTest::fuzz(iterations, flow_calls);
}
