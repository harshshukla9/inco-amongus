import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// npx hardhat ignition deploy ignition/modules/Mafia.ts --network baseSepolia
export default buildModule("Mafia", (m) => {
  const mafiaCount = m.getParameter("mafiaCount", 1);
  const game = m.contract("Mafia", [mafiaCount]);
  return { game };
});
