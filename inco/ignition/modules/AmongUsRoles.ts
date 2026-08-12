import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// npx hardhat ignition deploy ignition/modules/AmongUsRoles.ts --network baseSepolia
export default buildModule("AmongUsRoles", (m) => {
  const impostorCount = m.getParameter("impostorCount", 1);
  const game = m.contract("AmongUsRoles", [impostorCount]);
  return { game };
});
