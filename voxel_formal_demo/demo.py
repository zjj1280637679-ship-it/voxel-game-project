"""Verification Demo: Weighted normalized compound pulses & lightweight voxel interactions."""

from __future__ import annotations

from pathlib import Path

from engine import Entity, FormalEngine, PulseOutcome


def log_step(engine: FormalEngine, action: str, out: PulseOutcome) -> None:
    atmo_str = engine.bits.format(out.eff_atmo)
    scores_str = ", ".join(f"{k}:{v:.2f}" for k, v in out.channel_scores.items()) or "-"
    if out.status == "immune":
        print(f"  [{action}] -> {out.target_before} | 气场({atmo_str}) -> 势垒免疫 (0 伤)")
    elif out.status == "damaged":
        print(
            f"  [{action}] -> {out.target_before} | 各通道得分({scores_str}) "
            f"主导={out.winner_cat} 扣血={out.damage:.2f}"
        )
    elif out.status == "crafted":
        items = ", ".join(s.label for s in out.spawns)
        print(f"  [{action}] -> {out.target_before} | 工作台隔离合成 -> [{items}]")
    else:
        spawns = ", ".join(s.label for s in out.spawns) or "消散"
        extra = f" | 散落隔离物: {[x.label for x in out.spilled]}" if out.spilled else ""
        print(
            f"  [{action}] -> {out.target_before} | 各通道得分({scores_str}) "
            f"主因={out.winner_cat} 气场({atmo_str}) 亡语 -> [{spawns}]{extra}"
        )


