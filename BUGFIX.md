# 本版修复（BUGFIX）· 0.3.14 → 0.3.15

## 标题

启动时配置的 `probeIntervalMs` 被丢弃：周期探活循环恒用硬编码的 10 分钟默认间隔，用户配置要等下一次设置保存才生效（上游 issue #107 的成因 3；#106「代理被误标 dead、想调快复探」诉求的一部分）。

## 现象与根因

`packages/plugin/src/ip-pool.ts` 的装配顺序构成一个静默的空转：

1. `startIpPool()` 在 PeriodicProber 构造**之前**先调用了 `applyConfig()`（原 line 311），而 `applyConfig()` 里把配置下发给探活循环的唯一通道是 `periodicRef?.setIntervalMs(current.probeIntervalMs ?? 10 * 60_000)`（原 line 250）。此刻 `periodicRef` 仍为 `null`，`?.` 让这一行静默 no-op。
2. 随后 `new PeriodicProber(pool, enqueue)`（原 line 407）**未传 options**，`#intervalMs` 落到构造函数默认值 `10 * 60_000`。
3. 构造之后再没有任何代码把配置间隔补下发——只有下一次设置保存触发 `reconfigure()` → `applyConfig()` 时，`periodicRef` 已存在，配置才真正生效。

结果：用户在 `cordis.patch.yml` 里把 `probeIntervalMs` 调小（例如 2 分钟，想让被误标 dead 的出口尽快复探），每次重启 DSH 后循环仍按 10 分钟跑，直到他碰巧再保存一次设置。

## 证据链

1. **最小复现（离线，无真实网络）**：脚本以真实 `startIpPool` 启动运行时（1 个 manual 出口、free 源禁用、订阅为空——此时启动期唯一的 `setInterval` 就是周期探活定时器），劫持 `globalThis.setInterval` 记录实际下发的延迟。配置 `probeIntervalMs: 120_000`：
   - 修复前：`setInterval delays recorded during boot = [600000]`，`VERDICT=BUG`，exit 1。
   - 修复后：`[120000]`，`VERDICT=OK`，exit 0。
2. **回归测试**：新增 `packages/plugin/test/periodic-boot-interval.test.ts` 两条（配置值在启动期生效 / 未配置时保持 10 分钟默认）。`git stash` 回基线复跑：第一条红、第二条绿；修复后两条全绿——缺陷被测试钉住且默认路径无行为变化。
3. **基线与全量**：基线（先 `build`+`build:client`、测试进程去掉沙箱代理环境变量，见下方边界）全套件 414/414 通过；修复后 416/416（414 + 新增 2），`tsc --noEmit`、`build`、`build:client` 均干净，零回归。

## 改动文件

- `packages/plugin/src/ip-pool.ts`（唯一逻辑改动，+6/−1）：构造 `PeriodicProber` 时以 `{ intervalMs: ipPool.probeIntervalMs ?? 10 * 60_000 }` 注入配置间隔——与 `applyConfig()` 使用的同一取值表达式，附注释说明启动顺序的坑。
- `packages/plugin/test/periodic-boot-interval.test.ts`（新增回归测试，上游既有测试一字未改）。
- 契约同步：`packages/plugin/package.json` version 0.3.14 → 0.3.15、`repository.url` 改指落点仓；README.md 顶部追加中文 fork 头（上游原文未删）；新增本文件与 UPSTREAM.md；LICENSE 逐字未动。仓库内无其他版本戳（根 package.json 无 version 字段，pnpm-lock 无根版本字段）。

## 验证边界

- **范围**：只修 #107 的成因 3（启动丢弃配置）。#107 的其余成因——dead-retry 在每轮探活中预留份额、死亡即复核（verify-on-death）、全 dead 时直连回退的告警、设置卡展示 periodic 状态——不在本版范围，未动。
- **钳制差异**：`setIntervalMs()` 对下发值有 60s 下限钳制，构造函数没有。本版按 #107 原议「构造时 seed 配置值」原样注入，未复刻钳制；设置 schema 本身将 `probeIntervalMs` 限定为 60s–24h，正常配置路径不受此差异影响。
- **测试环境**：本沙箱的全局 egress 代理环境变量（`HTTP_PROXY` 等）会拦截 dispatcher 的真实本地代理 e2e 并使其挂起，issue #107 在其作者机器上亦有同类环境失败记录；本版全部测试结论均在子进程去除代理变量后取得。首次未 build 时 client/hoisted 类测试因缺 `lib/` 产物失败，属运行前提而非产品缺陷。
- 未在真实 DSH 宿主中做端到端验证：探活循环的下游行为（选出口、判定、配额）全部沿用上游 `PeriodicProber` 既有语义，本版只改变其启动间隔的来源。
