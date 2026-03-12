use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::Stablecoin;

/// Update the stablecoin's metadata URI. Only the master authority can call this.
/// Name and symbol are immutable after initialization to prevent ticker confusion.
pub fn update_metadata_handler(
    ctx: Context<UpdateMetadata>,
    uri: String,
) -> Result<()> {
    require!(uri.len() <= MAX_URI_LEN, SSSError::UriTooLong);

    let stablecoin = &mut ctx.accounts.stablecoin;

    let bump = stablecoin.bump;
    let mint_key = stablecoin.mint;
    let stablecoin_seeds = &[
        STABLECOIN_SEED,
        mint_key.as_ref(),
        &[bump],
    ];

    let ix = spl_token_metadata_interface::instruction::update_field(
        ctx.accounts.token_program.key,
        &ctx.accounts.mint.key(),
        &stablecoin.key(),
        spl_token_metadata_interface::state::Field::Uri,
        uri.clone(),
    );
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            stablecoin.to_account_info(),
        ],
        &[stablecoin_seeds],
    )?;
    stablecoin.uri = uri.clone();

    emit!(events::MetadataUpdated {
        mint: ctx.accounts.mint.key(),
        uri: uri,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Accounts required to update the stablecoin's metadata URI.
#[derive(Accounts)]
pub struct UpdateMetadata<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The mint account (Token-2022) — metadata is stored on the mint itself
    /// CHECK: Validated via stablecoin.mint constraint
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, mint.key().as_ref()],
        bump = stablecoin.bump,
        has_one = authority @ SSSError::Unauthorized,
        has_one = mint,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    pub token_program: Interface<'info, TokenInterface>,
}