def run_all_demos() -> None:
    eng = FormalEngine(Path(__file__).with_name("rules.json"))
    P = eng.simple_pulse
    M = eng.make_pulse
    B = eng.bits.parse

    # ------------------------------------------------------------------
    print("\n=== 场景 1：复合脉冲权重归一化（火焰战斧在不同木/湿/石上的平滑切换） ===")
    # 火焰附魔铁斧：总强度 50，热力占比 0.55 (Heat_T2)，机械占比 0.45 (Mech_T2 | Sharp)
    flame_axe = M(50.0, Mech=(0.45, "Mech_T2 | Mech_Sharp"), Thermo=(0.55, "Thermo_Heat_T2"))

    # 1A: 砍干木板 -> Mech = 50*0.45*2.5 = 56.25 vs Thermo = 50*0.55*1.2 = 33.0
    # 若换成偏向火焰的火把重锤: Thermo=0.70, Mech=0.30 (非Sharp)
    torch_club = M(60.0, Mech=(0.30, "Mech_T1"), Thermo=(0.70, "Thermo_Heat_T2"))

    dry_plank = eng.spawn("OakPlank", cell_atmo=B("Atmo_O2"))
    out_dry = eng.apply_pulse(dry_plank, torch_club)
    log_step(eng, "火棒砸干燥木板", out_dry)
    # Mech = 60*0.30*0.8 = 14.4 vs Thermo = 60*0.70*1.2 = 50.4 -> Thermo 胜出烧毁!
    assert out_dry.status == "deathrattle" and out_dry.winner_cat == "Thermo"
    assert [s.proto_id for s in out_dry.spawns] == ["Fire", "Ash_Item"]

    wet_plank = eng.spawn("OakPlank", cell_atmo=B("Atmo_Wet"))
    out_wet = eng.apply_pulse(wet_plank, torch_club)
    log_step(eng, "同一根火棒砸潮湿木板", out_wet)
    # Atmo_Wet 把 Thermo 压到 0.15x: Thermo = 50.4*0.15 = 7.56 < Mech = 14.4 -> Mech 胜出!
    assert out_wet.winner_cat == "Mech" and out_wet.damage == 14.4 + 7.56
    out_wet2 = eng.apply_pulse(wet_plank, torch_club)
    log_step(eng, "再补一棒砸碎潮湿木板", out_wet2)
    assert out_wet2.status == "deathrattle" and out_wet2.winner_cat == "Mech"
    assert [s.proto_id for s in out_wet2.spawns] == ["OakPlank_Item"]

    obsidian = eng.spawn("Obsidian")
    out_obs_fail = eng.apply_pulse(obsidian, flame_axe)
    log_step(eng, "火焰铁斧(Mech_T2)砍黑曜石", out_obs_fail)
    assert out_obs_fail.status == "immune"  # Mech_T2 未过 T3 门槛，Heat_T2 未过 T3 门槛

    diamond_axe = M(40.0, Mech=(0.8, "Mech_T3"), Thermo=(0.2, "Thermo_Heat_T2"))
    out_obs_ok = eng.apply_pulse(obsidian, diamond_axe)
    log_step(eng, "附魔钻镐(Mech_T3)敲黑曜石", out_obs_ok)
    assert out_obs_ok.status == "deathrattle" and out_obs_ok.winner_cat == "Mech"
    assert out_obs_ok.spawns[0].proto_id == "Obsidian_Item"

    # ------------------------------------------------------------------
    print("\n=== 场景 2：异形体继承、门开关保留残血、缺氧炭化 ===")
    slab = eng.spawn("OakPlank_Slab")  # hp = 40 * 0.5 = 20
    out_s1 = eng.apply_pulse(slab, P(6, "Mech_T1 | Mech_Sharp"))  # 6 * 2.5 = 15 dmg -> 5 left
    log_step(eng, "斧砍半砖留5血", out_s1)
    assert slab.hp == 5.0

    out_s2 = eng.apply_pulse(slab, P(6, "Thermo_Heat_T2 | Atmo_NoO2"))
    log_step(eng, "密闭缺氧明火烧残血半砖", out_s2)
    assert out_s2.spawns[0].proto_id == "Charcoal_Item"

    door = eng.spawn("OakDoor_Closed")  # hp = 32
    eng.apply_pulse(door, P(8, "Mech_T1 | Mech_Sharp"))  # -20 -> 12 left
    out_door_open = eng.apply_pulse(door, P(1, "Mech_Toggle"))
    log_step(eng, "右键开关木门", out_door_open)
    assert out_door_open.spawns[0].proto_id == "OakDoor_Open" and out_door_open.spawns[0].hp == 12.0

    # ------------------------------------------------------------------
    print("\n=== 场景 3：轻量直觉交互（冰水互转 + 活羊直出熟肉/尸体双路线） ===")
    ice = eng.spawn("Ice")
    out_melt = eng.apply_pulse(ice, P(25, "Thermo_Heat_T1"))
    log_step(eng, "冰遇热融化", out_melt)
    water = out_melt.spawns[0]
    assert water.proto_id == "Water"

    fire = eng.spawn("Fire")
    out_quench = eng.apply_pulse(fire, P(1, "Atmo_Wet"))
    log_step(eng, "水汽扑灭火焰", out_quench)
    assert out_quench.status == "deathrattle" and out_quench.spawns == []

    sheep_fire = eng.spawn("Sheep_Live")
    out_roast = eng.apply_pulse(sheep_fire, P(40, "Thermo_Heat_T2"))
    log_step(eng, "火焰直接烤死活羊", out_roast)
    assert [s.proto_id for s in out_roast.spawns] == ["CookedMutton_Item", "CookedMutton_Item", "Ash_Item"]

    sheep_hunt = eng.spawn("Sheep_Live")
    out_corpse = eng.apply_pulse(sheep_hunt, P(45, "Mech_T1"))
    log_step(eng, "物理击杀羊生成尸体", out_corpse)
    corpse = out_corpse.spawns[0]
    out_butcher = eng.apply_pulse(corpse, P(35, "Mech_T1 | Mech_Sharp | Mech_Gentle"))
    log_step(eng, "小刀精准屠宰尸体", out_butcher)
    assert [s.proto_id for s in out_butcher.spawns] == ["RawMutton_Item", "RawMutton_Item", "IntactWool_Item", "Bone_Item"]

    # ------------------------------------------------------------------
    print("\n=== 场景 4：投射物穿透、劈爆火球与同源召唤兽 ===")
    arrow = eng.spawn("Arrow_Wood")
    glass = eng.spawn("Glass")
    stone = eng.spawn("Stone")
    t1, a1 = eng.collide(arrow, glass)
    log_step(eng, "木箭击穿玻璃", t1)
    assert t1.status == "deathrattle" and a1.status == "damaged" and arrow.hp == 1.0
    t2, a2 = eng.collide(arrow, stone)
    log_step(eng, "木箭余势撞断石墙", a2)
    assert a2.spawns[0].proto_id == "BrokenStick_Item"

    orb = eng.spawn("HomingOrb_Fire")
    out_parry = eng.apply_pulse(orb, P(5, "Mech_T1 | Mech_Sharp"))
    log_step(eng, "半空劈散追踪火球", out_parry)
    assert out_parry.spawns[0].proto_id == "Ash_Item"

    wisp = eng.spawn("SummonedWisp")
    live_target = eng.spawn("Sheep_Live")
    wt, ws = eng.collide(wisp, live_target)
    log_step(eng, "同源召唤火灵灼烧活羊", wt)
    log_step(eng, "火灵受1点反冲继续存活", ws)
    assert wt.status == "damaged" and ws.status == "damaged" and wisp.hp == 49.0

    # ------------------------------------------------------------------
    print("\n=== 场景 5：工作台隔离合成与打破隔离殉爆 ===")
    wb = eng.spawn("Workbench")
    wb.chamber = [eng.spawn("Sulfur_Bit"), eng.spawn("Charcoal_Bit"), eng.spawn("Saltpeter_Bit")]
    assert eng.apply_pulse(wb, P(10, "Thermo_Heat_T1 | Atmo_Wet")).status == "immune"
    out_craft = eng.apply_pulse(wb, P(1, "Mech_Toggle"))
    log_step(eng, "安全工作台合成火药", out_craft)
    assert out_craft.status == "crafted" and wb.chamber[0].proto_id == "Gunpowder_Pack"

    wb_burn = eng.spawn("Workbench", cell_atmo=B("Atmo_O2"))
    wb_burn.chamber = [eng.spawn("Sulfur_Bit"), eng.spawn("Charcoal_Bit"), eng.spawn("Saltpeter_Bit")]
    out_spill = eng.apply_pulse(wb_burn, P(80, "Thermo_Heat_T2"))
    log_step(eng, "大火烧穿工作台打破隔离", out_spill)
    assert len(out_spill.spilled) == 3
    for bit in out_spill.spilled:
        det = eng.apply_pulse(bit, P(20, "Thermo_Heat_T2"))
        log_step(eng, f"外泄的 {bit.proto_id} 遇火反应", det)

    print("\n[OK] 权重归一化版 5 大场景全部通过！\n")


if __name__ == "__main__":
    run_all_demos()
