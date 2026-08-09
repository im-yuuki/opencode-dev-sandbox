#!/usr/bin/env python3
"""System metrics collection for the DevBox dashboard.

Reports cumulative counters, instantaneous values and container *capacities*;
CPU usage and network rates are derived client-side from deltas, so concurrent
browser tabs never interfere with each other's baseline.

Container-aware first (cgroup v2, then v1), with /proc-style fallbacks for
run-times that don't expose cgroup accounting. Every metric degrades
independently to None when its source is unavailable, instead of failing the
whole endpoint.
"""

import os
import shutil
import subprocess
import threading
import time

try:
    _HZ = float(os.sysconf("SC_CLK_TCK"))
except (ValueError, OSError, AttributeError):
    _HZ = 100.0

CGROUP_V2 = "v2"
CGROUP_V1 = "v1"
DISK_PATH = "/workspace"


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except Exception:
        return None


def _int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _cgroup_flavor() -> str | None:
    """The container's cgroup flavor, or None when cgroupfs is not exposed.

    Hybrid controllers still publish cgroup.controllers, and a v2 fs prefers
    its own hierarchy, so v2 wins; v1 is only probed when v2 is absent.
    """
    if _read("/sys/fs/cgroup/cgroup.controllers"):
        return CGROUP_V2
    if _read("/sys/fs/cgroup/memory/memory.usage_in_bytes"):
        return CGROUP_V1
    return None


def _count_cpuset(cpus: str | None) -> int | None:
    """Count CPUs described by a cpuset list like '0-3,5,7' (v1) or
    '0-3' (v2). Returns None when the set is empty or unreadable."""
    if not cpus:
        return None
    n = 0
    for part in cpus.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, _, hi = part.partition("-")
            try:
                n += int(hi) - int(lo) + 1
            except ValueError:
                pass
        else:
            n += 1
    return n or None


def _cpuset_count(flavor: str | None) -> int | None:
    if flavor == CGROUP_V2:
        return _count_cpuset(_read("/sys/fs/cgroup/cpuset.cpus.effective"))
    if flavor == CGROUP_V1:
        return _count_cpuset(_read("/sys/fs/cgroup/cpuset/cpuset.cpus"))
    return None


