# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""Minimal emit_transfer test: proves which pattern delivers native GEN to an EOA."""

from genlayer import *
import json


@gl.evm.contract_interface
class EvmValueRecipient:
	class View:
		pass

	class Write:
		pass


class TransferTest(gl.Contract):
	"""Deposits then pays out using different emit_transfer patterns."""

	paid_count: u256

	def __init__(self):
		self.paid_count = u256(0)

	@gl.public.write.payable
	def deposit(self):
		return None

	@gl.public.view
	def contract_balance(self) -> u256:
		return self.balance

	@gl.public.view
	def get_paid_count(self) -> u256:
		return self.paid_count

	# Pattern A: @gl.evm.contract_interface, no on= (immediate EthSend)
	@gl.public.write
	def pay_immediate(self) -> dict:
		amount = u256(1000000000000000000)
		if self.balance < amount:
			raise gl.vm.UserError("insufficient balance")
		self.paid_count = self.paid_count + 1
		recipient = EvmValueRecipient(Address(gl.message.sender_address))
		recipient.emit_transfer(value=amount)
		return {"pattern": "A_immediate", "amount": int(amount)}

	# Pattern B: @gl.evm.contract_interface, on="accepted"
	@gl.public.write
	def pay_on_accepted(self) -> dict:
		amount = u256(1000000000000000000)
		if self.balance < amount:
			raise gl.vm.UserError("insufficient balance")
		self.paid_count = self.paid_count + 1
		recipient = EvmValueRecipient(Address(gl.message.sender_address))
		recipient.emit_transfer(value=amount, on="accepted")
		return {"pattern": "B_accepted", "amount": int(amount)}

	# Pattern C: @gl.evm.contract_interface, on="finalized"
	@gl.public.write
	def pay_on_finalized(self) -> dict:
		amount = u256(1000000000000000000)
		if self.balance < amount:
			raise gl.vm.UserError("insufficient balance")
		self.paid_count = self.paid_count + 1
		recipient = EvmValueRecipient(Address(gl.message.sender_address))
		recipient.emit_transfer(value=amount, on="finalized")
		return {"pattern": "C_finalized", "amount": int(amount)}

	# Pattern D (control): gl.get_contract_at().emit_transfer (known broken for EOAs)
	@gl.public.write
	def pay_broken(self) -> dict:
		amount = u256(1000000000000000000)
		if self.balance < amount:
			raise gl.vm.UserError("insufficient balance")
		self.paid_count = self.paid_count + 1
		gl.get_contract_at(gl.message.sender_address).emit_transfer(value=amount, on="finalized")
		return {"pattern": "D_broken", "amount": int(amount)}
