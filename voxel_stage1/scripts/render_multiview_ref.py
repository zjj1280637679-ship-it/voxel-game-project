#!/usr/bin/env python3
"""
Validate rigged/static voxel JSON assets and render 5-view studio reference sheets:
  1. <prefix>_multiview_clean.png     (Clean turnaround sheet for Image-Gen style reference)
  2. <prefix>_multiview_annotated.png (Engineering blueprint with rulers, pivots & palette)

Coordinate convention (matches src/render/riggedVoxel.ts):
  +Z = Front (visor / chest / weapon / prow)
  +Y = Up    (minY voxel integer MUST equal 0; floor sits at Y = 0.0)
  +X = Left side (shield)   |   -X = Right side (sword)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont


BG_HEX = (241, 245, 249)  # #F1F5F9 studio light slate


def hex_to_linear_rgb(hex_str: str) -> np.ndarray:
    h = hex_str.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"Invalid hex color: {hex_str}")
    srgb = np.array([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)], dtype=np.float32) / 255.0
    return np.power(srgb, 2.2)


def hex_to_srgb_tuple(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        [
            r"C:\Windows\Fonts\msyhbd.ttc",
            r"C:\Windows\Fonts\simhei.ttf",
            r"C:\Windows\Fonts\msyh.ttc",
        ]
        if bold
        else [
            r"C:\Windows\Fonts\msyh.ttc",
            r"C:\Windows\Fonts\segoeui.ttf",
            r"C:\Windows\Fonts\arial.ttf",
        ]
    )
    for path in candidates:
        p = Path(path)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def validate_asset(data: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    for req in ("palette", "parts", "rig", "voxels"):
        if req not in data:
            errors.append(f"Missing top-level field '{req}'")
    if errors:
        raise ValueError("; ".join(errors))

    palette = data["palette"]
    parts = data["parts"]
    rig = data["rig"]
    voxels = data["voxels"]

    if not isinstance(palette, list) or len(palette) == 0:
        errors.append("palette must be a non-empty list")
    if not isinstance(parts, list) or len(parts) == 0:
        errors.append("parts must be a non-empty list")
    if not isinstance(rig, dict):
        errors.append("rig must be a dict")
    if not isinstance(voxels, list) or len(voxels) == 0:
        errors.append("voxels must be a non-empty list")
    if errors:
        raise ValueError("; ".join(errors))

    # 1. Check rig / parts hierarchy & topological order
    part_set = set(parts)
    rig_set = set(rig.keys())
    if part_set != rig_set:
        missing_rig = part_set - rig_set
        extra_rig = rig_set - part_set
        if missing_rig:
            errors.append(f"parts missing from rig: {sorted(missing_rig)}")
        if extra_rig:
            errors.append(f"rig entries missing from parts: {sorted(extra_rig)}")

    part_order = {name: idx for idx, name in enumerate(parts)}
    root_count = 0
    for name in parts:
        spec = rig.get(name)
        if not spec:
            continue
        parent = spec.get("parent")
        pivot = spec.get("pivot")
        if not isinstance(pivot, list) or len(pivot) != 3 or not all(isinstance(v, (int, float)) for v in pivot):
            errors.append(f"rig['{name}'].pivot must be 3 finite numbers")
        if parent is None:
            root_count += 1
        else:
            if parent not in rig:
                errors.append(f"rig['{name}'].parent='{parent}' does not exist in rig")
            elif part_order.get(parent, 10**9) >= part_order[name]:
                errors.append(f"parent bone '{parent}' must appear before child '{name}' in parts")
    if root_count == 0:
        errors.append("rig has no root bone with parent=null")

    # Cycle detection
    for start in parts:
        seen = set()
        curr: str | None = start
        while curr is not None and curr in rig:
            if curr in seen:
                errors.append(f"cycle detected in rig around '{curr}'")
                break
            seen.add(curr)
            curr = rig[curr].get("parent")

    # 2. Check voxels & bounds
    seen_per_part: list[set[tuple[int, int, int]]] = [set() for _ in parts]
    part_counts = [0] * len(parts)
    dup_count = 0
    non_int_count = 0
    oob_mat = 0
    oob_part = 0

    min_x = min_y = min_z = 10**9
    max_x = max_y = max_z = -(10**9)

    for i, v in enumerate(voxels):
        if not isinstance(v, list) or len(v) != 5:
            errors.append(f"voxel[{i}] must be 5-element array [x,y,z,matIdx,partIdx]")
            break
        x, y, z, mat_idx, part_idx = v
        if not all(isinstance(n, int) and not isinstance(n, bool) for n in (x, y, z, mat_idx, part_idx)):
            non_int_count += 1
            continue
        if not (0 <= mat_idx < len(palette)):
            oob_mat += 1
            continue
        if not (0 <= part_idx < len(parts)):
            oob_part += 1
            continue
        key = (x, y, z)
        if key in seen_per_part[part_idx]:
            dup_count += 1
            continue
        seen_per_part[part_idx].add(key)
        part_counts[part_idx] += 1
        if x < min_x:
            min_x = x
        if x > max_x:
            max_x = x
        if y < min_y:
            min_y = y
        if y > max_y:
            max_y = y
        if z < min_z:
            min_z = z
        if z > max_z:
            max_z = z

    if non_int_count:
        errors.append(f"{non_int_count} voxels have non-integer coordinates/indices")
    if oob_mat:
        errors.append(f"{oob_mat} voxels have out-of-range matIdx")
    if oob_part:
        errors.append(f"{oob_part} voxels have out-of-range partIdx")
    if dup_count:
        errors.append(f"{dup_count} duplicate (x,y,z) voxels within same partIdx")
    if min_y != 0:
        errors.append(f"minY must equal 0 so boots/base sit flush on ground, got minY={min_y}")

    empty_parts = [parts[i] for i, cnt in enumerate(part_counts) if cnt == 0]
    if empty_parts:
        warnings.append(f"empty bones with 0 voxels: {empty_parts}")

    # 3. Optional animations check
    anim_names: list[str] = []
    animations = data.get("animations")
    if animations is not None:
        if not isinstance(animations, dict):
            errors.append("animations must be an object/dict")
        else:
            for anim_name, clip in animations.items():
                anim_names.append(anim_name)
                if not isinstance(clip, dict):
                    errors.append(f"animations['{anim_name}'] must be an object")
                    continue
                tracks = clip.get("tracks", {})
                if not isinstance(tracks, dict):
                    errors.append(f"animations['{anim_name}'].tracks must be an object")
                    continue
                for bone_name, kfs in tracks.items():
                    if bone_name not in part_set:
                        errors.append(f"animations['{anim_name}'].tracks['{bone_name}'] unknown bone")
                    prev_t = -1.0
                    for k_idx, kf in enumerate(kfs):
                        t = kf.get("t", -1.0)
                        if not isinstance(t, (int, float)) or not (0.0 <= t <= 1.0) or t <= prev_t:
                            errors.append(
                                f"animations['{anim_name}'].tracks['{bone_name}'][{k_idx}].t={t} invalid/not ascending"
                            )
                        prev_t = float(t)
                        for vec_key in ("rot", "pos"):
                            if vec_key in kf:
                                arr = kf[vec_key]
                                if (
                                    not isinstance(arr, list)
                                    or len(arr) != 3
                                    or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in arr)
                                ):
                                    errors.append(
                                        f"animations['{anim_name}'].tracks['{bone_name}'][{k_idx}].{vec_key} invalid"
                                    )
                    if clip.get("loop") and len(kfs) >= 2:
                        if kfs[0].get("t") == 0 and kfs[-1].get("t") == 1:
                            if kfs[0].get("rot") != kfs[-1].get("rot") or kfs[0].get("pos") != kfs[-1].get("pos"):
                                warnings.append(
                                    f"animations['{anim_name}'].tracks['{bone_name}'] loop start/end keyframes differ"
                                )

    summary = {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "voxelCount": len(voxels),
        "bounds": (min_x, max_x, min_y, max_y, min_z, max_z),
        "partCounts": dict(zip(parts, part_counts)),
        "animations": anim_names,
    }
    return summary


class VoxelScene:
    def __init__(self, data: dict[str, Any], bounds: tuple[int, int, int, int, int, int]) -> None:
        min_x, max_x, min_y, max_y, min_z, max_z = bounds
        self.min_x = min_x
        self.max_x = max_x
        self.min_y = min_y
        self.max_y = max_y
        self.min_z = min_z
        self.max_z = max_z

        self.sx = max_x - min_x + 1
        self.sy = max_y - min_y + 1
        self.sz = max_z - min_z + 1

        # Padded grid (+1 on every border) for branchless AO lookup
        self.grid = np.full((self.sx + 2, self.sy + 2, self.sz + 2), -1, dtype=np.int16)
        for x, y, z, mat_idx, _part_idx in data["voxels"]:
            self.grid[x - min_x + 1, y - min_y + 1, z - min_z + 1] = mat_idx

        self.palette_lin = np.stack([hex_to_linear_rgb(p["hex"]) for p in data["palette"]], axis=0)
        # Center of world model in grid coordinates [0..sx, 0..sy, 0..sz]
        # Note: voxel (wx, wy, wz) spans [wx-min_x, wx-min_x+1] in grid coords,
        # so world center (x, y, z) = grid (x - min_x + 0.5, y - min_y, z - min_z + 0.5).
        self.grid_center = np.array([self.sx * 0.5, self.sy * 0.5, self.sz * 0.5], dtype=np.float32)

    def trace_dda(
        self, ro: np.ndarray, rd: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Vectorized 3D DDA over padded grid [0..sx, 0..sy, 0..sz].
        Returns (hit_mask, hit_mat, hit_cell_xyz, hit_normal_xyz, hit_pos_xyz).
        """
        n_rays = ro.shape[0]
        hit_mask = np.zeros(n_rays, dtype=bool)
        hit_mat = np.full(n_rays, -1, dtype=np.int16)
        hit_cell = np.zeros((n_rays, 3), dtype=np.int32)
        hit_normal = np.zeros((n_rays, 3), dtype=np.int32)
        hit_pos = np.zeros((n_rays, 3), dtype=np.float32)

        dims = np.array([self.sx, self.sy, self.sz], dtype=np.float32)

        # Ray-AABB intersection with grid box [0, sx] x [0, sy] x [0, sz]
        inv_rd = np.full_like(rd, 1e12, dtype=np.float32)
        np.divide(1.0, rd, out=inv_rd, where=np.abs(rd) > 1e-8)
        t0 = (0.0 - ro) * inv_rd
        t1 = (dims - ro) * inv_rd
        t_min_axes = np.minimum(t0, t1)
        t_max_axes = np.maximum(t0, t1)
        t_enter = np.max(t_min_axes, axis=1)
        t_exit = np.min(t_max_axes, axis=1)

        # Determine entry face normal
        enter_axis = np.argmax(t_min_axes, axis=1)
        sign_rd = np.where(rd >= 0.0, 1, -1).astype(np.int32)
        entry_norm = np.zeros((n_rays, 3), dtype=np.int32)
        idx_all = np.arange(n_rays)
        entry_norm[idx_all, enter_axis] = -sign_rd[idx_all, enter_axis]

        valid = (t_exit > np.maximum(t_enter, 0.0)) & (t_exit > 1e-5)
        active = np.nonzero(valid)[0]
        if active.size == 0:
            return hit_mask, hit_mat, hit_cell, hit_normal, hit_pos

        t_start = np.maximum(t_enter[active], 0.0) + 1e-4
        pos = ro[active] + rd[active] * t_start[:, None]
        cell = np.floor(pos).astype(np.int32)
        dims_i = np.array([self.sx - 1, self.sy - 1, self.sz - 1], dtype=np.int32)
        cell = np.clip(cell, 0, dims_i)

        step = sign_rd[active]
        rd_a = rd[active]
        inv_a = np.full_like(rd_a, 1e12, dtype=np.float32)
        np.divide(1.0, np.abs(rd_a), out=inv_a, where=np.abs(rd_a) > 1e-8)
        next_bound = np.where(step > 0, cell + 1.0, cell.astype(np.float32))
        t_max = np.full_like(rd_a, 1e12, dtype=np.float32)
        np.divide(next_bound - pos, rd_a, out=t_max, where=np.abs(rd_a) > 1e-8)
        t_cur = t_start.astype(np.float32)
        cur_norm = entry_norm[active]

        max_steps = self.sx + self.sy + self.sz + 4
        for _ in range(max_steps):
            in_bounds = (
                (cell[:, 0] >= 0)
                & (cell[:, 0] < self.sx)
                & (cell[:, 1] >= 0)
                & (cell[:, 1] < self.sy)
                & (cell[:, 2] >= 0)
                & (cell[:, 2] < self.sz)
            )
            if not np.any(in_bounds):
                break

            if not np.all(in_bounds):
                active = active[in_bounds]
                cell = cell[in_bounds]
                step = step[in_bounds]
                inv_a = inv_a[in_bounds]
                t_max = t_max[in_bounds]
                t_cur = t_cur[in_bounds]
                cur_norm = cur_norm[in_bounds]

            mats = self.grid[cell[:, 0] + 1, cell[:, 1] + 1, cell[:, 2] + 1]
            found = mats >= 0
            if np.any(found):
                hit_ids = active[found]
                hit_mask[hit_ids] = True
                hit_mat[hit_ids] = mats[found]
                hit_cell[hit_ids] = cell[found]
                hit_normal[hit_ids] = cur_norm[found]
                hit_pos[hit_ids] = ro[hit_ids] + rd[hit_ids] * t_cur[found, None]

                keep = ~found
                if not np.any(keep):
                    break
                active = active[keep]
                cell = cell[keep]
                step = step[keep]
                inv_a = inv_a[keep]
                t_max = t_max[keep]
                t_cur = t_cur[keep]
                cur_norm = cur_norm[keep]

            # Step along axis with smallest t_max
            axis = np.argmin(t_max, axis=1)
            row_idx = np.arange(active.size)
            t_cur = t_max[row_idx, axis]
            cell[row_idx, axis] += step[row_idx, axis]
            t_max[row_idx, axis] += inv_a[row_idx, axis]
            cur_norm.fill(0)
            cur_norm[row_idx, axis] = -step[row_idx, axis]

        return hit_mask, hit_mat, hit_cell, hit_normal, hit_pos

    def compute_corner_ao(
        self, cell: np.ndarray, normal: np.ndarray, pos: np.ndarray
    ) -> np.ndarray:
        """
        Computes smooth bilinear 4-corner voxel Ambient Occlusion in [0.52, 1.0].
        """
        n_hits = cell.shape[0]
        if n_hits == 0:
            return np.zeros(0, dtype=np.float32)

        frac = np.clip(pos - cell.astype(np.float32), 0.0, 1.0)
        n_axis = np.argmax(np.abs(normal), axis=1)

        # Tangent axes per normal axis:
        # 0(X) -> (1:Y, 2:Z), 1(Y) -> (0:X, 2:Z), 2(Z) -> (0:X, 1:Y)
        u_axis = np.where(n_axis == 0, 1, 0)
        v_axis = np.where(n_axis == 2, 1, 2)

        idx = np.arange(n_hits)
        u = frac[idx, u_axis]
        v = frac[idx, v_axis]

        air = cell + 1 + normal  # already in padded grid coords [0..dim+1]

        eu = np.zeros((n_hits, 3), dtype=np.int32)
        ev = np.zeros((n_hits, 3), dtype=np.int32)
        eu[idx, u_axis] = 1
        ev[idx, v_axis] = 1

        def occ_at(su: int, sv: int) -> np.ndarray:
            p_s1 = air + su * eu
            p_s2 = air + sv * ev
            p_c = air + su * eu + sv * ev
            s1 = (self.grid[p_s1[:, 0], p_s1[:, 1], p_s1[:, 2]] >= 0).astype(np.int32)
            s2 = (self.grid[p_s2[:, 0], p_s2[:, 1], p_s2[:, 2]] >= 0).astype(np.int32)
            c = (self.grid[p_c[:, 0], p_c[:, 1], p_c[:, 2]] >= 0).astype(np.int32)
            occ = np.where((s1 & s2) == 1, 3, s1 + s2 + c)
            return 1.0 - 0.16 * occ.astype(np.float32)

        ao00 = occ_at(-1, -1)
        ao10 = occ_at(+1, -1)
        ao01 = occ_at(-1, +1)
        ao11 = occ_at(+1, +1)

        ao = (
            (1.0 - u) * (1.0 - v) * ao00
            + u * (1.0 - v) * ao10
            + (1.0 - u) * v * ao01
            + u * v * ao11
        )

        # Subtle edge bevel darkening on outer 4% border of each voxel face
        du = np.minimum(u, 1.0 - u)
        dv = np.minimum(v, 1.0 - v)
        edge = np.minimum(du, dv)
        bevel = np.where(edge < 0.045, 0.962 + (edge / 0.045) * 0.038, 1.0).astype(np.float32)
        return (ao * bevel).astype(np.float32)

    def render_ortho_view(
        self,
        width: int,
        height: int,
        rd_dir: tuple[float, float, float],
        px_per_vox: float,
        ground_screen_y: float,
        fixed_sun_dir: tuple[float, float, float] | None = None,
        ssaa: int = 1,
        draw_ground_shadow: bool = False,
    ) -> np.ndarray:
        """
        Renders a single view onto studio background #F1F5F9 returning uint8 (H, W, 3).
        """
        rw = width * ssaa
        rh = height * ssaa
        scale = px_per_vox * ssaa
        gy_px = ground_screen_y * ssaa

        rd = np.array(rd_dir, dtype=np.float32)
        rd /= np.linalg.norm(rd)
        world_up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        right = np.cross(rd, world_up).astype(np.float32)
        right /= np.linalg.norm(right)
        cam_up = np.cross(right, rd).astype(np.float32)
        cam_up /= np.linalg.norm(cam_up)

        # Focus center in grid space: anchor vertically around Y = 0 if ortho,
        # or center of model for 3/4 ISO.
        if abs(float(rd[1])) < 1e-4:
            # Horizontal ortho: align pixel gy_px strictly to grid Y = 0.0!
            focus = np.array([self.sx * 0.5, 0.0, self.sz * 0.5], dtype=np.float32)
            base_origin = focus - rd * 120.0
            xs = (np.arange(rw, dtype=np.float32) + 0.5 - rw * 0.5) / scale
            ys = (gy_px - (np.arange(rh, dtype=np.float32) + 0.5)) / scale
        else:
            # 3/4 ISO: focus at model center positioned neatly at gy_px center
            focus = np.array([self.sx * 0.5, self.sy * 0.44, self.sz * 0.5], dtype=np.float32)
            base_origin = focus - rd * 120.0
            xs = (np.arange(rw, dtype=np.float32) + 0.5 - rw * 0.5) / scale
            ys = (gy_px - (np.arange(rh, dtype=np.float32) + 0.5)) / scale

        gx_grid, gy_grid = np.meshgrid(xs, ys)
        ro = (
            base_origin[None, None, :]
            + gx_grid[:, :, None] * right[None, None, :]
            + gy_grid[:, :, None] * cam_up[None, None, :]
        ).reshape(-1, 3)
        rd_all = np.broadcast_to(rd[None, :], (ro.shape[0], 3)).copy()

        hit_mask, hit_mat, hit_cell, hit_normal, hit_pos = self.trace_dda(ro, rd_all)

        # Background linear RGB
        bg_lin = np.power(np.array(BG_HEX, dtype=np.float32) / 255.0, 2.2)
        img_lin = np.broadcast_to(bg_lin[None, :], (ro.shape[0], 3)).copy()

        # Studio lighting direction
        if fixed_sun_dir is not None:
            sun_dir = np.array(fixed_sun_dir, dtype=np.float32)
        else:
            sun_dir = 0.48 * right + 0.72 * cam_up - 0.50 * rd
        sun_dir /= np.linalg.norm(sun_dir)

        # Optional soft studio ground contact shadow on Y = 0.0 plane (3/4 ISO)
        if draw_ground_shadow and abs(float(rd[1])) > 1e-4:
            miss_ids = np.nonzero(~hit_mask)[0]
            if miss_ids.size > 0:
                ro_m = ro[miss_ids]
                t_g = -ro_m[:, 1] / float(rd[1])
                valid_g = t_g > 0.0
                if np.any(valid_g):
                    g_ids = miss_ids[valid_g]
                    g_pos = ro_m[valid_g] + rd[None, :] * t_g[valid_g, None]
                    dx = g_pos[:, 0] - self.sx * 0.5
                    dz = g_pos[:, 2] - self.sz * 0.5
                    r_sq = dx * dx + dz * dz
                    near_floor = r_sq < (max(self.sx, self.sz) * 1.15) ** 2
                    if np.any(near_floor):
                        f_ids = g_ids[near_floor]
                        f_pos = g_pos[near_floor]
                        # Soft ambient contact ellipse shadow
                        ell_r = np.hypot(dx[near_floor] / (self.sx * 0.52), dz[near_floor] / (self.sz * 0.68))
                        ambient_occ = np.where(ell_r < 1.25, 0.14 * np.clip(1.0 - (ell_r / 1.25) ** 2, 0.0, 1.0), 0.0)
                        # Directional cast sun shadow onto Y = 0
                        s_ro = f_pos + sun_dir[None, :] * 1e-3
                        s_rd = np.broadcast_to(sun_dir[None, :], (f_pos.shape[0], 3)).copy()
                        s_hit, _, _, _, _ = self.trace_dda(s_ro, s_rd)
                        cast_occ = np.where(s_hit, 0.16 * np.clip(1.0 - ell_r * 0.45, 0.25, 1.0), 0.0)
                        floor_shade = np.clip(1.0 - ambient_occ - cast_occ, 0.72, 1.0)
                        img_lin[f_ids] *= floor_shade[:, None]

        # Shade hit voxels
        hit_ids = np.nonzero(hit_mask)[0]
        if hit_ids.size > 0:
            cells_h = hit_cell[hit_ids]
            norms_h = hit_normal[hit_ids]
            pos_h = hit_pos[hit_ids]
            mats_h = hit_mat[hit_ids]

            albedo = self.palette_lin[mats_h]
            n_f = norms_h.astype(np.float32)

            ndotl = np.maximum(0.0, np.sum(n_f * sun_dir[None, :], axis=1))

            # Sun raytraced shadow for faces pointing toward key light
            shadow_factor = np.ones(hit_ids.size, dtype=np.float32)
            lit_local = np.nonzero(ndotl > 0.01)[0]
            if lit_local.size > 0:
                s_ro = pos_h[lit_local] + n_f[lit_local] * 2e-3
                s_rd = np.broadcast_to(sun_dir[None, :], (lit_local.size, 3)).copy()
                s_hit, _, _, _, _ = self.trace_dda(s_ro, s_rd)
                shadow_factor[lit_local] = np.where(s_hit, 0.42, 1.0)

            ao = self.compute_corner_ao(cells_h, norms_h, pos_h)

            # Studio 3-point + hemisphere fill so silhouettes & back faces stay rich
            sky_mix = 0.5 + 0.5 * n_f[:, 1]
            hemi = (0.30 * (1.0 - sky_mix) + 0.44 * sky_mix) * ao
            rim_dir = -0.60 * right + 0.35 * cam_up + 0.55 * rd
            rim_dir /= np.linalg.norm(rim_dir)
            rim = np.maximum(0.0, np.sum(n_f * rim_dir[None, :], axis=1)) * 0.14 * ao

            direct = ndotl * shadow_factor * 0.76 * (0.45 + 0.55 * ao)
            light_rgb = (
                hemi[:, None] * np.array([0.96, 0.98, 1.03], dtype=np.float32)
                + direct[:, None] * np.array([1.05, 1.02, 0.97], dtype=np.float32)
                + rim[:, None] * np.array([0.88, 0.94, 1.04], dtype=np.float32)
            )
            shaded = np.clip(albedo * light_rgb, 0.0, 1.0)
            img_lin[hit_ids] = shaded

        img_lin_2d = img_lin.reshape(rh, rw, 3)
        if ssaa > 1:
            img_lin_2d = img_lin_2d.reshape(height, ssaa, width, ssaa, 3).mean(axis=(1, 3))

        img_srgb = np.clip(np.power(np.clip(img_lin_2d, 0.0, 1.0), 1.0 / 2.2) * 255.0 + 0.5, 0, 255).astype(
            np.uint8
        )
        return img_srgb


