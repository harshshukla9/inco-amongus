import { expect } from "chai";
import hre from "hardhat";

describe("AmongUsRoles (compile smoke)", function () {
  it("deploys with impostorCount=1", async function () {
    const [deployer] = await hre.viem.getWalletClients();
    const game = await hre.viem.deployContract("AmongUsRoles", [1]);
    expect(await game.read.impostorCount()).to.equal(1);
    expect(await game.read.state()).to.equal(0); // Idle
    expect(deployer.account.address).to.match(/^0x/);
  });
});
