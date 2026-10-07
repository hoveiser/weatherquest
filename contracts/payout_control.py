# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""Control experiment v2: test whether _emit_payout works AFTER run_nondet_unsafe.
This matches devbounty's pattern exactly: run_nondet_unsafe for a nondeterministic
computation, then emit_transfer for the payout."""

from genlayer import *


@gl.evm.contract_interface
class EvmValueRecipient:
	class View:
		pass

	class Write:
		pass


def _emit_payout(to_hex: str, amount: u256) -> None:
	recipient = EvmValueRecipient(Address(to_hex))
	recipient.emit_transfer(value=amount)


def _leader_fn():
	"""Simulates the nondeterministic work (returns a simple result dict)."""
	import json
	result = gl.nondet.exec_prompt(
		"Say exactly the word APPROVE and nothing else."
	)
	approved = "APPROVE" in str(result).upper()
	return {"approved": approved, "raw": str(result)[:100]}


def _validator_fn(leader_res):
	"""Validator re-runs and compares the canonical decision."""
	if not isinstance(leader_res, gl.vm.Return):
		return False
	try:
		mine = _leader_fn()
	except Exception:
		return False
	theirs = leader_res.calldata
	return theirs["approved"] == mine["approved"]


class PayoutControl(gl.Contract):

	total_funded: u256
	payout_count: u256
	last_payout_to: str
	last_payout_amount: u256

	def __init__(self):
		self.total_funded = u256(0)
		self.payout_count = u256(0)
		self.last_payout_to = ""
		self.last_payout_amount = u256(0)

	@gl.public.write.payable
	def fund(self):
		value = int(gl.message.value)
		self.total_funded = self.total_funded + u256(value)

	@gl.public.write
	def pay_to(self, to_hex: str, amount: u256) -> dict:
		"""Simple emit_transfer (no nondet). Known to work."""
		_emit_payout(to_hex, amount)
		self.payout_count = self.payout_count + 1
		self.last_payout_to = to_hex
		self.last_payout_amount = amount
		return {"to": to_hex, "amount": int(amount), "pattern": "simple"}

	@gl.public.write
	def pay_after_nondet(self, to_hex: str, amount: u256) -> dict:
		"""Call _emit_payout AFTER run_nondet_unsafe returns. This tests
		whether emit_transfer is available post-nondet in the same method."""
		res = gl.vm.run_nondet_unsafe(_leader_fn, _validator_fn)
		if res["approved"]:
			_emit_payout(to_hex, amount)
			self.payout_count = self.payout_count + 1
			self.last_payout_to = to_hex
			self.last_payout_amount = amount
			return {"to": to_hex, "amount": int(amount), "approved": True, "pattern": "nondet"}
		return {"to": to_hex, "amount": 0, "approved": False, "pattern": "nondet"}

	@gl.public.view
	def contract_balance(self) -> u256:
		return self.balance

	@gl.public.view
	def get_stats(self) -> dict:
		return {
			"total_funded": int(self.total_funded),
			"payout_count": int(self.payout_count),
			"last_payout_to": self.last_payout_to,
			"last_payout_amount": int(self.last_payout_amount),
		}
