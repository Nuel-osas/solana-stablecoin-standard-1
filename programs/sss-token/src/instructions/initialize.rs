use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{Mint, TokenInterface};
use spl_token_2022::extension::ExtensionType;
use spl_token_2022::state::Mint as MintState;

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

pub fn handler(ctx: Context<Initialize>, config: StablecoinInitConfig) -> Result<()> {
    // Validate config
    require!(config.name.len() <= MAX_NAME_LEN, SSSError::NameTooLong);
    require!(config.symbol.len() <= MAX_SYMBOL_LEN, SSSError::SymbolTooLong);
    require!(config.uri.len() <= MAX_URI_LEN, SSSError::UriTooLong);
    require!(config.decimals <= 18, SSSError::InvalidDecimals);

    // Determine extensions needed
    let mut extensions = vec![ExtensionType::MetadataPointer];

    if config.enable_permanent_delegate {
        extensions.push(ExtensionType::PermanentDelegate);
    }
    if config.enable_transfer_hook {
        extensions.push(ExtensionType::TransferHook);
    }
    if config.default_account_frozen {
        // Default account state extension to freeze new accounts
        extensions.push(ExtensionType::DefaultAccountState);
    }

    // Calculate space needed for mint with extensions (without metadata content)
    let space = ExtensionType::try_calculate_account_len::<MintState>(&extensions)?;

    // The token metadata initialize instruction will realloc the mint account
    // to store name/symbol/uri. We must pre-fund enough lamports for the final
    // size, otherwise the transaction fails with "insufficient funds for rent".
    let metadata_content_space = 4 + 4 + 32 + 32
        + (4 + config.name.len())
        + (4 + config.symbol.len())
        + (4 + config.uri.len())
        + 4;
    let lamports = Rent::get()?.minimum_balance(space + metadata_content_space);

    // Create the mint account
    anchor_lang::system_program::create_account(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        lamports,
        space as u64,
        ctx.accounts.token_program.key,
    )?;

    // Initialize metadata pointer (points to mint itself)
    let ix = spl_token_2022::extension::metadata_pointer::instruction::initialize(
        ctx.accounts.token_program.key,
        &ctx.accounts.mint.key(),
        Some(ctx.accounts.stablecoin.key()),
        Some(ctx.accounts.mint.key()),
    )?;
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
        ],
    )?;

    // Initialize permanent delegate if SSS-2
    if config.enable_permanent_delegate {
        let ix = spl_token_2022::instruction::initialize_permanent_delegate(
            ctx.accounts.token_program.key,
            &ctx.accounts.mint.key(),
            &ctx.accounts.stablecoin.key(), // PDA is the permanent delegate
        )?;
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[ctx.accounts.mint.to_account_info()],
        )?;
    }

    // Initialize transfer hook if SSS-2
    if config.enable_transfer_hook {
        let ix = spl_token_2022::extension::transfer_hook::instruction::initialize(
            ctx.accounts.token_program.key,
            &ctx.accounts.mint.key(),
            Some(ctx.accounts.stablecoin.key()),
            ctx.accounts.transfer_hook_program.as_ref().map(|p| p.key()),
        )?;
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[ctx.accounts.mint.to_account_info()],
        )?;
    }

    // Initialize default account state if configured
    if config.default_account_frozen {
        let ix = spl_token_2022::extension::default_account_state::instruction::initialize_default_account_state(
            ctx.accounts.token_program.key,
            &ctx.accounts.mint.key(),
            &spl_token_2022::state::AccountState::Frozen,
        )?;
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[ctx.accounts.mint.to_account_info()],
        )?;
    }

    // Initialize the mint
    // Use the bump Anchor already computed for the stablecoin PDA
    let bump = ctx.bumps.stablecoin;

    token_2022::initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_2022::InitializeMint2 {
                mint: ctx.accounts.mint.to_account_info(),
            },
        ),
        config.decimals,
        &ctx.accounts.stablecoin.key(), // mint authority = PDA
        Some(&ctx.accounts.stablecoin.key()), // freeze authority = PDA
    )?;

    // Initialize metadata on the mint
    let ix = spl_token_metadata_interface::instruction::initialize(
        ctx.accounts.token_program.key,
        &ctx.accounts.mint.key(),
        &ctx.accounts.stablecoin.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.stablecoin.key(),
        config.name.clone(),
        config.symbol.clone(),
        config.uri.clone(),
    );
    let stablecoin_seeds = &[
        STABLECOIN_SEED,
        ctx.accounts.mint.to_account_info().key.as_ref(),
        &[bump],
    ];
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.stablecoin.to_account_info(),
        ],
        &[stablecoin_seeds],
    )?;

    // Initialize stablecoin state
    let stablecoin = &mut ctx.accounts.stablecoin;
    stablecoin.authority = ctx.accounts.authority.key();
    stablecoin.mint = ctx.accounts.mint.key();
    stablecoin.name = config.name.clone();
    stablecoin.symbol = config.symbol.clone();
    stablecoin.uri = config.uri.clone();
    stablecoin.decimals = config.decimals;
    stablecoin.paused = false;
    stablecoin.enable_permanent_delegate = config.enable_permanent_delegate;
    stablecoin.enable_transfer_hook = config.enable_transfer_hook;
    stablecoin.default_account_frozen = config.default_account_frozen;
    stablecoin.enable_allowlist = config.enable_allowlist;
    stablecoin.total_minted = 0;
    stablecoin.total_burned = 0;
    stablecoin.supply_cap = config.supply_cap.unwrap_or(0);
    stablecoin.pending_authority = Pubkey::default();
    stablecoin.bump = ctx.bumps.stablecoin;
    stablecoin._reserved = [0u8; 23];

    emit!(events::StablecoinInitialized {
        mint: ctx.accounts.mint.key(),
        authority: ctx.accounts.authority.key(),
        name: config.name,
        symbol: config.symbol,
        decimals: config.decimals,
        compliance_enabled: stablecoin.is_compliance_enabled(),
        transfer_hook_enabled: config.enable_transfer_hook,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The mint account to create (Token-2022). Must be a fresh keypair.
    /// CHECK: We create and initialize this account manually with extensions.
    #[account(mut)]
    pub mint: Signer<'info>,

    /// Stablecoin config PDA
    #[account(
        init,
        payer = authority,
        space = Stablecoin::LEN,
        seeds = [STABLECOIN_SEED, mint.key().as_ref()],
        bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    /// Optional: transfer hook program for SSS-2
    /// CHECK: Validated if transfer hook is enabled
    pub transfer_hook_program: Option<AccountInfo<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
