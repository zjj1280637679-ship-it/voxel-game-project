"""Formal Voxel Engine Core: 4-category normalized compound pulses, weak-gate & winner-deathrattle."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class BitRegistry:
    """Compiles 4-category pulse tags into monotonic u32 bitmasks."""

    def __init__(self, pulse_defs: dict[str, dict[str, Any]]) -> None:
        self._defs = pulse_defs
        self._masks: dict[str, int] = {}
        self._cats: dict[str, str] = {}
        for name, spec in pulse_defs.items():
            self._cats[name] = spec["category"]
            self._resolve(name)

    def _resolve(self, name: str) -> int:
        if name in self._masks:
            return self._masks[name]
        spec = self._defs[name]
        mask = 1 << spec["bit"]
        for parent in spec.get("inherits", []):
            mask |= self._resolve(parent)
        self._masks[name] = mask
        return mask

    def parse(self, expr: str | list[str]) -> int:
        """Parses 'A | B' or ['A', 'B'] into a single u32 bitmask."""
        if not expr:
            return 0
        tokens = expr if isinstance(expr, list) else [t.strip() for t in expr.split("|")]
        mask = 0
        for tok in tokens:
            if tok:
                if tok not in self._masks:
                    raise KeyError(f"Unknown pulse tag: {tok}")
                mask |= self._masks[tok]
        return mask

    def split_by_category(self, expr: str | list[str]) -> dict[str, int]:
        """Splits a tag expression into per-category bitmasks."""
        tokens = expr if isinstance(expr, list) else [t.strip() for t in expr.split("|")]
        grouped: dict[str, int] = {}
        for tok in tokens:
            if tok:
                if tok not in self._masks:
                    raise KeyError(f"Unknown pulse tag: {tok}")
                cat = self._cats[tok]
                grouped[cat] = grouped.get(cat, 0) | self._masks[tok]
        return grouped

    def format(self, mask: int) -> str:
        """Formats a u32 bitmask into minimal human-readable tags."""
        if mask == 0:
            return "NONE"
        active = [name for name, m in self._masks.items() if (mask & m) == m]
        minimal = [
            name
            for name in active
            if not any(
                other != name and (self._masks[other] & self._masks[name]) == self._masks[name]
                for other in active
            )
        ]
        return " | ".join(minimal)


@dataclass(frozen=True)
class CompoundPulse:
    """Normalized compound pulse carrying per-category shares and bitmasks."""

    amount: float
    channels: dict[str, tuple[float, int]]  # category -> (normalized_share, mask)
    atmo_mask: int = 0

    @property
    def all_tags(self) -> int:
        mask = self.atmo_mask
        for _, m in self.channels.values():
            mask |= m
        return mask


@dataclass
class Entity:
    """Unified EntityBlock: blocks, plants, fluids, animals, corpses, projectiles, items, workbenches."""

    uid: int
    proto_id: str
    hp: float
    max_hp: float
    cell_atmo: int = 0
    chamber: list[Entity] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"{self.proto_id}#{self.uid}(hp={self.hp:.1f}/{self.max_hp:.1f})"


@dataclass
class PulseOutcome:
    """Traceable result of applying a CompoundPulse to an Entity."""

    target_before: str
    eff_atmo: int
    channel_scores: dict[str, float]
    winner_cat: str | None
    damage: float
    status: str  # "immune" | "damaged" | "crafted" | "deathrattle"
    spawns: list[Entity] = field(default_factory=list)
    spilled: list[Entity] = field(default_factory=list)
    aoe_pulse: CompoundPulse | None = None


class FormalEngine:
    """Weighted-normalization voxel engine: threshold gate -> argmax winner -> deathrattle + atmo."""

    def __init__(self, rules_path: str | Path) -> None:
        raw = json.loads(Path(rules_path).read_text(encoding="utf-8"))
        self.bits = BitRegistry(raw["pulse_bits"])
        self.prototypes: dict[str, dict[str, Any]] = raw["prototypes"]
        self._next_uid = 1

        # (target, category) -> [(req_mask, weight)] sorted by specificity desc
        self.gates: dict[tuple[str, str], list[tuple[int, float]]] = {}
        for row in raw["channel_gates"]:
            key = (row["target"], row["category"])
            self.gates.setdefault(key, []).append((self.bits.parse(row["req"]), float(row["weight"])))
        for rows in self.gates.values():
            rows.sort(key=lambda r: r[0].bit_count(), reverse=True)

        # (target, category) -> [(atmo_mask, mult)]
        self.atmo_mods: dict[tuple[str, str], list[tuple[int, float]]] = {}
        for row in raw.get("atmo_modifiers", []):
            key = (row["target"], row["category"])
            self.atmo_mods.setdefault(key, []).append((self.bits.parse(row["atmo"]), float(row["mult"])))

        # (target, category) -> [deathrattle_entry] sorted by sub_mask specificity desc
        self.deathrattles: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in raw["deathrattle_table"]:
            key = (row["target"], row["category"])
            entry = {
                "sub_mask": self.bits.parse(row.get("sub", "")),
                "spawns": row["spawns"],
                "preserve_hp": bool(row.get("preserve_hp", False)),
                "emit_aoe": row.get("emit_aoe"),
            }
            self.deathrattles.setdefault(key, []).append(entry)
        for rows in self.deathrattles.values():
            rows.sort(key=lambda r: r["sub_mask"].bit_count(), reverse=True)

        self.recipes: list[tuple[Counter[str], int, str]] = [
            (Counter(r["inputs"]), self.bits.parse(r["trigger_pulse"]), r["output"])
            for r in raw.get("workbench_recipes", [])
        ]

    def make_pulse(self, amount: float, atmo: str = "", **channels: tuple[float, str]) -> CompoundPulse:
        """Builds a normalized CompoundPulse from per-category (raw_weight, tag_expr) pairs."""
        total_w = sum(max(0.0, w) for w, _ in channels.values())
        if total_w <= 0.0:
            return CompoundPulse(amount=amount, channels={}, atmo_mask=self.bits.parse(atmo))
        norm = {
            cat: (w / total_w, self.bits.parse(expr))
            for cat, (w, expr) in channels.items()
            if w > 0.0
        }
        return CompoundPulse(amount=amount, channels=norm, atmo_mask=self.bits.parse(atmo))

    def simple_pulse(self, amount: float, expr: str) -> CompoundPulse:
        """Builds an evenly-weighted normalized pulse from a flat tag string like 'Mech_T2 | Atmo_NoO2'."""
        grouped = self.bits.split_by_category(expr)
        atmo_mask = grouped.pop("Atmo", 0)
        if not grouped and atmo_mask:
            # Pure atmosphere pulse (e.g. Toxic gas or Water extinguishing Fire)
            return CompoundPulse(amount=amount, channels={"Atmo": (1.0, atmo_mask)}, atmo_mask=atmo_mask)
        if not grouped:
            return CompoundPulse(amount=amount, channels={}, atmo_mask=atmo_mask)
        share = 1.0 / len(grouped)
        return CompoundPulse(amount=amount, channels={c: (share, m) for c, m in grouped.items()}, atmo_mask=atmo_mask)

    def parse_spec_pulse(self, spec: dict[str, Any]) -> CompoundPulse:
        """Constructs a CompoundPulse from JSON prototype/deathrattle spec."""
        ch_raw = spec.get("channels", {})
        channels = {c: (float(pair[0]), pair[1]) for c, pair in ch_raw.items()}
        return self.make_pulse(float(spec["amount"]), **channels)

    def spawn(self, proto_id: str, cell_atmo: int = 0, hp_override: float | None = None) -> Entity:
        """Instantiates an EntityBlock from the prototype tree."""
        base_hp = float(self.get_attr(proto_id, "hp", 100.0))
        scale = float(self.prototypes.get(proto_id, {}).get("hp_scale", 1.0))
        max_hp = base_hp * scale
        hp = max_hp if hp_override is None else min(hp_override, max_hp)
        uid = self._next_uid
        self._next_uid += 1
        return Entity(uid=uid, proto_id=proto_id, hp=hp, max_hp=max_hp, cell_atmo=cell_atmo)

    def get_attr(self, proto_id: str, key: str, default: Any = None) -> Any:
        """Resolves a prototype attribute up the parent chain."""
        cur: str | None = proto_id
        while cur is not None:
            node = self.prototypes.get(cur, {})
            if key in node:
                return node[key]
            cur = node.get("parent")
        return default

    def lookup_chain(self, entity: Entity) -> list[str]:
        """Resolution order: concrete proto -> its direct mixins -> ancestors -> ancestor mixins."""
        chain: list[str] = []
        seen: set[str] = set()
        cur: str | None = entity.proto_id
        while cur is not None:
            if cur not in seen:
                chain.append(cur)
                seen.add(cur)
            node = self.prototypes.get(cur, {})
            for m in node.get("mixins", []):
                if m not in seen:
                    chain.append(m)
                    seen.add(m)
            cur = node.get("parent")
        return chain

    def eval_channel_scores(
        self,
        entity: Entity,
        pulse: CompoundPulse,
        eff_atmo: int,
    ) -> dict[str, float]:
        """Evaluates each pulse channel against weak thresholds and applies atmo modifiers."""
        chain = self.lookup_chain(entity)
        scores: dict[str, float] = {}
        for cat, (share, cat_mask) in pulse.channels.items():
            base_w = 0.0
            for node in chain:
                matched = False
                for req_mask, w in self.gates.get((node, cat), []):
                    if (cat_mask & req_mask) == req_mask:
                        base_w = w
                        matched = True
                        break
                if matched:
                    break
            if base_w <= 0.0:
                continue

            atmo_mult = 1.0
            for node in chain:
                for atmo_bit, mult in self.atmo_mods.get((node, cat), []):
                    if (eff_atmo & atmo_bit) == atmo_bit:
                        atmo_mult *= mult
            eff = pulse.amount * share * base_w * atmo_mult
            if eff > 0.0:
                scores[cat] = eff
        return scores

    def eval_deathrattle(
        self,
        entity: Entity,
        winner_cat: str,
        combined_tags: int,
    ) -> dict[str, Any] | None:
        """Matches (entity chain, winner_cat, sub/atmo tags) with guaranteed category fallback."""
        for node in self.lookup_chain(entity):
            for entry in self.deathrattles.get((node, winner_cat), []):
                if (combined_tags & entry["sub_mask"]) == entry["sub_mask"]:
                    return entry
        return None

    def _try_workbench_craft(self, entity: Entity, all_tags: int) -> Entity | None:
        forwards = self.bits.parse(self.get_attr(entity.proto_id, "forwards_masks", []))
        if not entity.chamber or (all_tags & forwards) == 0:
            return None
        counts = Counter(item.proto_id for item in entity.chamber)
        for req_counts, trig_mask, output_id in self.recipes:
            if (all_tags & trig_mask) == trig_mask and counts == req_counts:
                entity.chamber.clear()
                crafted = self.spawn(output_id, cell_atmo=entity.cell_atmo)
                entity.chamber.append(crafted)
                return crafted
        return None

    def apply_pulse(
        self,
        entity: Entity,
        pulse: CompoundPulse,
        env_atmo: int = 0,
    ) -> PulseOutcome:
        """Core 3-step loop: threshold weights -> HP deduction -> argmax winner + atmo deathrattle."""
        before = entity.label
        crafted = self._try_workbench_craft(entity, pulse.all_tags)
        if crafted is not None:
            return PulseOutcome(before, env_atmo, {}, None, 0.0, "crafted", spawns=[crafted])

        eff_atmo = env_atmo | entity.cell_atmo | pulse.atmo_mask
        scores = self.eval_channel_scores(entity, pulse, eff_atmo)
        total_dmg = sum(scores.values())
        if total_dmg <= 0.0:
            return PulseOutcome(before, eff_atmo, scores, None, 0.0, "immune")

        winner_cat = max(scores, key=lambda c: scores[c])
        pre_hp = entity.hp
        entity.hp -= total_dmg
        if entity.hp > 0:
            return PulseOutcome(before, eff_atmo, scores, winner_cat, total_dmg, "damaged")

        combined_tags = pulse.all_tags | eff_atmo
        rule = self.eval_deathrattle(entity, winner_cat, combined_tags)
        if rule is None:
            return PulseOutcome(before, eff_atmo, scores, winner_cat, total_dmg, "deathrattle")

        spawns, spilled = self._materialize_spawns(entity, rule["spawns"], pre_hp if rule["preserve_hp"] else None)
        aoe = self.parse_spec_pulse(rule["emit_aoe"]) if rule["emit_aoe"] else None
        return PulseOutcome(before, eff_atmo, scores, winner_cat, total_dmg, "deathrattle", spawns=spawns, spilled=spilled, aoe_pulse=aoe)

    def _materialize_spawns(
        self,
        entity: Entity,
        tokens: list[str],
        preserved_hp: float | None,
    ) -> tuple[list[Entity], list[Entity]]:
        spawns: list[Entity] = []
        spilled: list[Entity] = []
        for tok in tokens:
            if tok == "$SPILL_CONTENTS":
                spilled.extend(entity.chamber)
                entity.chamber.clear()
            elif tok == "$SELF_ITEM":
                item_id = f"{entity.proto_id}_Item"
                spawns.append(self.spawn(item_id, cell_atmo=entity.cell_atmo))
            elif tok == "$CORPSE":
                corpse_id = self.get_attr(entity.proto_id, "corpse_base", "Ash_Item")
                spawns.append(self.spawn(corpse_id, cell_atmo=entity.cell_atmo))
            else:
                spawns.append(self.spawn(tok, cell_atmo=entity.cell_atmo, hp_override=preserved_hp))
        return spawns, spilled

    def collide(
        self,
        attacker: Entity,
        target: Entity,
        env_atmo: int = 0,
    ) -> tuple[PulseOutcome, PulseOutcome]:
        """Symmetric collision between projectile/pet and target."""
        atk_spec = self.get_attr(attacker.proto_id, "impact_pulse") or self.get_attr(attacker.proto_id, "contact_pulse")
        target_out = self.apply_pulse(target, self.parse_spec_pulse(atk_spec), env_atmo)

        recoil_spec = self.get_attr(target.proto_id, "recoil") or {"amount": 1, "mask": "Mech_Impact"}
        recoil_pulse = self.simple_pulse(float(recoil_spec["amount"]), recoil_spec["mask"])
        atk_out = self.apply_pulse(attacker, recoil_pulse, env_atmo)
        return target_out, atk_out
