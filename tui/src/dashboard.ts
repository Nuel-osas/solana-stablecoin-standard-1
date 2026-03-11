import * as blessed from "blessed";
import * as contrib from "blessed-contrib";
import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  fetchStablecoinState,
  fetchSupplyInfo,
  fetchOraclePrice,
  detectPreset,
  subscribeToEvents,
  LogEvent,
  StablecoinStateData,
} from "./data";

// ── Color palette ────────────────────────────────────────────────────────

const COLORS = {
  primary: "cyan",
  accent: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray",
  highlight: "white",
  border: "cyan",
};

// ── Dashboard ────────────────────────────────────────────────────────────

export function createDashboard(
  connection: Connection,
  program: anchor.Program,
  mint: PublicKey,
  stablecoinPDA: PublicKey,
  programId: PublicKey,
  oracleFeed: string = "usdc"
): void {
  // ── Screen setup ─────────────────────────────────────────────────────
  const screen = blessed.screen({
    smartCSR: true,
    title: "SSS Dashboard",
    fullUnicode: true,
  });

  const grid = new contrib.grid({ rows: 12, cols: 12, screen });

  // ── Title bar ────────────────────────────────────────────────────────
  const titleBar = grid.set(0, 0, 1, 12, blessed.box, {
    content:
      "{center}{bold}{cyan-fg}SSS Dashboard{/cyan-fg}  {white-fg}Solana Stablecoin Standard{/white-fg}{/bold}{/center}",
    tags: true,
    style: {
      fg: "white",
      bg: "default",
      border: { fg: COLORS.border },
    },
    border: { type: "line" },
  });

  // ── Top-left: Stablecoin Info ────────────────────────────────────────
  const infoTable = grid.set(1, 0, 4, 6, contrib.table, {
    keys: false,
    fg: "white",
    label: " {bold}{cyan-fg}Stablecoin Info{/cyan-fg}{/bold} ",
    tags: true,
    columnSpacing: 3,
    columnWidth: [20, 46],
    style: {
      border: { fg: COLORS.border },
      header: { fg: COLORS.accent, bold: true },
      cell: { fg: "white" },
    },
  } as any);

  // ── Top-right: Supply Info ───────────────────────────────────────────
  const supplyTable = grid.set(1, 6, 4, 6, contrib.table, {
    keys: false,
    fg: "white",
    label: " {bold}{green-fg}Supply Info{/green-fg}{/bold} ",
    tags: true,
    columnSpacing: 3,
    columnWidth: [20, 30],
    style: {
      border: { fg: COLORS.accent },
      header: { fg: COLORS.primary, bold: true },
      cell: { fg: "white" },
    },
  } as any);

  // ── Middle-left: Extensions ──────────────────────────────────────────
  const extensionsTable = grid.set(5, 0, 3, 4, contrib.table, {
    keys: false,
    fg: "white",
    label: " {bold}{yellow-fg}Extensions{/yellow-fg}{/bold} ",
    tags: true,
    columnSpacing: 2,
    columnWidth: [22, 10],
    style: {
      border: { fg: COLORS.warning },
      header: { fg: COLORS.warning, bold: true },
      cell: { fg: "white" },
    },
  } as any);

  // ── Middle-center: Oracle Price ────────────────────────────────────
  const oracleTable = grid.set(5, 4, 3, 4, contrib.table, {
    keys: false,
    fg: "white",
    label: " {bold}{blue-fg}Pyth Oracle{/blue-fg}{/bold} ",
    tags: true,
    columnSpacing: 2,
    columnWidth: [16, 20],
    style: {
      border: { fg: "blue" },
      header: { fg: "blue", bold: true },
      cell: { fg: "white" },
    },
  } as any);

  // ── Middle-right: Roles ──────────────────────────────────────────────
  const rolesTable = grid.set(5, 8, 3, 4, contrib.table, {
    keys: false,
    fg: "white",
    label: " {bold}{magenta-fg}Roles & Authority{/magenta-fg}{/bold} ",
    tags: true,
    columnSpacing: 3,
    columnWidth: [18, 20],
    style: {
      border: { fg: "magenta" },
      header: { fg: "magenta", bold: true },
      cell: { fg: "white" },
    },
  } as any);

  // ── Bottom: Live event log ───────────────────────────────────────────
  const eventLog = grid.set(8, 0, 4, 12, contrib.log, {
    fg: "green",
    label: " {bold}{green-fg}Live Event Stream{/green-fg}{/bold} ",
    tags: true,
    scrollable: true,
    scrollbar: {
      style: { bg: COLORS.accent },
    },
    style: {
      border: { fg: COLORS.accent },
      fg: "green",
    },
    bufferLength: 200,
  } as any);

  // ── Status bar ───────────────────────────────────────────────────────
  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    content: " {cyan-fg}q{/cyan-fg} Quit  |  {cyan-fg}r{/cyan-fg} Refresh  |  Mint: " + mint.toBase58().slice(0, 16) + "...  |  Polling every 5s",
    tags: true,
    style: {
      fg: "white",
      bg: "default",
    },
  });
  screen.append(statusBar);

  // ── Helper: short address ────────────────────────────────────────────
  function shortAddr(addr: PublicKey | string | null | undefined): string {
    if (!addr) return "None";
    const s = typeof addr === "string" ? addr : addr.toBase58();
    return s.slice(0, 6) + "..." + s.slice(-4);
  }

  function statusIcon(enabled: boolean): string {
    return enabled ? "ENABLED" : "DISABLED";
  }

  // ── Render data ──────────────────────────────────────────────────────
  function renderState(state: StablecoinStateData | null) {
    if (!state) {
      (infoTable as any).setData({
        headers: ["Field", "Value"],
        data: [["Status", "No stablecoin found at this PDA"]],
      });
      screen.render();
      return;
    }

    const preset = detectPreset(state);

    // Info table
    (infoTable as any).setData({
      headers: ["Field", "Value"],
      data: [
        ["Name", state.name],
        ["Symbol", state.symbol],
        ["Preset", preset],
        ["Authority", shortAddr(state.authority)],
        ["Mint", shortAddr(state.mint)],
        ["Decimals", state.decimals.toString()],
        ["Paused", state.paused ? "YES" : "No"],
        ["URI", state.uri || "(none)"],
      ],
    });

    // Supply table
    fetchSupplyInfo(connection, mint, state).then((supply) => {
      (supplyTable as any).setData({
        headers: ["Metric", "Value"],
        data: [
          ["Current Supply", supply.currentSupply],
          ["Total Minted", supply.totalMinted],
          ["Total Burned", supply.totalBurned],
          ["Supply Cap", supply.supplyCap],
          ["Decimals", supply.decimals.toString()],
        ],
      });
      screen.render();
    });

    // Extensions table
    (extensionsTable as any).setData({
      headers: ["Extension", "Status"],
      data: [
        ["Permanent Delegate", statusIcon(state.enablePermanentDelegate)],
        ["Transfer Hook", statusIcon(state.enableTransferHook)],
        ["Allowlist (SSS-3)", statusIcon(state.enableAllowlist)],
        ["Default Frozen", statusIcon(state.defaultAccountFrozen)],
      ],
    });

    // Roles table
    const rolesData: string[][] = [
      ["Master Authority", shortAddr(state.authority)],
    ];
    if (state.pendingAuthority) {
      rolesData.push(["Pending Authority", shortAddr(state.pendingAuthority)]);
    }
    rolesData.push(
      ["Program ID", shortAddr(programId)],
      ["Stablecoin PDA", shortAddr(stablecoinPDA)]
    );

    (rolesTable as any).setData({
      headers: ["Role", "Address"],
      data: rolesData,
    });

    // Oracle price
    fetchOraclePrice(oracleFeed).then((oracle) => {
      if (oracle) {
        const pegColor = oracle.isDepegged ? "DEPEGGED" : "ON PEG";
        (oracleTable as any).setData({
          headers: ["Metric", "Value"],
          data: [
            ["Feed", oracle.feed + "/USD"],
            ["Price", "$" + oracle.price.toFixed(6)],
            ["Confidence", "±$" + oracle.confidence.toFixed(6)],
            ["Deviation", oracle.deviationPct],
            ["Peg Status", pegColor],
            ["Updated", oracle.publishTime],
          ],
        });
      } else {
        (oracleTable as any).setData({
          headers: ["Metric", "Value"],
          data: [["Status", "Failed to fetch"]],
        });
      }
      screen.render();
    });

    screen.render();
  }

  // ── Initial log messages ─────────────────────────────────────────────
  (eventLog as any).log(`{cyan-fg}Dashboard initialized{/cyan-fg}`);
  (eventLog as any).log(`Mint: ${mint.toBase58()}`);
  (eventLog as any).log(`PDA:  ${stablecoinPDA.toBase58()}`);
  (eventLog as any).log(`Cluster: ${connection.rpcEndpoint}`);
  (eventLog as any).log(`{gray-fg}Subscribing to program logs...{/gray-fg}`);

  // ── Event subscription ──────────────────────────────────────────────
  let subscriptionId: number | null = null;
  try {
    subscriptionId = subscribeToEvents(connection, programId, (event: LogEvent) => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const colorMap: Record<string, string> = {
        TokensMinted: "green",
        TokensBurned: "red",
        Paused: "yellow",
        Unpaused: "green",
        RoleAssigned: "cyan",
        RoleRevoked: "magenta",
        AccountFrozen: "red",
        AccountThawed: "green",
        BlacklistAdded: "red",
        BlacklistRemoved: "green",
        TokensSeized: "red",
        AuthorityTransferred: "yellow",
        StablecoinInitialized: "cyan",
      };
      const color = colorMap[event.type] || "white";
      (eventLog as any).log(
        `{gray-fg}[${time}]{/gray-fg} {${color}-fg}{bold}${event.type}{/bold}{/${color}-fg}  tx: ${event.signature.slice(0, 20)}...`
      );
      // Auto-refresh state on events
      refreshState();
    });
    (eventLog as any).log(`{green-fg}Subscribed to live events (id: ${subscriptionId}){/green-fg}`);
  } catch (err: any) {
    (eventLog as any).log(`{red-fg}WebSocket subscription failed: ${err.message}{/red-fg}`);
    (eventLog as any).log(`{yellow-fg}Falling back to polling only{/yellow-fg}`);
  }

  // ── Poll loop ────────────────────────────────────────────────────────
  let refreshCount = 0;

  async function refreshState() {
    try {
      const state = await fetchStablecoinState(program, stablecoinPDA);
      renderState(state);
      refreshCount++;
      statusBar.setContent(
        ` {cyan-fg}q{/cyan-fg} Quit  |  {cyan-fg}r{/cyan-fg} Refresh  |  ` +
        `Mint: ${mint.toBase58().slice(0, 16)}...  |  ` +
        `Refreshed ${refreshCount}x  |  ` +
        `{green-fg}${new Date().toLocaleTimeString()}{/green-fg}`
      );
      screen.render();
    } catch (err: any) {
      (eventLog as any).log(`{red-fg}Fetch error: ${err.message}{/red-fg}`);
    }
  }

  // Initial fetch
  refreshState();

  // Poll every 5 seconds
  const pollInterval = setInterval(refreshState, 5000);

  // ── Key bindings ─────────────────────────────────────────────────────
  screen.key(["q", "escape", "C-c"], () => {
    clearInterval(pollInterval);
    if (subscriptionId !== null) {
      connection.removeOnLogsListener(subscriptionId);
    }
    screen.destroy();
    process.exit(0);
  });

  screen.key(["r"], () => {
    (eventLog as any).log("{cyan-fg}Manual refresh triggered{/cyan-fg}");
    refreshState();
  });

  screen.render();
}