def draw_dashed_line(
    draw: ImageDraw.ImageDraw,
    p0: tuple[int, int],
    p1: tuple[int, int],
    color: tuple[int, int, int],
    dash: int = 8,
    gap: int = 6,
    width: int = 1,
) -> None:
    x0, y0 = p0
    x1, y1 = p1
    dx = x1 - x0
    dy = y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 1:
        return
    ux, uy = dx / dist, dy / dist
    cur = 0.0
    while cur < dist:
        nxt = min(dist, cur + dash)
        draw.line(
            (x0 + ux * cur, y0 + uy * cur, x0 + ux * nxt, y0 + uy * nxt),
            fill=color,
            width=width,
        )
        cur = nxt + gap


def render_sheets(
    data: dict[str, Any],
    summary: dict[str, Any],
    out_dir: Path,
    prefix: str,
) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    bounds = summary["bounds"]
    scene = VoxelScene(data, bounds)
    min_x, max_x, min_y, max_y, min_z, max_z = bounds

    sheet_w = 2400
    col_w = 456
    gap_w = (sheet_w - col_w * 5) // 6  # (2400 - 2280)/6 = 20px margins/gaps

    view_h_clean = 760
    clean_w, clean_h = sheet_w, 880
    px_per_vox_clean = min(15.2, (view_h_clean - 130) / max(1, scene.sy), (col_w - 60) / max(scene.sx, scene.sz, 1))
    ground_y_clean = view_h_clean - 58.0

    views = [
        ("FRONT", "+Z 正视图 FRONT", (0.0, 0.0, -1.0), False),
        ("LEFT", "+X 左视图 LEFT (盾侧)", (-1.0, 0.0, 0.0), False),
        ("BACK", "-Z 背视图 BACK", (0.0, 0.0, 1.0), False),
        ("RIGHT", "-X 右视图 RIGHT (剑侧)", (1.0, 0.0, 0.0), False),
        ("3/4 VIEW", "3/4 立体参考 HERO ISO", (0.48, -0.28, -0.83), True),
    ]

    # Render Clean Sheet (minimal text for Image-Gen style & turnaround reference)
    clean_img = Image.new("RGB", (clean_w, clean_h), BG_HEX)
    clean_draw = ImageDraw.Draw(clean_img)
    f_clean = load_font(22, bold=True)

    y_off_clean = 66
    floor_screen_clean = y_off_clean + int(round(ground_y_clean))
    draw_dashed_line(clean_draw, (32, floor_screen_clean), (clean_w - 32, floor_screen_clean), (203, 213, 225), dash=10, gap=8, width=2)

    for i, (short_label, _full_label, rd_dir, is_iso) in enumerate(views):
        x0 = gap_w + i * (col_w + gap_w)
        arr = scene.render_ortho_view(
            col_w,
            view_h_clean,
            rd_dir,
            px_per_vox_clean * (0.94 if is_iso else 1.0),
            view_h_clean * 0.56 if is_iso else ground_y_clean,
            fixed_sun_dir=(0.45, 0.72, 0.52) if is_iso else None,
            ssaa=2 if is_iso else 1,
            draw_ground_shadow=is_iso,
        )
        tile = Image.fromarray(arr, mode="RGB")
        clean_img.paste(tile, (x0, y_off_clean))

        if i > 0:
            clean_draw.line((x0 - gap_w // 2, 48, x0 - gap_w // 2, clean_h - 44), fill=(226, 232, 240), width=1)

        tb = clean_draw.textbbox((0, 0), short_label, font=f_clean)
        tw = tb[2] - tb[0]
        clean_draw.text((x0 + (col_w - tw) // 2, 32), short_label, fill=(71, 85, 105), font=f_clean)

    # Re-draw faint baseline on top of pasted floor margin so line spans seamlessly across ortho tiles
    draw_dashed_line(
        clean_draw,
        (32, floor_screen_clean),
        (gap_w + 4 * (col_w + gap_w) - 10, floor_screen_clean),
        (192, 204, 218),
        dash=10,
        gap=8,
        width=2,
    )

    clean_path = out_dir / f"{prefix}_multiview_clean.png"
    clean_img.save(clean_path, optimize=True)

    # Render Annotated Engineering Sheet
    ann_w, ann_h = sheet_w, 1280
    ann_img = Image.new("RGB", (ann_w, ann_h), BG_HEX)
    ann_draw = ImageDraw.Draw(ann_img)

    f_title = load_font(30, bold=True)
    f_sub = load_font(18, bold=False)
    f_view = load_font(22, bold=True)
    f_small = load_font(15, bold=False)
    f_mono_b = load_font(15, bold=True)

    # Header band
    ann_draw.rectangle((0, 0, ann_w, 98), fill=(15, 23, 42))
    meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
    model_name = str(meta.get("name") or "").strip()
    scale_val = meta.get("recommendedScale", 0.055)
    world_h = scene.sy * scale_val
    display_name = f"{prefix} · {model_name}" if model_name and model_name != prefix else prefix
    title_txt = f"{display_name} — 5 视图标准参考图 (Multi-View Voxel Reference)"
    sub_txt = (
        f"体素: {summary['voxelCount']}  |  网格尺寸: {scene.sx}W × {scene.sy}H × {scene.sz}D "
        f"(X[{min_x}..{max_x}], Y[{min_y}..{max_y}], Z[{min_z}..{max_z}])  |  "
        f"缩放: {scale_val} -> {world_h:.2f}m 高  |  骨骼: {len(data['parts'])} 根  |  色板: {len(data['palette'])} 色"
    )
    axis_txt = "坐标系铁律: +Z 正前方 | +Y 正上方 | +X 左侧(盾) | -X 右侧(剑) | minY = 0 (脚底/底座严格贴地)"

    ann_draw.text((34, 16), title_txt, fill=(248, 250, 252), font=f_title)
    ann_draw.text((36, 58), sub_txt, fill=(148, 163, 184), font=f_sub)
    ab = ann_draw.textbbox((0, 0), axis_txt, font=f_sub)
    ann_draw.text((ann_w - (ab[2] - ab[0]) - 34, 58), axis_txt, fill=(56, 189, 248), font=f_sub)

    view_top = 152
    view_h_ann = 710
    px_per_vox_ann = min(14.6, (view_h_ann - 105) / max(1, scene.sy), (col_w - 64) / max(scene.sx, scene.sz, 1))
    ground_y_ann = view_h_ann - 54.0

    ann_tiles_x: list[int] = []
    left_margin_x = 92
    usable_w = ann_w - left_margin_x - 28
    col_w_ann = (usable_w - gap_w * 4) // 5

    for i, (_short_label, full_label, rd_dir, is_iso) in enumerate(views):
        x0 = left_margin_x + i * (col_w_ann + gap_w)
        ann_tiles_x.append(x0)

        # Card outline behind view
        ann_draw.rounded_rectangle(
            (x0 - 4, view_top - 40, x0 + col_w_ann + 4, view_top + view_h_ann + 8),
            radius=10,
            fill=(248, 250, 252),
            outline=(203, 213, 225),
            width=2,
        )

        arr = scene.render_ortho_view(
            col_w_ann,
            view_h_ann,
            rd_dir,
            px_per_vox_ann * (0.94 if is_iso else 1.0),
            view_h_ann * 0.56 if is_iso else ground_y_ann,
            fixed_sun_dir=(0.45, 0.72, 0.52) if is_iso else None,
            ssaa=2 if is_iso else 1,
            draw_ground_shadow=is_iso,
        )
        tile = Image.fromarray(arr, mode="RGB")
        # Tint card background subtly inside tile
        ann_img.paste(tile, (x0, view_top))

        tb = ann_draw.textbbox((0, 0), full_label, font=f_view)
        tw = tb[2] - tb[0]
        ann_draw.text(
            (x0 + (col_w_ann - tw) // 2, view_top - 32),
            full_label,
            fill=(30, 41, 59) if not is_iso else (14, 116, 144),
            font=f_view,
        )

    # Height ruler & horizontal alignment lines across the 4 ortho views
    floor_y_abs = view_top + int(round(ground_y_ann))
    right_ortho_end = ann_tiles_x[3] + col_w_ann

    ruler_marks: list[tuple[float, str, tuple[int, int, int]]] = [(0.0, "Y=0", (220, 38, 38))]
    for key_bone in ("hips", "head"):
        if key_bone in data["rig"]:
            py_val = float(data["rig"][key_bone]["pivot"][1]) + 0.5
            ruler_marks.append((py_val, f"Y={py_val:g}", (14, 116, 144)))
    ruler_marks.append((float(scene.sy), f"Y={scene.sy}", (51, 65, 85)))

    ann_draw.line((left_margin_x - 14, floor_y_abs - int(round(scene.sy * px_per_vox_ann)), left_margin_x - 14, floor_y_abs), fill=(100, 116, 139), width=2)
    for y_vox, lbl, col in ruler_marks:
        y_px = int(round(floor_y_abs - y_vox * px_per_vox_ann))
        ann_draw.line((left_margin_x - 20, y_px, left_margin_x - 8, y_px), fill=col, width=2)
        lb = ann_draw.textbbox((0, 0), lbl, font=f_small)
        ann_draw.text((left_margin_x - 24 - (lb[2] - lb[0]), y_px - (lb[3] - lb[1]) // 2 - 1), lbl, fill=col, font=f_small)
        draw_dashed_line(ann_draw, (left_margin_x, y_px), (right_ortho_end, y_px), (203, 213, 225) if y_vox > 0 else (248, 113, 113), dash=8, gap=6, width=2 if y_vox == 0 else 1)

    # Bone pivot crosshairs on Front (+Z) and Left (+X) views
    front_cx = ann_tiles_x[0] + col_w_ann * 0.5
    left_cx = ann_tiles_x[1] + col_w_ann * 0.5
    model_mid_x = (min_x + max_x) * 0.5
    model_mid_z = (min_z + max_z) * 0.5
    # Note in scene grid: center is sx/2 which corresponds to world x = min_x + sx/2 - 0.5 = (min_x + max_x)/2!
    for bname, spec in data["rig"].items():
        px_w, py_w, pz_w = spec["pivot"]
        py_shifted = py_w + 0.5
        dot_y = floor_y_abs - py_shifted * px_per_vox_ann
        # Front view: right = +X
        fx = front_cx + (px_w - model_mid_x) * px_per_vox_ann
        # Left view: right = -Z
        lx = left_cx - (pz_w - model_mid_z) * px_per_vox_ann
        for cx, cy in ((fx, dot_y), (lx, dot_y)):
            r = 4
            ann_draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(6, 182, 212), outline=(15, 23, 42), width=1)

    # Bottom Palette & Rig Reference Panel
    panel_y0 = view_top + view_h_ann + 26
    ann_draw.rounded_rectangle((32, panel_y0, ann_w - 32, ann_h - 24), radius=12, fill=(255, 255, 255), outline=(203, 213, 225), width=2)
    ann_draw.text((52, panel_y0 + 14), f"标准色板与材质定义 ({len(data['palette'])} 色)", fill=(15, 23, 42), font=f_view)

    # Layout palette swatches in a 2-row grid
    cols = 7
    swatch_w = (ann_w - 104 - (cols - 1) * 14) // cols
    swatch_h = 62
    for idx, entry in enumerate(data["palette"]):
        row = idx // cols
        col = idx % cols
        sx0 = 52 + col * (swatch_w + 14)
        sy0 = panel_y0 + 54 + row * (swatch_h + 12)
        rgb = hex_to_srgb_tuple(entry["hex"])
        ann_draw.rounded_rectangle((sx0, sy0, sx0 + swatch_w, sy0 + swatch_h), radius=8, fill=(248, 250, 252), outline=(226, 232, 240), width=1)
        ann_draw.rounded_rectangle((sx0 + 8, sy0 + 8, sx0 + 48, sy0 + swatch_h - 8), radius=6, fill=rgb, outline=(100, 116, 139), width=1)
        pid = entry.get("id", f"mat_{idx}")
        pname = entry.get("name", pid)
        ann_draw.text((sx0 + 56, sy0 + 8), f"[{idx}] {pid}  {entry['hex']}", fill=(15, 23, 42), font=f_mono_b)
        ann_draw.text((sx0 + 56, sy0 + 32), str(pname)[:18], fill=(71, 85, 105), font=f_small)

    # Bone summary footer line inside bottom panel
    bone_summary = "骨骼清单 (" + str(len(data["parts"])) + "): " + ", ".join(
        f"{p}({summary['partCounts'][p]})" for p in data["parts"]
    )
    ann_draw.text((52, ann_h - 72), bone_summary, fill=(51, 65, 85), font=f_small)
    if summary["animations"]:
        anim_txt = "动作集 (" + str(len(summary["animations"])) + "): " + ", ".join(summary["animations"])
    else:
        anim_txt = "青色圆点 = 骨骼旋转轴心 (pivot)   |   虚线红底 = 地面贴合线 Y=0   |   注：JSON 未附带 animations 轨道（运行时由 riggedVoxel.ts 提供 8 组程序化动作）"
    ann_draw.text((52, ann_h - 48), anim_txt, fill=(100, 116, 139), font=f_small)

    ann_path = out_dir / f"{prefix}_multiview_annotated.png"
    ann_img.save(ann_path, optimize=True)
    return clean_path, ann_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate voxel JSON and render 5-view reference PNGs.")
    parser.add_argument(
        "input",
        nargs="?",
        default=str(Path(__file__).resolve().parent.parent / "data" / "models" / "iron_knight.json"),
        help="Path to input voxel model JSON",
    )
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).resolve().parent.parent / "docs" / "references"),
        help="Directory to write clean & annotated reference PNGs",
    )
    parser.add_argument("--prefix", default="", help="Output filename prefix (default: input stem)")
    args = parser.parse_args()

    in_path = Path(args.input).resolve()
    if not in_path.exists():
        print(f"[ERROR] Input file not found: {in_path}", file=sys.stderr)
        return 1

    with in_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    summary = validate_asset(data)
    prefix = args.prefix.strip() or in_path.stem
    print(f"=== Voxel Asset Validation: {in_path.name} ===")
    print(f"Valid: {summary['valid']} | Voxels: {summary['voxelCount']} | Bounds: {summary['bounds']}")
    print(f"Bones ({len(summary['partCounts'])}): {summary['partCounts']}")
    if summary["animations"]:
        print(f"Animations ({len(summary['animations'])}): {summary['animations']}")
    for w in summary["warnings"]:
        print(f"[WARN] {w}")
    for e in summary["errors"]:
        print(f"[FAIL] {e}", file=sys.stderr)
    if not summary["valid"]:
        return 2

    clean_path, ann_path = render_sheets(data, summary, Path(args.out_dir).resolve(), prefix)
    print(f"Rendered clean reference:     {clean_path}")
    print(f"Rendered annotated blueprint: {ann_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
