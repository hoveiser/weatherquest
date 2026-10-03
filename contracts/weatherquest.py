# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""
WeatherQuest: AI-Verified Gaming Bounties — GenLayer Intelligent Contract.

Real-world weather determines a quest's Risk Multiplier (1.0x-5.0x) and the
Success Chance of a player Action. A text-based bounty RPG with trustless,
validator-verified AI adjudication.

Consensus boundary
------------------
- Frontend owns: UI, wallet, non-authoritative previews, cached weather.
- This contract owns: escrow, weather-derived multiplier derivation, action
  judgment, and the final payout/refund settlement. All nondeterministic steps
  (Open-Meteo geocoding + forecast, LLM analysis) run through a comparative
  validator so independent validators must agree on the *decision fields*
  (risk tier, multiplier bucket, success flag) — never merely on JSON shape.
- External sources (Open-Meteo) provide raw facts; validators re-fetch and
  normalize them, comparing only stable/derived fields.

Fail-closed
-----------
Any API failure, timeout, missing city, or malformed LLM output raises a
classified `gl.vm.UserError` so the transaction reverts and no funds move.
"""

# nofixcheckspace
from genlayer import *
import json
from datetime import datetime, timedelta

# --- Error classification (validators compare these prefixes) ---------------
ERROR_EXPECTED = "[EXPECTED]"    # deterministic business logic
ERROR_EXTERNAL = "[EXTERNAL]"    # deterministic external 4xx / not-found
ERROR_TRANSIENT = "[TRANSIENT]"  # network / 5xx — agree if both transient
ERROR_LLM = "[LLM_ERROR]"        # LLM misbehavior — always disagree, rotate

# --- Constants --------------------------------------------------------------
GEN = 1_000_000_000_000_000_000  # 1 GEN in atto (money is atto-scaled u256)

ATTO_MIN = 1 * GEN               # base_reward >= 1 GEN
ATTO_MAX = 1000 * GEN            # base_reward <= 1000 GEN
EXPIRY_MIN_HOURS = 1
EXPIRY_MAX_HOURS = 168           # 7 days
CITY_MAX = 100
ACTION_MAX = 200
DESC_MAX = 500

MULT_MIN = 100                   # 1.00x, stored as hundredths (integer)
MULT_MAX = 500                   # 5.00x
MULT_TOLERANCE = 100             # validators may differ by up to 1.00x

# Quest status lifecycle
STATUS_ACTIVE = "Active"
STATUS_COMPLETED = "Completed"
STATUS_FAILED = "Failed"
STATUS_CLAIMED = "Claimed"

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=en&format=json"
FORECAST_URL = (
    "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
    "&current=temperature_2m,precipitation,weather_code,wind_speed_10m,"
    "relative_humidity_2m,is_day&timezone=auto"
)


# --- Pure helpers (deterministic, no self / no storage) ---------------------
def _iso(dt):
	return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _parse_iso(s):
	"""Parse an ISO-8601 datetime string without touching wall-clock time."""
	text = str(s).strip()
	if text.endswith("Z"):
		text = text[:-1]
	if len(text) > 19 and text[19] in ("+", "-"):
		text = text[:19]
	try:
		return datetime.fromisoformat(text)
	except Exception:
		return datetime.strptime(text[:16], "%Y-%m-%dT%H:%M")


def _now():
	"""Current transaction datetime (deterministic — supplied by the VM message)."""
	raw = gl.message_raw
	dt = raw.get("datetime") if isinstance(raw, dict) else getattr(raw, "datetime", None)
	if not dt:
		raise gl.vm.UserError(f"{ERROR_EXPECTED} Transaction datetime unavailable")
	return _parse_iso(str(dt))


def _extract_json(text):
	"""Best-effort recovery of a JSON object from an LLM string response."""
	first = text.find("{")
	last = text.rfind("}")
	if first == -1 or last == -1 or last <= first:
		raise gl.vm.UserError(f"{ERROR_LLM} No JSON object in LLM output")
	return json.loads(text[first : last + 1])


def _normalize_tier(raw):
	t = str(raw).strip().lower()
	if t.startswith("low"):
		return "Low"
	if t.startswith("med") or t.startswith("mod"):
		return "Medium"
	if t.startswith("high"):
		return "High"
	if t.startswith("ext") or t.startswith("severe"):
		return "Extreme"
	raise gl.vm.UserError(f"{ERROR_LLM} Unrecognized risk_tier: {raw!r}")


def _weather_code_text(code):
	if code == 0:
		return "Clear sky"
	if code == 1 or code == 2:
		return "Partly cloudy"
	if code == 3:
		return "Overcast"
	if code == 45 or code == 48:
		return "Fog"
	if 51 <= code <= 57:
		return "Drizzle"
	if 61 <= code <= 67:
		return "Rain"
	if 71 <= code <= 77:
		return "Snow"
	if 80 <= code <= 82:
		return "Rain showers"
	if code == 85 or code == 86:
		return "Snow showers"
	if 95 <= code <= 99:
		return "Thunderstorm"
	return "Unknown"


def _fmt_x100(x100):
	"""Format an integer hundredths multiplier as e.g. 350 -> '3.50' (no float)."""
	return f"{x100 // 100}.{x100 % 100:02d}"


def _fmt_atto(atto):
	"""Format atto-gen as a GEN string with 4 decimals, using integer math only."""
	frac = atto % GEN
	return f"{atto // GEN}.{frac // (GEN // 10000):04d}"


def _handle_leader_error(leaders_res, leader_fn):
	"""Canonical validator agreement rule for the leader-error path."""
	leader_msg = getattr(leaders_res, "message", None) or getattr(leaders_res, "data", None) or ""
	leader_msg = str(leader_msg)
	try:
		leader_fn()
		return False  # leader errored, validator succeeded -> disagree
	except gl.vm.UserError as e:
		vmsg = str(getattr(e, "data", "") or getattr(e, "message", "") or e)
		if vmsg.startswith(ERROR_EXPECTED) or vmsg.startswith(ERROR_EXTERNAL):
			return vmsg == leader_msg  # deterministic -> exact match
		if vmsg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
			return True  # both transient -> agree
		return False  # LLM or unknown -> disagree, force rotation
	except Exception:
		return False


def _run_prompt(prompt):
	"""Run an LLM prompt, tolerating a JSON-string reply. Fail-closed on errors."""
	try:
		raw = gl.nondet.exec_prompt(prompt, response_format="json")
	except gl.vm.UserError:
		raise
	except Exception:
		raise gl.vm.UserError(f"{ERROR_LLM} LLM call failed")
	if isinstance(raw, str):
		try:
			raw = _extract_json(raw)
		except gl.vm.UserError:
			raise
		except Exception:
			raise gl.vm.UserError(f"{ERROR_LLM} LLM returned non-JSON")
	return raw


# --- Nondeterministic evidence producers (module-level, serializable) -------
def _fetch_weather_snapshot(city):
	"""Geocode the city then fetch current weather. Extract stable fields only."""
	geo = gl.nondet.web.get(GEOCODE_URL.format(city=city))
	st = geo.status
	if st is None or st == "timeout" or (isinstance(st, int) and st >= 500):
		raise gl.vm.UserError(f"{ERROR_TRANSIENT} Geocoding temporarily unavailable")
	if isinstance(st, int) and 400 <= st < 500:
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} Geocoding API error {st}")
	if geo.body is None:
		raise gl.vm.UserError(f"{ERROR_TRANSIENT} Geocoding returned empty body")
	try:
		geo_data = json.loads(geo.body.decode("utf-8"))
	except Exception:
		raise gl.vm.UserError(f"{ERROR_TRANSIENT} Geocoding returned invalid JSON")

	results = geo_data.get("results")
	if not results:
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} No location found for city '{city}'")
	lat = results[0]["latitude"]
	lon = results[0]["longitude"]

	fc = gl.nondet.web.get(FORECAST_URL.format(lat=lat, lon=lon))
	st2 = fc.status
	if st2 is None or st2 == "timeout" or (isinstance(st2, int) and st2 >= 500):
		raise gl.vm.UserError(f"{ERROR_TRANSIENT} Weather API temporarily unavailable")
	if isinstance(st2, int) and 400 <= st2 < 500:
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} Weather API error {st2}")
	if fc.body is None:
		raise gl.vm.UserError(f"{ERROR_TRANSIENT} Weather API returned empty body")
	try:
		fc_data = json.loads(fc.body.decode("utf-8"))
	except Exception:
		raise gl.vm.UserError(f"{ERROR_TRANSIENT} Weather API returned invalid JSON")

	cur = fc_data.get("current")
	if not isinstance(cur, dict):
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} No weather data for city '{city}'")

	return {
		"city": city,
		"temperature_2m": cur.get("temperature_2m"),
		"precipitation": cur.get("precipitation"),
		"wind_speed_10m": cur.get("wind_speed_10m"),
		"relative_humidity_2m": cur.get("relative_humidity_2m"),
		"weather_code": int(cur.get("weather_code", -1)),
	}


def _analyze_weather(city):
	"""Fetch weather + ask LLM for a normalized risk assessment. Fail-closed."""
	snap = _fetch_weather_snapshot(city)
	summary = (
		f"City={snap['city']} temp={snap['temperature_2m']}C "
		f"precip={snap['precipitation']}mm wind={snap['wind_speed_10m']}km/h "
		f"humidity={snap['relative_humidity_2m']}% "
		f"condition={_weather_code_text(snap['weather_code'])}"
	)
	prompt = (
		"You are the risk engine of a weather-based bounty game. Analyze the "
		f"following real weather observation:\n{summary}\n\n"
		"Derive how dangerous/extreme these conditions are for a physical quest "
		"action. Return STRICT JSON exactly of the form: "
		'{"multiplier": number, "risk_tier": string, "reasoning": string} '
		"where multiplier is a float between 1.0 (calm) and 5.0 (life-threatening), "
		"risk_tier is one of Low, Medium, High, Extreme, and reasoning is a "
		"one-sentence justification (<= 240 chars)."
	)
	raw = _run_prompt(prompt)
	if not isinstance(raw, dict):
		raise gl.vm.UserError(f"{ERROR_LLM} Weather LLM returned non-dict")

	mult_val = raw.get("multiplier")
	if mult_val is None:
		raise gl.vm.UserError(f"{ERROR_LLM} Weather LLM missing 'multiplier'")
	try:
		mult_x100 = int(round(float(str(mult_val).strip()) * 100))
	except (ValueError, TypeError):
		raise gl.vm.UserError(f"{ERROR_LLM} Non-numeric multiplier: {mult_val!r}")
	if mult_x100 < MULT_MIN:
		mult_x100 = MULT_MIN
	if mult_x100 > MULT_MAX:
		mult_x100 = MULT_MAX

	tier = _normalize_tier(raw.get("risk_tier"))
	reasoning = str(raw.get("reasoning", ""))[:240]
	return {
		"multiplier": mult_x100,
		"risk_tier": tier,
		"reasoning": reasoning,
		"summary": summary,
	}


def _judge_action(summary, tier, action):
	"""LLM decides whether the action is safe given the risk tier. Fail-closed."""
	prompt = (
		f"A bounty quest takes place under these conditions: {summary} "
		f"(risk tier: {tier}). A player wants to attempt: \"{action}\". Judge "
		"whether performing this action in these conditions is reasonably SAFE "
		"and would succeed. Cautious/adapted actions in Extreme weather can still "
		"succeed; reckless actions can fail. Return STRICT JSON exactly: "
		'{"success": boolean, "reasoning": string} where reasoning is one '
		"sentence (<= 240 chars)."
	)
	raw = _run_prompt(prompt)
	if not isinstance(raw, dict):
		raise gl.vm.UserError(f"{ERROR_LLM} Action LLM returned non-dict")

	success = raw.get("success")
	if success is None:
		for alt in ("safe", "passed", "ok"):
			if alt in raw:
				success = raw[alt]
				break
	if isinstance(success, str):
		success = success.strip().lower() in ("true", "yes", "1", "safe")
	if not isinstance(success, bool):
		raise gl.vm.UserError(f"{ERROR_LLM} Action LLM missing boolean 'success'")

	reasoning = str(raw.get("reasoning", ""))[:240]
	return {"success": success, "reasoning": reasoning}


def _resolve_submission(city, action):
	"""Leader body: derive weather multiplier AND judge the action in a single
	nondeterministic round. Returns decision fields only."""
	analysis = _analyze_weather(city)
	judgment = _judge_action(analysis["summary"], analysis["risk_tier"], action)
	return {
		"multiplier": analysis["multiplier"],
		"risk_tier": analysis["risk_tier"],
		"reasoning": analysis["reasoning"],
		"summary": analysis["summary"],
		"success": judgment["success"],
		"judgment_reasoning": judgment["reasoning"],
	}


# --- The contract -----------------------------------------------------------
class WeatherQuest(gl.Contract):
	# Quest registry
	quest_ids: DynArray[str]
	quest_count: u256

	# Per-quest state (parallel TreeMaps keyed by quest_id)
	city_of: TreeMap[str, str]
	creator_of: TreeMap[str, Address]
	base_reward_atto_of: TreeMap[str, u256]
	description_of: TreeMap[str, str]
	created_at_of: TreeMap[str, str]        # ISO
	expires_at_of: TreeMap[str, str]        # ISO
	status_of: TreeMap[str, str]
	submission_count_of: TreeMap[str, u256]
	last_multiplier_of: TreeMap[str, u256]  # hundredths
	last_tier_of: TreeMap[str, str]

	# player-submission guard: key = "<quest_id>|<address>"
	submitted_by: TreeMap[str, bool]

	# per-city preview cache
	city_multiplier: TreeMap[str, u256]

	# analytics indexes
	completed_count: u256
	failed_count: u256
	total_payout_atto: u256

	def __init__(self):
		self.quest_count = u256(0)
		self.completed_count = u256(0)
		self.failed_count = u256(0)
		self.total_payout_atto = u256(0)

	# -- Liquidity: fund the house so multipliers > 1x can be paid out ------
	@gl.public.write.payable
	def deposit(self):
		"""Accept GEN deposits to back payouts above each quest's locked base."""
		return None

	# -- Quest lifecycle -----------------------------------------------------
	@gl.public.write.payable
	def create_quest(self, city: str, base_reward: u256, description: str, expiry_hours: u256) -> str:
		city_clean = "" if city is None else str(city).strip()
		if len(city_clean) == 0:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} City must not be empty")
		if len(city_clean) > CITY_MAX:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} City too long (max {CITY_MAX})")

		if base_reward < ATTO_MIN or base_reward > ATTO_MAX:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} base_reward must be 1..1000 GEN")
		if expiry_hours < EXPIRY_MIN_HOURS or expiry_hours > EXPIRY_MAX_HOURS:
			raise gl.vm.UserError(
				f"{ERROR_EXPECTED} expiry_hours must be {EXPIRY_MIN_HOURS}..{EXPIRY_MAX_HOURS}"
			)
		desc = "" if description is None else str(description)
		if len(desc) > DESC_MAX:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Description too long (max {DESC_MAX})")

		# Escrow: the creator must lock exactly `base_reward` atto with the call.
		if gl.message.value != base_reward:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Must lock exactly base_reward GEN")

		sender = gl.message.sender_address
		quest_id = f"Q{self.quest_count}"
		now = _now()
		created = _iso(now)
		expires = _iso(now + timedelta(hours=int(expiry_hours)))

		self.city_of[quest_id] = city_clean
		self.creator_of[quest_id] = sender
		self.base_reward_atto_of[quest_id] = base_reward
		self.description_of[quest_id] = desc
		self.created_at_of[quest_id] = created
		self.expires_at_of[quest_id] = expires
		self.status_of[quest_id] = STATUS_ACTIVE
		self.submission_count_of[quest_id] = u256(0)
		self.last_multiplier_of[quest_id] = u256(0)
		self.last_tier_of[quest_id] = ""
		self.quest_ids.append(quest_id)
		self.quest_count = self.quest_count + 1
		return quest_id

	@gl.public.write
	def get_weather_multiplier(self, city: str) -> dict:
		"""Compute the live, validator-consensus weather multiplier for a city
		and cache it. This is a preview helper; the settlement path recomputes."""
		city_clean = "" if city is None else str(city).strip()
		if len(city_clean) == 0:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} City must not be empty")

		def leader_fn():
			return _analyze_weather(city_clean)

		def validator_fn(leader_res):
			if not isinstance(leader_res, gl.vm.Return):
				return _handle_leader_error(leader_res, lambda: _analyze_weather(city_clean))
			try:
				mine = _analyze_weather(city_clean)
			except Exception:
				return False
			ldr = leader_res.calldata
			if ldr["risk_tier"] != mine["risk_tier"]:
				return False
			return abs(ldr["multiplier"] - mine["multiplier"]) <= MULT_TOLERANCE

		analysis = gl.vm.run_nondet(leader_fn, validator_fn)
		self.city_multiplier[city_clean] = u256(analysis["multiplier"])
		return self._format_analysis(analysis)

	@gl.public.write
	def submit_action(self, quest_id: str, action: str) -> dict:
		action_clean = "" if action is None else str(action).strip()
		if len(action_clean) == 0:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Action must not be empty")
		if len(action_clean) > ACTION_MAX:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Action too long (max {ACTION_MAX})")

		if quest_id not in self.city_of:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Quest '{quest_id}' does not exist")
		if self.status_of[quest_id] != STATUS_ACTIVE:
			raise gl.vm.UserError(
				f"{ERROR_EXPECTED} Quest is {self.status_of[quest_id]}, not active"
			)
		if _now() >= _parse_iso(self.expires_at_of[quest_id]):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} This quest has expired")

		sender = gl.message.sender_address
		sub_key = f"{quest_id}|{str(sender)}"
		if self.submitted_by.get(sub_key, False):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} You already submitted for this quest")

		city = self.city_of[quest_id]

		def leader_fn():
			return _resolve_submission(city, action_clean)

		def validator_fn(leader_res):
			if not isinstance(leader_res, gl.vm.Return):
				return _handle_leader_error(leader_res, lambda: _resolve_submission(city, action_clean))
			try:
				mine = _resolve_submission(city, action_clean)
			except Exception:
				return False
			ldr = leader_res.calldata
			if ldr["risk_tier"] != mine["risk_tier"]:
				return False
			if abs(ldr["multiplier"] - mine["multiplier"]) > MULT_TOLERANCE:
				return False
			return bool(ldr["success"]) == bool(mine["success"])

		res = gl.vm.run_nondet(leader_fn, validator_fn)

		# Deterministic settlement — runs only after consensus on res.
		self.last_multiplier_of[quest_id] = u256(res["multiplier"])
		self.last_tier_of[quest_id] = res["risk_tier"]
		self.submitted_by[sub_key] = True
		self.submission_count_of[quest_id] = self.submission_count_of[quest_id] + 1

		base = self.base_reward_atto_of[quest_id]
		payout = u256((int(base) * int(res["multiplier"])) // 100)
		result = self._format_analysis(res)
		result["success"] = bool(res["success"])
		result["judgment_reasoning"] = res["judgment_reasoning"]
		result["quest_id"] = quest_id

		if res["success"]:
			if self.balance < payout:
				raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract balance insufficient for payout")
			gl.get_contract_at(sender).emit_transfer(value=payout, on="finalized")
			self.status_of[quest_id] = STATUS_COMPLETED
			self.completed_count = self.completed_count + 1
			self.total_payout_atto = self.total_payout_atto + payout
			result["payout"] = int(payout)
		else:
			refund = self.base_reward_atto_of[quest_id]
			if self.balance >= refund:
				gl.get_contract_at(self.creator_of[quest_id]).emit_transfer(value=refund, on="finalized")
			self.status_of[quest_id] = STATUS_FAILED
			self.failed_count = self.failed_count + 1
			result["payout"] = 0
		return result

	@gl.public.write
	def claim_expired_quest(self, quest_id: str):
		if quest_id not in self.city_of:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Quest '{quest_id}' does not exist")
		if gl.message.sender_address != self.creator_of[quest_id]:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the creator can claim")
		if self.status_of[quest_id] != STATUS_ACTIVE:
			raise gl.vm.UserError(
				f"{ERROR_EXPECTED} Quest is {self.status_of[quest_id]}, not claimable"
			)
		if _now() < _parse_iso(self.expires_at_of[quest_id]):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Quest has not expired yet")
		if self.submission_count_of[quest_id] > 0:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Quest received submissions")

		base = self.base_reward_atto_of[quest_id]
		if self.balance >= base:
			gl.get_contract_at(self.creator_of[quest_id]).emit_transfer(value=base, on="finalized")
		self.status_of[quest_id] = STATUS_CLAIMED

	# -- Read views ----------------------------------------------------------
	@gl.public.view
	def get_quest(self, quest_id: str) -> dict:
		if quest_id not in self.city_of:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Quest '{quest_id}' does not exist")
		return self._quest_dict(quest_id)

	@gl.public.view
	def list_quests(self) -> list:
		out = []
		for qid in self.quest_ids:
			out.append(self._quest_dict(qid))
		return out

	@gl.public.view
	def has_submitted(self, quest_id: str, account: Address) -> bool:
		return bool(self.submitted_by.get(f"{quest_id}|{str(account)}", False))

	@gl.public.view
	def contract_balance(self) -> u256:
		return self.balance

	# -- Formatting helpers --------------------------------------------------
	def _format_analysis(self, analysis) -> dict:
		mult = int(analysis["multiplier"])
		return {
			"city": self._city_from_summary(analysis["summary"]),
			"multiplier_x100": mult,
			"multiplier": _fmt_x100(mult),
			"risk_tier": analysis["risk_tier"],
			"reasoning": analysis["reasoning"],
			"summary": analysis["summary"],
		}

	def _quest_dict(self, quest_id) -> dict:
		base = int(self.base_reward_atto_of[quest_id])
		mult = int(self.last_multiplier_of[quest_id])
		expired = _now() >= _parse_iso(self.expires_at_of[quest_id])
		return {
			"quest_id": quest_id,
			"city": self.city_of[quest_id],
			"creator": str(self.creator_of[quest_id]),
			"base_reward_atto": base,
			"base_reward_gen": _fmt_atto(base),
			"description": self.description_of[quest_id],
			"created_at": self.created_at_of[quest_id],
			"expires_at": self.expires_at_of[quest_id],
			"status": self.status_of[quest_id],
			"expired": expired,
			"submission_count": int(self.submission_count_of[quest_id]),
			"last_multiplier_x100": mult,
			"last_risk_tier": self.last_tier_of[quest_id],
			"max_payout_atto": (base * mult) // 100 if mult else 0,
		}

	def _city_from_summary(self, summary) -> str:
		if summary.startswith("City="):
			rest = summary[len("City="):]
			sp = rest.find(" ")
			return rest[:sp] if sp != -1 else rest
		return ""
