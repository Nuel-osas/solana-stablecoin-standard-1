use anchor_lang::prelude::*;
use anchor_lang::system_program;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_token_2022::state::Account as TokenAccount;
use spl_token_2022::extension::StateWithExtensions;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("63pY5GPBHKJ3gu99xTNH9yxUKgp8kUowiiHYzZtaE31E");

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "SSS Transfer Hook — Solana Stablecoin Standard",
    project_url: "https://github.com/Nuel-osas/solana-stablecoin-standard",
    contacts: "link:https://github.com/Nuel-osas/solana-stablecoin-standard/issues",
    policy: "https://github.com/Nuel-osas/solana-stablecoin-standard/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/Nuel-osas/solana-stablecoin-standard",
    auditors: "None"
}

/// The sss-token program ID — blacklist/allowlist PDAs are owned by this program.
const SSS_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ");

/// Seeds used by the main sss-token program
const STABLECOIN_SEED: &[u8] = b"stablecoin";
const BLACKLIST_SEED: &[u8] = b"blacklist";
const ALLOWLIST_SEED: &[u8] = b"allowlist";

/// Read the `enable_allowlist` flag from raw Stablecoin account data.
/// Layout: disc(8) + authority(32) + mint(32) + 3 Borsh strings + 5 bools + enable_allowlist(1)
fn read_enable_allowlist(data: &[u8]) -> bool {
    let mut offset = 8 + 32 + 32; // discriminator + authority + mint
    // Skip 3 Borsh strings (4-byte length prefix + content)
    for _ in 0..3 {
        if offset + 4 > data.len() {
            return false;
        }
        let len = u32::from_le_bytes(
            data[offset..offset + 4].try_into().unwrap_or([0; 4]),
        ) as usize;
        offset += 4 + len;
    }
    // Skip: decimals(1) + paused(1) + enable_permanent_delegate(1) +
    //        enable_transfer_hook(1) + default_account_frozen(1)
    offset += 5;
    if offset >= data.len() {
        return false;
    }
    data[offset] != 0
}

/// Read the `active` flag from a BlacklistEntry account.
/// Layout: disc(8) + stablecoin(32) + address(32) + reason(4+var) + blacklisted_at(8) +
///         blacklisted_by(32) + active(1) + bump(1)
fn read_blacklist_active(data: &[u8]) -> bool {
    let mut offset = 8 + 32 + 32; // discriminator + stablecoin + address
    // Skip Borsh string (reason)
    if offset + 4 > data.len() {
        return false;
    }
    let len = u32::from_le_bytes(
        data[offset..offset + 4].try_into().unwrap_or([0; 4]),
    ) as usize;
    offset += 4 + len;
    // Skip blacklisted_at(8) + blacklisted_by(32)
    offset += 8 + 32;
    if offset >= data.len() {
        return false;
    }
    data[offset] != 0
}

#[program]
pub mod sss_transfer_hook {
    use super::*;

    /// Called by Token-2022 on every transfer.
    /// Enforces blacklist (SSS-2) and allowlist (SSS-3) checks.
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        let source_data = ctx.accounts.source_account.try_borrow_data()?;
        let source_account = StateWithExtensions::<TokenAccount>::unpack(&source_data)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        let source_owner = source_account.base.owner;

        let dest_data = ctx.accounts.destination_account.try_borrow_data()?;
        let dest_account = StateWithExtensions::<TokenAccount>::unpack(&dest_data)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        let dest_owner = dest_account.base.owner;
        let stablecoin_key = ctx.accounts.stablecoin.key();

        // ── Blacklist checks (SSS-2) ──

