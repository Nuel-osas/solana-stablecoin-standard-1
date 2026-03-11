use fuzz_accounts::*;
use trident_fuzz::fuzzing::*;

mod fuzz_accounts;

const SSS_TOKEN_PROGRAM_ID: Pubkey = pubkey!("CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ");

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
    d.extend_from_slice(&0u64.to_le_bytes());        // total_minted
    d.extend_from_slice(&0u64.to_le_bytes());        // total_burned
    d.extend_from_slice(&0u64.to_le_bytes());        // supply_cap
    d.extend_from_slice(&Pubkey::default().to_bytes()); // pending_authority
    d.push(bump);                                    // bump
    d.extend_from_slice(&[0u8; 24]);                 // _reserved
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
    #[flow(weight = 25)]
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
    #[flow(weight = 25)]
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
    #[flow(weight = 15)]
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
    #[flow(weight = 10)]
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
    #[flow(weight = 15)]
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
    #[flow(weight = 10)]
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

    // -- End -----------------------------------------------------------------

    #[end]
    fn end(&mut self) {
        if let Some(pda) = self.fuzz_accounts.stablecoins.get(&mut self.trident) {
            let acct = self.trident.get_account(&pda);
            let data = acct.data();

            // Account must remain owned by the program
            assert_eq!(
                acct.owner(),
                &SSS_TOKEN_PROGRAM_ID,
                "Stablecoin must remain program-owned"
            );

            // Discriminator must be intact
            assert_eq!(
                &data[..8],
                &acct_disc("Stablecoin"),
                "Discriminator must remain valid"
            );

            // Authority must not be the zero address
            assert_ne!(
                read_authority(data),
                Pubkey::default(),
                "Authority must not be the zero address"
            );
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
