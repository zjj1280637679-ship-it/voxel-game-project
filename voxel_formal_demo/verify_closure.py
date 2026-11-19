"""Minimal Logical Closure Verifier: 3 static invariant checks + 3x3 grid convergence test."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from engine import CompoundPulse, Entity, FormalEngine


def check_referential_integrity(eng: FormalEngine) -> list[str]:
    """Check 1: Every referenced prototype, mixin, tag, and item target exists."""
    errors: list[str] = []
    for pid, spec in eng.prototypes.items():
        parent = spec.get("parent")
        if parent is not None and parent not in eng.prototypes:
            errors.append(f"Missing parent {parent!r} on {pid}")
        for mixin in spec.get("mixins", []):
            if mixin not in eng.prototypes:
                errors.append(f"Missing mixin {mixin!r} on {pid}")
        corpse = spec.get("corpse_base")
        if corpse and corpse not in eng.prototypes:
            errors.append(f"Missing corpse_base {corpse!r} on {pid}")

    for (target, _cat), rows in eng.deathrattles.items():
        if target not in eng.prototypes:
            errors.append(f"Missing deathrattle target {target!r}")
        for row in rows:
            for tok in row["spawns"]:
                if tok not in ("$SPILL_CONTENTS", "$SELF_ITEM", "$CORPSE") and tok not in eng.prototypes:
                    errors.append(f"Missing spawn prototype {tok!r} in {target}")

    for req_counts, _trig, out_id in eng.recipes:
        for inp in req_counts:
            if inp not in eng.prototypes:
                errors.append(f"Missing recipe input {inp!r}")
        if out_id not in eng.prototypes:
            errors.append(f"Missing recipe output {out_id!r}")
    return errors


def _concrete_prototypes(eng: FormalEngine) -> list[str]:
    return [p for p in eng.prototypes if not p.startswith("@") and p != "EntityRoot"]


def check_gate_deathrattle_coverage(eng: FormalEngine) -> list[str]:
    """Check 2: Every penetrable gate (with any Atmo tag) has a fallback deathrattle."""
    errors: list[str] = []
    atmo_tags = [name for name, spec in eng.bits._defs.items() if spec["category"] == "Atmo"]
    atmo_masks = [0] + [eng.bits.parse(t) for t in atmo_tags]

    for pid in _concrete_prototypes(eng):
        ent = eng.spawn(pid)
        for node in eng.lookup_chain(ent):
            for (g_node, cat), rows in eng.gates.items():
                if g_node != node:
                    continue
                for req_mask, w in rows:
                    if w <= 0.0:
                        continue
                    # Ensure gate isn't shadowed by a higher-priority 0.0 weight block
                    probe = CompoundPulse(amount=1.0, channels={cat: (1.0, req_mask)})
                    for amask in atmo_masks:
                        scores = eng.eval_channel_scores(ent, probe, amask)
                        if cat not in scores:
                            continue
                        dr = eng.eval_deathrattle(ent, cat, req_mask | amask)
                        if dr is None:
                            errors.append(
                                f"Uncovered deathrattle: proto={pid}, cat={cat}, "
                                f"gate={eng.bits.format(req_mask)}, atmo={eng.bits.format(amask)}"
                            )
                        if "$SELF_ITEM" in dr["spawns"]:
                            expected_item = f"{pid}_Item"
                            if expected_item not in eng.prototypes:
                                errors.append(f"Missing $SELF_ITEM prototype {expected_item!r} for {pid}")
    return errors


def check_same_pulse_cycles(eng: FormalEngine) -> list[str]:
    """Check 3: No cycle or self-loop exists in transitions driven by the same gate pulse."""
    errors: list[str] = []
    distinct_pulses: set[tuple[str, int]] = set()
    for (_node, cat), rows in eng.gates.items():
        for req_mask, w in rows:
            if w > 0.0:
                distinct_pulses.add((cat, req_mask))

    for cat, req_mask in sorted(distinct_pulses):
        graph: dict[str, set[str]] = defaultdict(set)
        probe = CompoundPulse(amount=1.0, channels={cat: (1.0, req_mask)})
        for pid in _concrete_prototypes(eng):
            ent = eng.spawn(pid)
            scores = eng.eval_channel_scores(ent, probe, 0)
            if cat not in scores:
                continue
            dr = eng.eval_deathrattle(ent, cat, req_mask)
            if dr is None:
                continue
            spawns, _ = eng._materialize_spawns(ent, dr["spawns"], None)
            for sp in spawns:
                # Ignore intentional discrete toggle pairs (OakDoor_Closed <-> OakDoor_Open)
                if dr.get("preserve_hp") and sp.proto_id != pid:
                    continue
                graph[pid].add(sp.proto_id)

        state: dict[str, int] = {}  # 0=unvisited, 1=visiting, 2=done

        def dfs(u: str, path: list[str]) -> None:
            state[u] = 1
            for v in graph.get(u, ()):
                if v == u:
                    errors.append(f"Self-loop under ({cat}, {eng.bits.format(req_mask)}): {u} -> {v}")
                elif state.get(v, 0) == 1:
                    cycle = " -> ".join(path[path.index(v):] + [v])
                    errors.append(f"Cycle under ({cat}, {eng.bits.format(req_mask)}): {cycle}")
                elif state.get(v, 0) == 0:
                    dfs(v, path + [v])
            state[u] = 2

        for start in list(graph.keys()):
            if state.get(start, 0) == 0:
                dfs(start, [start])
    return errors


def check_spatial_grid_convergence(eng: FormalEngine, max_ticks: int = 30) -> tuple[bool, int, list[str]]:
    """Check 4: 3x3 chaotic sandbox converges to steady state within max_ticks."""
    B = eng.bits.parse
    wb = eng.spawn("Workbench")
    wb.chamber = [eng.spawn("Sulfur_Bit"), eng.spawn("Charcoal_Bit"), eng.spawn("Saltpeter_Bit")]

    grid: dict[tuple[int, int], list[Entity]] = {
        (0, 0): [eng.spawn("Fire")],
        (0, 1): [eng.spawn("OakPlank")],
        (0, 2): [wb],
        (1, 0): [eng.spawn("Ice")],
        (1, 1): [eng.spawn("Sheep_Live")],
        (1, 2): [eng.spawn("Sapling")],
        (2, 0): [eng.spawn("Water")],
        (2, 1): [eng.spawn("Stone")],
        (2, 2): [eng.spawn("Glass")],
    }
    base_atmo = B("Atmo_O2")
    decay_pulse = eng.simple_pulse(4.0, "Magic_Decay")

    def neighbors(x: int, y: int) -> list[tuple[int, int]]:
        return [
            (nx, ny)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
            if 0 <= nx < 3 and 0 <= ny < 3
        ]

    for tick in range(1, max_ticks + 1):
        # Compute cell atmosphere from local emitters (e.g. Water -> Atmo_Wet)
        cell_atmo: dict[tuple[int, int], int] = {pos: base_atmo for pos in grid}
        for (x, y), ents in grid.items():
            for e in ents:
                emits = eng.get_attr(e.proto_id, "emits_atmo")
                if emits:
                    am = B(emits)
                    cell_atmo[(x, y)] |= am
                    for nb in neighbors(x, y):
                        cell_atmo[nb] |= am

        pending: list[tuple[tuple[int, int], Entity, CompoundPulse]] = []
        for (x, y), ents in grid.items():
            for e in ents:
                if e.proto_id == "Fire":
                    pending.append(((x, y), e, decay_pulse))
                    emit_spec = eng.get_attr("Fire", "emits_pulse")
                    ep = eng.parse_spec_pulse(emit_spec)
                    for nb in neighbors(x, y):
                        for target in grid[nb]:
                            pending.append((nb, target, ep))
                if (cell_atmo[(x, y)] & B("Atmo_Wet")) and e.proto_id == "Fire":
                    pending.append(((x, y), e, eng.simple_pulse(1.0, "Atmo_Wet")))

        changed = False
        for pos, target, pulse in pending:
            if target not in grid[pos]:
                continue
            out = eng.apply_pulse(target, pulse, env_atmo=cell_atmo[pos])
            if out.status in ("damaged", "deathrattle"):
                changed = True
            if out.status == "deathrattle":
                grid[pos].remove(target)
                grid[pos].extend(out.spawns)
                grid[pos].extend(out.spilled)
                if out.aoe_pulse is not None:
                    for nb in [pos] + neighbors(*pos):
                        for sub in list(grid[nb]):
                            sub_out = eng.apply_pulse(sub, out.aoe_pulse, env_atmo=cell_atmo[nb])
                            if sub_out.status == "deathrattle":
                                grid[nb].remove(sub)
                                grid[nb].extend(sub_out.spawns)
                                grid[nb].extend(sub_out.spilled)
        if not changed:
            summary = [f"{pos}:{[e.proto_id for e in ents]}" for pos, ents in sorted(grid.items())]
            return True, tick, summary

    return False, max_ticks, []


def main() -> None:
    eng = FormalEngine(Path(__file__).with_name("rules.json"))

    e1 = check_referential_integrity(eng)
    print(f"[Check 1] 引用完整性: {len(e1)} 个错误")
    for err in e1:
        print("  !", err)

    e2 = check_gate_deathrattle_coverage(eng)
    print(f"[Check 2] 门控 -> 亡语全覆盖: {len(e2)} 个缺口")
    for err in e2:
        print("  !", err)

    e3 = check_same_pulse_cycles(eng)
    print(f"[Check 3] 同脉冲零环/零自环: {len(e3)} 个环路")
    for err in e3:
        print("  !", err)

    converged, ticks, summary = check_spatial_grid_convergence(eng)
    print(f"[Check 4] 3x3 混战沙盒收敛测试: converged={converged}, ticks={ticks}")
    for line in summary:
        print("  ", line)

    assert not e1 and not e2 and not e3 and converged, "Closure verification failed!"
    print("\n[OK] 全部 4 项形式化逻辑闭环检查通过！\n")


if __name__ == "__main__":
    main()