        let (source_blacklist_pda, _) = Pubkey::find_program_address(
            &[BLACKLIST_SEED, stablecoin_key.as_ref(), source_owner.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        if let Some(source_bl) = &ctx.accounts.source_blacklist {
            if source_bl.key() == source_blacklist_pda
                && source_bl.data_len() > 0
                && source_bl.owner == &SSS_TOKEN_PROGRAM_ID
                && read_blacklist_active(&source_bl.try_borrow_data()?)
            {
                return Err(error!(TransferHookError::SenderBlacklisted));
            }
        }

        let (dest_blacklist_pda, _) = Pubkey::find_program_address(
            &[BLACKLIST_SEED, stablecoin_key.as_ref(), dest_owner.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        if let Some(dest_bl) = &ctx.accounts.destination_blacklist {
            if dest_bl.key() == dest_blacklist_pda
                && dest_bl.data_len() > 0
                && dest_bl.owner == &SSS_TOKEN_PROGRAM_ID
                && read_blacklist_active(&dest_bl.try_borrow_data()?)
            {
                return Err(error!(TransferHookError::RecipientBlacklisted));
            }
        }

        // ── Allowlist checks (SSS-3) ──

        let stablecoin_data = ctx.accounts.stablecoin.try_borrow_data()?;
        let allowlist_enabled = read_enable_allowlist(&stablecoin_data);
        drop(stablecoin_data);

        if allowlist_enabled {
            // Source must be on the allowlist
            let (source_allowlist_pda, _) = Pubkey::find_program_address(
                &[ALLOWLIST_SEED, stablecoin_key.as_ref(), source_owner.as_ref()],
                &SSS_TOKEN_PROGRAM_ID,
            );

            let source_allowed = ctx.accounts.source_allowlist.as_ref()
                .map(|al| {
                    al.key() == source_allowlist_pda
                        && al.data_len() > 0
                        && al.owner == &SSS_TOKEN_PROGRAM_ID
                })
                .unwrap_or(false);

            if !source_allowed {
                return Err(error!(TransferHookError::SenderNotAllowlisted));
            }

            // Destination must be on the allowlist
            let (dest_allowlist_pda, _) = Pubkey::find_program_address(
                &[ALLOWLIST_SEED, stablecoin_key.as_ref(), dest_owner.as_ref()],
                &SSS_TOKEN_PROGRAM_ID,
            );

            let dest_allowed = ctx.accounts.destination_allowlist.as_ref()
                .map(|al| {
                    al.key() == dest_allowlist_pda
                        && al.data_len() > 0
                        && al.owner == &SSS_TOKEN_PROGRAM_ID
                })
                .unwrap_or(false);

            if !dest_allowed {
                return Err(error!(TransferHookError::RecipientNotAllowlisted));
            }
        }

        msg!("Transfer hook: transfer of {} tokens approved", amount);
        Ok(())
    }

    /// Required by the transfer hook interface — returns extra account metas
    /// needed for the execute instruction.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        // Account indices in the combined list (4 fixed + extras):
        //   0 = source token account
        //   1 = mint
        //   2 = destination token account
        //   3 = authority (source owner)
        //   4 = extra[0]: sss-token program ID (needed as program for PDA derivation)
        //   5 = extra[1]: stablecoin config PDA
        //   6 = extra[2]: source blacklist PDA
        //   7 = extra[3]: destination blacklist PDA
        //   8 = extra[4]: source allowlist PDA
        //   9 = extra[5]: destination allowlist PDA
        let extra_account_metas = &[
            // extra[0]: sss-token program ID as a fixed pubkey account
            ExtraAccountMeta::new_with_pubkey(&SSS_TOKEN_PROGRAM_ID, false, false)
                .map_err(|_| ProgramError::InvalidArgument)?,
            // extra[1]: stablecoin config PDA
            ExtraAccountMeta::new_external_pda_with_seeds(
                4,
                &[
                    Seed::Literal {
                        bytes: STABLECOIN_SEED.to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint
                ],
                false,
                false,
            )
            .map_err(|_| ProgramError::InvalidArgument)?,
            // extra[2]: source blacklist PDA
            ExtraAccountMeta::new_external_pda_with_seeds(
                4,
                &[
                    Seed::Literal {
                        bytes: BLACKLIST_SEED.to_vec(),
                    },
                    Seed::AccountKey { index: 5 }, // stablecoin (abs index 5)
                    Seed::AccountData { account_index: 0, data_index: 32, length: 32 },
                ],
                false,
                false,
            )
            .map_err(|_| ProgramError::InvalidArgument)?,
            // extra[3]: destination blacklist PDA
            ExtraAccountMeta::new_external_pda_with_seeds(
                4,
                &[
                    Seed::Literal {
                        bytes: BLACKLIST_SEED.to_vec(),
                    },
                    Seed::AccountKey { index: 5 },
                    Seed::AccountData { account_index: 2, data_index: 32, length: 32 },
                ],
                false,
                false,
            )
            .map_err(|_| ProgramError::InvalidArgument)?,
            // extra[4]: source allowlist PDA (SSS-3)
            ExtraAccountMeta::new_external_pda_with_seeds(
                4,
                &[
                    Seed::Literal {
                        bytes: ALLOWLIST_SEED.to_vec(),
                    },
                    Seed::AccountKey { index: 5 },
                    Seed::AccountData { account_index: 0, data_index: 32, length: 32 },
                ],
                false,
                false,
            )
            .map_err(|_| ProgramError::InvalidArgument)?,
            // extra[5]: destination allowlist PDA (SSS-3)
            ExtraAccountMeta::new_external_pda_with_seeds(
                4,
                &[
                    Seed::Literal {
                        bytes: ALLOWLIST_SEED.to_vec(),
                    },
                    Seed::AccountKey { index: 5 },
                    Seed::AccountData { account_index: 2, data_index: 32, length: 32 },
                ],
                false,
                false,
            )
            .map_err(|_| ProgramError::InvalidArgument)?,
        ];

        let account_size = ExtraAccountMetaList::size_of(extra_account_metas.len())?;
        let lamports = Rent::get()?.minimum_balance(account_size);

        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[u8]] = &[b"extra-account-metas", mint_key.as_ref()];
        let (_, bump) = Pubkey::find_program_address(signer_seeds, &crate::id());
        let signer_seeds_with_bump: &[&[u8]] =
            &[b"extra-account-metas", mint_key.as_ref(), &[bump]];

        system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
                &[signer_seeds_with_bump],
            ),
            lamports,
            account_size as u64,
            &crate::id(),
        )?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            extra_account_metas,
        )?;