def _capacity_cores(flavor: str | None) -> float | None:
    """Effective CPU capacity in cores: cgroup quota when set, otherwise the
    number of CPUs the cpuset cgroup is allowed to use, otherwise the host
    CPU count."""
    if flavor == CGROUP_V2:
        maxv = _read("/sys/fs/cgroup/cpu.max")
        if maxv:
            quota, _, period = maxv.partition(" ")
            period_n = _int(period)
            if quota.strip() == "max" or quota.strip() == "":
                count = _cpuset_count(flavor)
                return float(count) if count else float(os.cpu_count() or 1)
            if period_n and period_n > 0:
                q = _int(quota)
                if q is not None and q > 0:
                    return q / period_n
        count = _cpuset_count(flavor)
        if count:
            return float(count)
    elif flavor == CGROUP_V1:
        q = _int(_read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"))
        p = _int(_read("/sys/fs/cgroup/cpu/cpu.cfs_period_us"))
        if q is None:
            count = _cpuset_count(flavor)
            if count:
                return float(count)
        elif q > 0 and p and p > 0:
            return q / p
        # q == -1: no quota, bounded only by the cpuset.
        count = _cpuset_count(flavor)
        if count:
            return float(count)
    return float(os.cpu_count() or 1)


def _usage_nanos(flavor: str | None) -> int | None:
    """Cumulative CPU time in nanoseconds."""
    if flavor == CGROUP_V2:
        stat = _read("/sys/fs/cgroup/cpu.stat")
        if stat:
            for line in stat.splitlines():
                key, _, value = line.partition(" ")
                if key == "usage_usec":
                    microseconds = _int(value)
                    return microseconds * 1_000 if microseconds is not None else None
    elif flavor == CGROUP_V1:
        return _int(_read("/sys/fs/cgroup/cpuacct/cpuacct.usage"))

    # Fallback: host-wide /proc/stat. Reflects host CPUs, which may exceed the
    # cgroup view; only used when no cgroup accounting exists at all.
    stat = _read("/proc/stat")
    if not stat:
        return None
    for line in stat.splitlines():
        if not line.startswith("cpu "):
            continue
        fields = line.split()[1:]  # drop the "cpu" label
        try:
            # CPU-time jiffies across user, nice, system, idle, iowait, irq,
            # softirq and steal -> nanoseconds.
            total = sum(int(x) for x in fields[:8])
        except ValueError:
            return None
        return int(total / _HZ * 1_000_000_000)
    return None


def _meminfo_kb() -> dict[str, int]:
    out: dict[str, int] = {}
    raw = _read("/proc/meminfo")
    if not raw:
        return out
    for line in raw.splitlines():
        key, _, rest = line.partition(":")
        value = _int(rest.split()[0]) if rest.strip() else None
        if value is not None:
            out[key.strip()] = value * 1024  # kB -> bytes
    return out


def _cpu_model_name() -> str | None:
    """Human-readable CPU model reported by the kernel."""
    raw = _read("/proc/cpuinfo")
    if not raw:
        return None
    for line in raw.splitlines():
        key, _, value = line.partition(":")
        if key.strip() in {"model name", "Hardware"}:
            model = value.strip()
            if model:
                return model
    return None


def _load_metrics() -> dict | None:
    try:
        one, five, fifteen = os.getloadavg()
    except (OSError, ValueError):
        return None
    return {"one": one, "five": five, "fifteen": fifteen}


def _memory_metrics() -> dict | None:
    info = _meminfo_kb()
    flavor = _cgroup_flavor()

    if flavor == CGROUP_V2:
        used = _int(_read("/sys/fs/cgroup/memory.current"))
        limit = _read("/sys/fs/cgroup/memory.max")
        if used is not None and limit and limit.strip() != "max":
            lim = _int(limit)
            if lim is not None:
                return {
                    "usedBytes": used,
                    "limitBytes": lim,
                    "availableBytes": max(0, lim - used),
                    "source": CGROUP_V2,
                }
    elif flavor == CGROUP_V1:
        used = _int(_read("/sys/fs/cgroup/memory/memory.usage_in_bytes"))
        lim = _int(_read("/sys/fs/cgroup/memory/memory.limit_in_bytes"))
        if used is not None and lim and lim > 0 and lim != (1 << 63) - 1:
            return {
                "usedBytes": used,
                "limitBytes": lim,
                "availableBytes": max(0, lim - used),
                "source": CGROUP_V1,
            }

    # No usable container limit: report host totals.
    total = info.get("MemTotal")
    avail = info.get("MemAvailable")
    if total is None:
        return None
    used = total - avail if avail is not None else total
    return {
        "usedBytes": used,
        "limitBytes": total,
        "availableBytes": avail,
        "source": "meminfo",
    }


def _disk_metrics() -> dict | None:
    try:
        s = shutil.disk_usage(DISK_PATH)
    except OSError:
        return None
    return {
        "totalBytes": s.total,
        "usedBytes": s.used,
        "availableBytes": s.free,  # f_bavail: free for the workload
        "path": DISK_PATH,
    }


def _network_metrics() -> dict | None:
    raw = _read("/proc/net/dev")
    if not raw:
        return None
    rx = tx = 0
    interfaces = []
    for line in raw.splitlines()[2:]:
        name, _, rest = line.partition(":")
        name = name.strip()
        if name == "lo":
            continue  # loopback is launcher-internal chatter, not workload I/O
        parts = rest.split()
        if len(parts) < 9:
            continue
        r = _int(parts[0])
        t = _int(parts[8])
        if r is None or t is None:
            return None
        rx += r
        tx += t
        interfaces.append(name)
    if not interfaces:
        return None
    return {
        "rxBytes": rx,  # cumulative received bytes
        "txBytes": tx,  # cumulative transmitted bytes
        "interfaces": interfaces,
    }


# ---------------- gpu ----------------
# nvidia-smi is treated as an optional, slow probe: spawn it at most once
# every few seconds and share the result between concurrent requests instead of
# blocking a fresh process on every poll.
_GPU_TTL = 2.0
_GPU_STATE = {"lock": threading.Lock(), "at": 0.0, "value": None}


def _query_gpus() -> dict | None:
    """Aggregate GPU utilization/memory from nvidia-smi, or None when absent."""
    try:
        r = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total,name",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0 or not r.stdout.strip():
        return None

    gpus = []
    for line in r.stdout.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 4:
            continue
        util, mem_used, mem_total, name = parts
        try:
            u = float(util)
            mu = int(mem_used)
            mt = int(mem_total)
        except ValueError:
            continue
        # nvidia-smi reports memory in MiB unless a unit flag says otherwise.
        gpus.append(
            {
                "utilizationPercent": u,
                "memoryUsedBytes": mu * 1024 * 1024,
                "memoryTotalBytes": mt * 1024 * 1024,
                "name": name,
            }
        )
    if not gpus:
        return None

    count = len(gpus)
    return {
        "count": count,
        "name": gpus[0]["name"],
        "utilizationPercent": sum(g["utilizationPercent"] for g in gpus) / count,
        "memoryUsedBytes": sum(g["memoryUsedBytes"] for g in gpus),
        "memoryTotalBytes": sum(g["memoryTotalBytes"] for g in gpus),
    }


def _gpu_metrics() -> dict | None:
    now = time.monotonic()
    with _GPU_STATE["lock"]:
        if now - _GPU_STATE["at"] < _GPU_TTL and _GPU_STATE["value"] is not None:
            return _GPU_STATE["value"]
    value = _query_gpus()
    with _GPU_STATE["lock"]:
        _GPU_STATE["at"] = now
        _GPU_STATE["value"] = value
    return value


def collect_metrics() -> dict:
    flavor = _cgroup_flavor()
    memory = _memory_metrics()
    return {
        "monotonic": time.monotonic(),
        "cpu": {
            "usageNs": _usage_nanos(flavor),
            "capacityCores": _capacity_cores(flavor),
            "hostCores": os.cpu_count(),
            "model": _cpu_model_name(),
            "source": flavor or "proc",
        },
        "load": _load_metrics(),
        "memory": memory,
        "disk": _disk_metrics(),
        "network": _network_metrics(),
        "gpu": _gpu_metrics(),
    }