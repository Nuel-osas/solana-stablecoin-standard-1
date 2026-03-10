use anchor_lang::prelude::*;
use anchor_lang::system_program;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_token_2022::state::Account as TokenAccount;
use spl_token_2022::extension::StateWithExtensions;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("63pY5GPBHKJ3gu99xTNH9yxUKgp8kUowiiHYzZtaE31E");

/// The sss-token program ID — blacklist PDAs are owned by this program.
const SSS_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ");

/// Seeds used by the main sss-token program
const STABLECOIN_SEED: &[u8] = b"stablecoin";
const BLACKLIST_SEED: &[u8] = b"blacklist";

#[program]
pub mod sss_transfer_hook {
    use super::*;

    /// Called by Token-2022 on every transfer.
    /// Checks that neither sender nor recipient is blacklisted.
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        // The transfer hook receives the source, mint, destination, and authority.
        // We need to check blacklist PDAs for both source owner and destination owner.
        //
        // Note: AccountInfo.owner is the *program* that owns the account (Token-2022),
        // not the wallet. We must unpack the token account data to get the real owner.

        let source_data = ctx.accounts.source_account.try_borrow_data()?;
        let source_account = StateWithExtensions::<TokenAccount>::unpack(&source_data)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        let source_owner = source_account.base.owner;

        let dest_data = ctx.accounts.destination_account.try_borrow_data()?;
        let dest_account = StateWithExtensions::<TokenAccount>::unpack(&dest_data)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        let dest_owner = dest_account.base.owner;
        let stablecoin_key = ctx.accounts.stablecoin.key();

        // Check source blacklist
        let (source_blacklist_pda, _) = Pubkey::find_program_address(
            &[BLACKLIST_SEED, stablecoin_key.as_ref(), source_owner.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        // If the source_blacklist account exists and matches the PDA, the source is blacklisted
        if let Some(source_bl) = &ctx.accounts.source_blacklist {
            if source_bl.key() == source_blacklist_pda {
                return Err(error!(TransferHookError::SenderBlacklisted));
            }
        }

        // Check destination blacklist
        let (dest_blacklist_pda, _) = Pubkey::find_program_address(
            &[BLACKLIST_SEED, stablecoin_key.as_ref(), dest_owner.as_ref()],
            &SSS_TOKEN_PROGRAM_ID,
        );

        if let Some(dest_bl) = &ctx.accounts.destination_blacklist {
            if dest_bl.key() == dest_blacklist_pda {
                return Err(error!(TransferHookError::RecipientBlacklisted));
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
        // Define the extra accounts the transfer hook expects beyond the
        // standard source / mint / destination / authority:
        //
        // 1. Stablecoin config PDA — derived from [b"stablecoin", mint]
        //    using the sss-token program.
        // 2. Source blacklist PDA — derived from [b"blacklist", stablecoin, source_owner]
        //    using the sss-token program.  (Optional at runtime, but must be
        //    declared so Token-2022 knows the account position.)
        // 3. Destination blacklist PDA — same derivation with dest_owner.

        // Account indices in the combined list (4 fixed + extras):
        //   0 = source token account
        //   1 = mint
        //   2 = destination token account
        //   3 = authority (source owner)
        //   4 = extra[0]: sss-token program ID (needed as program for PDA derivation)
        //   5 = extra[1]: stablecoin config PDA
        //   6 = extra[2]: source blacklist PDA
        //   7 = extra[3]: destination blacklist PDA
        let extra_account_metas = &[
            // extra[0]: sss-token program ID as a fixed pubkey account
            ExtraAccountMeta::new_with_pubkey(&SSS_TOKEN_PROGRAM_ID, false, false)
                .map_err(|_| ProgramError::InvalidArgument)?,
            // extra[1]: stablecoin config PDA
            // seeds: [b"stablecoin", mint.key()], program = extra[0] (abs index 4)
            ExtraAccountMeta::new_external_pda_with_seeds(
                4, // abs index of sss-token program
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
            // seeds: [b"blacklist", stablecoin.key(), source_owner], program = extra[0]
            // source_owner = bytes 32..64 of source token account (index 0)
            ExtraAccountMeta::new_external_pda_with_seeds(
                4,
                &[
                    Seed::Literal {
                        bytes: BLACKLIST_SEED.to_vec(),
                    },
                    Seed::AccountKey { index: 5 }, // stablecoin (abs index 5)
                    Seed::AccountData { account_index: 0, data_index: 32, length: 32 }, // source token account owner
                ],
                false,
                false,
            )
            .map_err(|_| ProgramError::InvalidArgument)?,
            // extra[3]: destination blacklist PDA
            // seeds: [b"blacklist", stablecoin.key(), dest_owner], program = extra[0]
            // dest_owner = bytes 32..64 of destination token account (index 2)
            ExtraAccountMeta::new_external_pda_with_seeds(
                4,
                &[
                    Seed::Literal {
                        bytes: BLACKLIST_SEED.to_vec(),
                    },
                    Seed::AccountKey { index: 5 }, // stablecoin (abs index 5)
                    Seed::AccountData { account_index: 2, data_index: 32, length: 32 }, // dest token account owner
                ],
                false,
                false,
            )
            .map_err(|_| ProgramError::InvalidArgument)?,
        ];

        // Compute required space and initialize.
        let account_size = ExtraAccountMetaList::size_of(extra_account_metas.len())?;
        let lamports = Rent::get()?.minimum_balance(account_size);

        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[u8]] = &[b"extra-account-metas", mint_key.as_ref()];
        let (_, bump) = Pubkey::find_program_address(signer_seeds, &crate::id());
        let signer_seeds_with_bump: &[&[u8]] =
            &[b"extra-account-metas", mint_key.as_ref(), &[bump]];

        // Create the account if needed (CPI to system program).
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

        // Write the list into the newly created account.
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            extra_account_metas,
        )?;

        msg!("Extra account meta list initialized");
        Ok(())
    }
}

#[error_code]
pub enum TransferHookError {
    #[msg("Sender is blacklisted")]
    SenderBlacklisted,
    #[msg("Recipient is blacklisted")]
    RecipientBlacklisted,
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

    /// Stablecoin config PDA
    /// CHECK: Derived from mint
    pub stablecoin: AccountInfo<'info>,

    /// Optional: source blacklist PDA
    /// CHECK: We verify the PDA derivation
    pub source_blacklist: Option<AccountInfo<'info>>,

    /// Optional: destination blacklist PDA
    /// CHECK: We verify the PDA derivation
    pub destination_blacklist: Option<AccountInfo<'info>>,
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
