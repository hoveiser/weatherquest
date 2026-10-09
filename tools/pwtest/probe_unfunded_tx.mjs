// Why did the UI show "Transaction Failed" for a brand-new throwaway signer?
// Sends exactly one zero-value self-transfer from an unfunded StudioNet account
// and prints the node's own error, so the cause is measured rather than assumed.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = "https://studio.genlayer.com/api";

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  return res.json();
}

const acct = privateKeyToAccount(generatePrivateKey());
console.log("throwaway:", acct.address);
console.log("chainId:", JSON.stringify(await rpc("eth_chainId")));
console.log("gasPrice:", JSON.stringify(await rpc("eth_gasPrice")));
console.log("nonce:", JSON.stringify(await rpc("eth_getTransactionCount", [acct.address, "pending"])));
console.log("balance:", JSON.stringify(await rpc("eth_getBalance", [acct.address, "latest"])));

const nonce = await rpc("eth_getTransactionCount", [acct.address, "pending"]);
const gasPrice = await rpc("eth_gasPrice");
const tx = {
  from: acct.address,
  to: acct.address,
  data: "0x",
  value: 0n,
  gas: 0x30d40n,
  nonce: BigInt(nonce.result),
  gasPrice: BigInt(gasPrice.result),
  chainId: 61999,
};
const serialized = await acct.signTransaction(tx);
const send = await rpc("eth_sendRawTransaction", [serialized]);
console.log("sendRawTransaction ->", JSON.stringify(send));
