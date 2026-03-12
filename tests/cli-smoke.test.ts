import { expect } from "chai";
import { execSync } from "child_process";

const ROOT = process.cwd();
const CLI_CMD = "yarn cli";
const DEVNET_MINT = "C19Kt3sRSNuGYc9xGGvvzeY9Q4ENgnohDo66oGFDgfMt";
const DEVNET_ADDRESS = "DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk";

function run(args: string): string {
  return execSync(`${CLI_CMD} ${args}`, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

describe("CLI Smoke Tests", function () {
  this.timeout(30_000);

  // ---- Help commands ----

  describe("--help", () => {
    it("should print top-level help and exit 0", () => {
      const output = run("--help");
      expect(output).to.include("Usage");
    });

    it("should mention available commands", () => {
      const output = run("--help");
      expect(output).to.match(/init|mint|burn|roles|status/);
    });
  });

  describe("init --help", () => {
    it("should print init help and exit 0", () => {
      const output = run("init --help");
      expect(output).to.include("init");
    });
  });

  describe("mint --help", () => {
    it("should print mint help and exit 0", () => {
      const output = run("mint --help");
      expect(output).to.include("mint");
    });
  });

  describe("burn --help", () => {
    it("should print burn help and exit 0", () => {
      const output = run("burn --help");
      expect(output).to.include("burn");
    });
  });

  describe("roles --help", () => {
    it("should print roles help and exit 0", () => {
      const output = run("roles --help");
      expect(output).to.include("roles");
    });
  });

  describe("roles assign --help", () => {
    it("should print roles assign help and exit 0", () => {
      const output = run("roles assign --help");
      expect(output).to.include("assign");
    });
  });

  // ---- Devnet commands ----

  describe("status --mint", () => {
    it("should return status for the devnet mint", () => {
      const output = run(`status --mint ${DEVNET_MINT}`);
      // The status command should print stablecoin metadata without crashing
      expect(output).to.be.a("string");
      expect(output.length).to.be.greaterThan(0);
    });

    it("should display the stablecoin name in status output", () => {
      const output = run(`status --mint ${DEVNET_MINT}`);
      // Output should contain recognisable stablecoin information
      expect(output).to.match(/name|symbol|mint|supply|decimals/i);
    });
  });

  describe("roles list --mint", () => {
    it("should list roles for the devnet mint without crashing", () => {
      const output = run(`roles list --mint ${DEVNET_MINT}`);
      expect(output).to.be.a("string");
      expect(output.length).to.be.greaterThan(0);
    });
  });

  describe("roles check --mint --address", () => {
    it("should check roles for the given address without crashing", () => {
      const output = run(
        `roles check --mint ${DEVNET_MINT} --address ${DEVNET_ADDRESS}`
      );
      expect(output).to.be.a("string");
      expect(output.length).to.be.greaterThan(0);
    });

    it("should contain role check result text", () => {
      const output = run(
        `roles check --mint ${DEVNET_MINT} --address ${DEVNET_ADDRESS}`
      );
      // Should output something about the role or address
      expect(output).to.match(/minter|burner|pauser|role|active|true|false/i);
    });
  });
});