        msg!("Extra account meta list initialized with blacklist + allowlist PDAs");
        Ok(())
    }
}

#[error_code]
pub enum TransferHookError {
    #[msg("Sender is blacklisted")]
    SenderBlacklisted,
    #[msg("Recipient is blacklisted")]
    RecipientBlacklisted,
    #[msg("Sender is not on the allowlist")]
    SenderNotAllowlisted,
    #[msg("Recipient is not on the allowlist")]
    RecipientNotAllowlisted,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    /// Source token account
    /// CHECK: Validated by Token-2022
    pub source_account: AccountInfo<'info>,

    /// Mint
    /// CHECK: Validated by Token-2022
    pub mint: AccountInfo<'info>,

    /// Destination token account
    /// CHECK: Validated by Token-2022
    pub destination_account: AccountInfo<'info>,

    /// Authority (owner of source)
    /// CHECK: Validated by Token-2022
    pub authority: AccountInfo<'info>,

    /// Stablecoin config PDA (reads enable_allowlist flag)
    /// CHECK: Derived from mint
    pub stablecoin: AccountInfo<'info>,

    /// Optional: source blacklist PDA
    /// CHECK: We verify the PDA derivation
    pub source_blacklist: Option<AccountInfo<'info>>,

    /// Optional: destination blacklist PDA
    /// CHECK: We verify the PDA derivation
    pub destination_blacklist: Option<AccountInfo<'info>>,

    /// Optional: source allowlist PDA (SSS-3)
    /// CHECK: We verify the PDA derivation
    pub source_allowlist: Option<AccountInfo<'info>>,

    /// Optional: destination allowlist PDA (SSS-3)
    /// CHECK: We verify the PDA derivation
    pub destination_allowlist: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Will be initialized as ExtraAccountMetaList
    #[account(mut)]
    pub extra_account_meta_list: AccountInfo<'info>,

    /// CHECK: The mint for this transfer hook
    pub mint: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
